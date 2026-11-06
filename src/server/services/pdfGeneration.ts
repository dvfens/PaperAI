import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @pdf-lib/fontkit's Indic (Devanagari) shaper needs the regenerator runtime as a global.
import "regenerator-runtime/runtime.js";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { Box, FieldAnswer, FormField } from "@/lib/types";
import { log } from "@/server/log";
import type { DecodedImage } from "./image";
import { loadPdf } from "./pdfForm";

/**
 * PDFGenerationService — produces the completed document while preserving the original layout:
 *  - fillable PDFs: the real AcroForm fields are filled (then flattened so the result prints the same everywhere);
 *  - flat PDFs: text is written onto the original vector pages at the mapped positions;
 *  - photos/scans: the scan becomes the page background and answers are written on top.
 * Signature and photo fields are always left for the person.
 */

export type OriginalDocument = { kind: "pdf"; bytes: Buffer } | { kind: "images"; images: DecodedImage[] };

const INK = rgb(0.06, 0.12, 0.42); // dark blue, like a ballpoint pen
const A4_WIDTH = 595.28;
const DEVANAGARI = /[ऀ-ॿ᳐-᳿‌‍꣠-ꣿ]/;

interface Fonts {
  latin: PDFFont;
  devanagari: PDFFont | null;
}

function readFont(file: string): Buffer | null {
  try {
    return readFileSync(join(process.cwd(), "assets", "fonts", file));
  } catch {
    return null;
  }
}

async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const latinBytes = readFont("NotoSans-Regular.woff");
  const devaBytes = readFont("NotoSansDevanagari-Regular.woff");
  const latin = latinBytes ? await doc.embedFont(latinBytes, { subset: true }) : await doc.embedFont(StandardFonts.Helvetica);
  const devanagari = devaBytes ? await doc.embedFont(devaBytes, { subset: true }) : null;
  if (!devaBytes) log.warn("pdf.font_missing", { reason: "devanagari" });
  return { latin, devanagari };
}

/** Split text into runs so Devanagari uses its own font and everything else the Latin font. */
function runs(text: string, fonts: Fonts): { text: string; font: PDFFont }[] {
  const out: { text: string; font: PDFFont }[] = [];
  for (const ch of text) {
    const font = DEVANAGARI.test(ch) && fonts.devanagari ? fonts.devanagari : fonts.latin;
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += ch;
    else out.push({ text: ch, font });
  }
  return out;
}

function widthOf(text: string, size: number, fonts: Fonts): number {
  return runs(text, fonts).reduce((w, r) => w + safeWidth(r.font, r.text, size), 0);
}

function safeWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

function drawRuns(page: PDFPage, text: string, x: number, y: number, size: number, fonts: Fonts) {
  let cx = x;
  for (const r of runs(text, fonts)) {
    try {
      page.drawText(r.text, { x: cx, y, size, font: r.font, color: INK });
    } catch {
      // Character not encodable in the available fonts: skip it rather than corrupting the page.
    }
    cx += safeWidth(r.font, r.text, size);
  }
}

function wrap(text: string, maxWidth: number, size: number, fonts: Fonts): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate, size, fonts) <= maxWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function toPdfRect(page: PDFPage, box: Box) {
  const { width, height } = page.getSize();
  return { x: box.x * width, y: height - (box.y + box.h) * height, w: box.w * width, h: box.h * height };
}

function drawText(page: PDFPage, box: Box, text: string, multiline: boolean, fonts: Fonts) {
  const r = toPdfRect(page, box);
  const pad = Math.min(3, r.w * 0.04);
  const maxWidth = Math.max(10, r.w - pad * 2);
  let size = Math.max(6, Math.min(13, r.h * 0.62));

  if (multiline || widthOf(text, size, fonts) > maxWidth) {
    for (; size >= 6; size -= 0.5) {
      const lines = multiline ? wrap(text, maxWidth, size, fonts) : [text];
      const fits =
        lines.every((l) => widthOf(l, size, fonts) <= maxWidth) && lines.length * size * 1.18 <= Math.max(r.h, size * 1.2);
      if (fits) break;
    }
    size = Math.max(6, size);
  }
  const lines = multiline ? wrap(text, maxWidth, size, fonts) : [text];
  const lineHeight = size * 1.18;
  const blockHeight = lines.length * lineHeight;
  let y = r.y + Math.max(0, (r.h - blockHeight) / 2) + blockHeight - size + size * 0.22;
  for (const line of lines) {
    drawRuns(page, line, r.x + pad, y, size, fonts);
    y -= lineHeight;
  }
}

function drawTick(page: PDFPage, box: Box) {
  const r = toPdfRect(page, box);
  const s = Math.max(6, Math.min(r.w, r.h));
  const x = r.x + (r.w - s) / 2;
  const y = r.y + (r.h - s) / 2;
  const thickness = Math.max(1.2, s * 0.12);
  page.drawLine({ start: { x: x + s * 0.15, y: y + s * 0.5 }, end: { x: x + s * 0.42, y: y + s * 0.2 }, thickness, color: INK });
  page.drawLine({ start: { x: x + s * 0.42, y: y + s * 0.2 }, end: { x: x + s * 0.88, y: y + s * 0.85 }, thickness, color: INK });
}

async function baseDocument(original: OriginalDocument): Promise<PDFDocument> {
  if (original.kind === "pdf") return loadPdf(original.bytes);
  const doc = await PDFDocument.create();
  for (const img of original.images) {
    const embedded = img.mediaType === "image/png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const height = (A4_WIDTH * img.height) / img.width;
    const page = doc.addPage([A4_WIDTH, height]);
    page.drawImage(embedded, { x: 0, y: 0, width: A4_WIDTH, height });
  }
  return doc;
}

export async function generateCompletedPdf(input: {
  original: OriginalDocument;
  fields: FormField[];
  answers: Record<string, Pick<FieldAnswer, "value" | "status">>;
}): Promise<{ bytes: Uint8Array; written: number; skipped: string[] }> {
  const doc = await baseDocument(input.original);
  const fonts = await embedFonts(doc);
  const pages = doc.getPages();
  let form: ReturnType<PDFDocument["getForm"]> | null = null;
  try {
    form = doc.getForm();
  } catch {
    form = null;
  }

  let written = 0;
  const skipped: string[] = [];

  for (const field of input.fields) {
    if (!field.aiFillable) continue;
    const answer = input.answers[field.id];
    const value = answer && (answer.status === "answered" || answer.status === "confirmed") ? answer.value.trim() : "";
    if (!value) continue;

    // 1) Real AcroForm field.
    if (field.acroName && form) {
      try {
        const f = form.getField(field.acroName);
        if (f instanceof PDFCheckBox) {
          if (value === "true") f.check();
          else f.uncheck();
          written++;
          continue;
        }
        if ((f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup) && f.getOptions().includes(value)) {
          f.select(value);
          if (!(f instanceof PDFRadioGroup)) {
            const h = f.acroField.getWidgets()[0]?.getRectangle().height ?? 18;
            f.setFontSize(Math.max(7, Math.min(11, h * 0.6)));
            f.updateAppearances(fonts.latin);
          }
          written++;
          continue;
        }
        if (f instanceof PDFTextField && !DEVANAGARI.test(value)) {
          // Size text to the widget instead of pdf-lib's auto size (which is far too large for multi-line boxes).
          const rect = f.acroField.getWidgets()[0]?.getRectangle();
          const h = rect?.height ?? 18;
          const w = Math.max(10, (rect?.width ?? 200) - 6);
          let size = f.isMultiline() ? Math.max(7, Math.min(10, h / 3.2)) : Math.max(7, Math.min(11, h * 0.6));
          if (!f.isMultiline()) while (size > 6 && safeWidth(fonts.latin, value, size) > w) size -= 0.5;
          const maxLength = f.getMaxLength();
          f.setText(maxLength ? value.slice(0, maxLength) : value);
          f.setFontSize(size);
          f.updateAppearances(fonts.latin);
          written++;
          continue;
        }
        // Devanagari text or an unknown option: draw it at the widget position instead (below).
      } catch {
        // field missing or not settable — fall back to drawing
      }
    }

    // 2) Printed tick-box choice: tick the chosen option.
    const optionBox = field.type === "choice" ? field.optionBoxes?.[value] : undefined;
    if (optionBox && pages[optionBox.page]) {
      drawTick(pages[optionBox.page], optionBox);
      written++;
      continue;
    }

    // 3) Draw at the mapped position.
    const box = field.box;
    const page = box ? pages[box.page] : undefined;
    if (!box || !page) {
      skipped.push(field.id);
      continue;
    }
    if (field.type === "checkbox") {
      if (value === "true") drawTick(page, box);
    } else {
      drawText(page, box, value, field.type === "multiline", fonts);
    }
    written++;
  }

  if (form) {
    try {
      form.flatten({ updateFieldAppearances: false });
    } catch {
      log.warn("pdf.flatten_failed");
    }
  }

  // Generic metadata only — never personal details.
  doc.setTitle("Completed form");
  doc.setProducer("Saathi");
  doc.setCreator("Saathi");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setAuthor("");
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  return { bytes, written, skipped };
}
