import "server-only";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import type { Box } from "@/lib/types";
import { env } from "@/server/env";
import { errorCode, log } from "@/server/log";
import type { DecodedImage } from "./image";

export interface OcrWord {
  text: string;
  box: Box;
}

export interface OcrLine {
  id: string; // "p0-l12"
  page: number;
  text: string;
  confidence: number;
  box: Box;
  words: OcrWord[];
}

export interface OcrPage {
  page: number;
  text: string;
  confidence: number;
  lines: OcrLine[];
}

/** DocumentOCRService — reads printed text (English + Hindi) and where each line sits on the page. */
export interface DocumentOCRService {
  recognize(pages: DecodedImage[]): Promise<OcrPage[]>;
}

const LANGS = ["eng", "hin"];
/** OCR is an aid, not essential: Claude reads the page itself. Never let it hang a request. */
const WORKER_START_TIMEOUT_MS = 30_000;
const PAGE_TIMEOUT_MS = 25_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

class TesseractOCR implements DocumentOCRService {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private getWorker() {
    if (!this.worker) {
      // Prefer the language models bundled under assets/tessdata (copied at install/build time);
      // otherwise download them once from the tesseract.js CDN into OCR_CACHE_DIR.
      const bundled = join(process.cwd(), "assets", "tessdata");
      const local = LANGS.every((l) => existsSync(join(bundled, `${l}.traineddata.gz`)));
      if (!local) mkdirSync(env.ocrCacheDir, { recursive: true });
      const starting = createWorker(LANGS, 1, {
        ...(local ? { langPath: bundled, cacheMethod: "none" } : { cachePath: env.ocrCacheDir }),
        // Without a handler, tesseract.js rethrows worker errors as uncaught exceptions.
        errorHandler: (err: unknown) => log.warn("ocr.worker_error", { code: errorCode(err) }),
      });
      this.worker = withTimeout(starting, WORKER_START_TIMEOUT_MS, "ocr worker start").catch((err) => {
        this.worker = null;
        // If it finishes starting after we gave up, shut it down rather than leak it.
        void starting.then((w) => w.terminate()).catch(() => undefined);
        throw err;
      });
    }
    return this.worker;
  }

  /** Discard a worker that misbehaved so the next request starts a fresh one. */
  private reset() {
    const old = this.worker;
    this.worker = null;
    this.queue = Promise.resolve();
    void old?.then((w) => w.terminate()).catch(() => undefined);
  }

  async recognize(pages: DecodedImage[]): Promise<OcrPage[]> {
    // Tesseract workers process one image at a time; serialise requests.
    const run = this.queue.then(() => this.run(pages));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(pages: DecodedImage[]): Promise<OcrPage[]> {
    const worker = await this.getWorker();
    const out: OcrPage[] = [];
    for (let p = 0; p < pages.length; p++) {
      const img = pages[p];
      const started = Date.now();
      let data: Awaited<ReturnType<Worker["recognize"]>>["data"];
      try {
        ({ data } = await withTimeout(worker.recognize(img.bytes, {}, { text: true, blocks: true }), PAGE_TIMEOUT_MS, "ocr page"));
      } catch (err) {
        this.reset();
        throw err;
      }
      const lines: OcrLine[] = [];
      let n = 0;
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const text = line.text.replace(/\s+/g, " ").trim();
            if (!text) continue;
            lines.push({
              id: `p${p}-l${n++}`,
              page: p,
              text,
              confidence: Math.round(line.confidence),
              box: norm(line.bbox, img, p),
              words: line.words
                .filter((w) => w.text.trim())
                .map((w) => ({ text: w.text, box: norm(w.bbox, img, p) })),
            });
          }
        }
      }
      log.info("ocr.page", { pages: p + 1, durationMs: Date.now() - started });
      out.push({ page: p, text: data.text ?? "", confidence: Math.round(data.confidence ?? 0), lines });
    }
    return out;
  }
}

function norm(b: { x0: number; y0: number; x1: number; y1: number }, img: DecodedImage, page: number): Box {
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return {
    page,
    x: r(b.x0 / img.width),
    y: r(b.y0 / img.height),
    w: r((b.x1 - b.x0) / img.width),
    h: r((b.y1 - b.y0) / img.height),
  };
}

let instance: DocumentOCRService | null = null;
export function ocrService(): DocumentOCRService {
  instance ??= new TesseractOCR();
  return instance;
}

/** OCR is helpful but not essential when Claude can see the page: failures degrade gracefully. */
export async function tryRecognize(pages: DecodedImage[]): Promise<OcrPage[] | null> {
  try {
    return await ocrService().recognize(pages);
  } catch (err) {
    log.warn("ocr.failed", { code: errorCode(err) });
    return null;
  }
}
