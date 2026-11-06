import "server-only";
import { mkdirSync } from "node:fs";
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

class TesseractOCR implements DocumentOCRService {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private getWorker() {
    if (!this.worker) {
      mkdirSync(env.ocrCacheDir, { recursive: true });
      // Language data is downloaded once from the tesseract.js CDN and cached under OCR_CACHE_DIR.
      this.worker = createWorker(LANGS, 1, { cachePath: env.ocrCacheDir }).catch((err) => {
        this.worker = null;
        throw err;
      });
    }
    return this.worker;
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
      const { data } = await worker.recognize(img.bytes, {}, { text: true, blocks: true });
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
