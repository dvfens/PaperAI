import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @pdf-lib/fontkit's Indic (Devanagari) shaper needs the regenerator runtime as a global.
import "regenerator-runtime/runtime.js";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
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
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { SignMethod } from "@/lib/signing";
import type { Box, FieldAnswer, FormField } from "@/lib/types";
import { env } from "@/server/env";
import { HttpError } from "@/server/http";
import { log } from "@/server/log";
import type { DecodedImage } from "./image";
import { loadPdf } from "./pdfForm";

/**
 * PDFGenerationService — produces the completed document while preserving the original layout:
 *  - fillable PDFs: the real AcroForm fields are filled (then flattened so the result prints the same everywhere);
 *  - flat PDFs: text is written onto the original vector pages at the mapped positions;
 *  - photos/scans: the scan becomes the page background and answers are written on top.
 * Photo fields are always left for the person. Signature fields too — unless the person signed with
 * a finger in Paper AI: then the drawn signature goes into every signature box, and a "Signature record"
 * page is added at the end (like an e-signature certificate).
 */

export type OriginalDocument = { kind: "pdf"; bytes: Buffer } | { kind: "images"; images: DecodedImage[] };

const INK = rgb(0.06, 0.12, 0.42); // dark blue, like a ballpoint pen
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const TEXT = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const RULE = rgb(0.85, 0.87, 0.9);

/** The person's drawn signature and how it was made. */
export interface SignatureStamp {
  /** PNG with a transparent background, trimmed to the ink. */
  png: Uint8Array;
  /** Public address of the phone key that will sign this PDF. */
  signer: string;
  signedAt: Date;
  method: SignMethod;
  /** Where anyone can check the PDF, e.g. https://…/verify */
  verifyUrl: string;
}
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
  if (!latinBytes || !devaBytes) {
    log.error("pdf.font_missing", { reason: !latinBytes ? "latin" : "devanagari" });
    // In production a missing font would silently drop Hindi text from people's forms: fail instead.
    if (env.isProd) throw new HttpError(500, "font_missing", "The PDF fonts are not installed on this server.");
  }
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

/**
 * Start the answer after something printed at the start of its box, so it is not written on top:
 * - a currency sign ("₹ ____", read as format "₹"), which would hide the amount's first digit;
 * - a date pattern shown inside the box as a hint ("DD / MM / YYYY" in the box, not in the label).
 * Only when enough of the box is left for the answer.
 */
export function afterPrintedHint(
  page: { getSize(): { width: number; height: number } },
  box: Box,
  field: { type: string; format?: string; label: string },
  textWidth: (text: string, size: number) => number,
): Box {
  const format = (field.format ?? "").trim();
  if (!format) return box;
  const { width, height } = page.getSize();
  let indentPt = 0;
  if (/^(₹|rs\.?|inr|\$|€|£)$/i.test(format)) {
    // The printed sign is about as wide as the box is tall (plus a little gap).
    indentPt = box.h * height * 0.9;
  } else if (field.type === "date" && /d\s*d|m\s*m|y\s*y/i.test(format)) {
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    if (squash(field.label).includes(squash(format))) return box; // the pattern is in the label, not the box
    // Printed hints are usually set a little larger than the answer and start after a small inset.
    const size = Math.max(6, Math.min(13, box.h * height * 0.62));
    indentPt = textWidth(format, size) * 1.35 + size * 1.2;
  }
  const indent = indentPt / width;
  if (!indent || box.w - indent < box.w * 0.4) return box;
  return { ...box, x: box.x + indent, w: box.w - indent };
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

/** Fit the signature into a box: left-aligned, and allowed to rise above a thin "sign here" line. */
function drawSignature(page: PDFPage, box: Box, image: PDFImage) {
  const r = toPdfRect(page, box);
  const maxW = r.w * 0.94;
  const maxH = Math.max(r.h * 0.9, Math.min(30, r.h * 2.2));
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const y = h <= r.h ? r.y + (r.h - h) / 2 : r.y + r.h * 0.08;
  page.drawImage(image, { x: r.x + r.w * 0.03, y, width: w, height: h });
}

const INDIA_TIME = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Kolkata" });

/** The last page: what was signed, when, with which key, and how anyone can check it. */
async function addSignaturePage(doc: PDFDocument, image: PDFImage, stamp: SignatureStamp, fonts: Fonts, boxes: number) {
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  const left = 56;
  const width = A4_WIDTH - left * 2;
  const text = (t: string, x: number, y: number, size: number, color = TEXT) => {
    try {
      page.drawText(t, { x, y, size, font: fonts.latin, color });
    } catch {
      // unencodable character: skip
    }
  };
  let y = A4_HEIGHT - 72;
  text("Signature record", left, y, 20);
  y -= 18;
  text("Added by Paper AI when this form was signed.", left, y, 10, MUTED);

  // The signature itself, in a light frame.
  y -= 24;
  const frameH = 110;
  page.drawRectangle({ x: left, y: y - frameH, width: 300, height: frameH, borderColor: RULE, borderWidth: 1 });
  const scale = Math.min(280 / image.width, (frameH - 20) / image.height);
  page.drawImage(image, {
    x: left + 10,
    y: y - frameH + (frameH - image.height * scale) / 2,
    width: image.width * scale,
    height: image.height * scale,
  });
  y -= frameH + 28;

  const rows: [string, string][] = [
    ["Signed on", `${INDIA_TIME.format(stamp.signedAt)} (India time)`],
    ["How", stamp.method === "finger+voice" ? "Drawn with a finger on the signer's phone, and confirmed aloud" : "Drawn with a finger on the signer's phone"],
    ["Signer key", stamp.signer],
    ["Covers", `All ${doc.getPageCount()} pages of this PDF, including this one`],
    ["Signature boxes", boxes ? `Signed in ${boxes} ${boxes === 1 ? "box" : "boxes"} on the form` : "No signature box was found on the form; the signature is on this page"],
  ];
  for (const [label, value] of rows) {
    text(label, left, y, 9, MUTED);
    y -= 14;
    for (const line of wrap(value, width, 11, fonts)) {
      text(line, left, y, 11);
      y -= 15;
    }
    y -= 8;
  }

  y -= 6;
  page.drawLine({ start: { x: left, y }, end: { x: left + width, y }, thickness: 0.75, color: RULE });
  y -= 22;
  const about = [
    "The signer key is a digital key kept on the signer's phone. The signature made with it covers the exact bytes of this PDF. When the signer saves the form in Paper AI, the signature is recorded on the Arkiv blockchain (Rabdi testnet), where it can no longer be changed.",
    "To check this document, open the address below (or scan the code) and choose this PDF. A match shows when it was signed, by which key, and that the file has not changed since. It does not prove that the information in the form is true, and it is not an Aadhaar eSign.",
  ];
  for (const para of about) {
    for (const line of wrap(para, width, 10, fonts)) {
      text(line, left, y, 10, TEXT);
      y -= 14;
    }
    y -= 8;
  }

  // QR code to the check page.
  y -= 6;
  const qr = await doc.embedPng(await QRCode.toBuffer(stamp.verifyUrl, { type: "png", margin: 1, width: 360, errorCorrectionLevel: "M" }));
  const size = 96;
  page.drawImage(qr, { x: left, y: y - size, width: size, height: size });
  text("Check this document", left + size + 16, y - 30, 11);
  text(stamp.verifyUrl, left + size + 16, y - 48, 10, MUTED);
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
  /** The person's signature: drawn into the signature boxes, plus a signature record page. */
  signature?: SignatureStamp;
}): Promise<{ bytes: Uint8Array; written: number; skipped: string[]; signedBoxes: number }> {
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
      const place = afterPrintedHint(page, box, field, (t, size) => widthOf(t, size, fonts));
      drawText(page, place, value, field.type === "multiline", fonts);
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

  let signedBoxes = 0;
  if (input.signature) {
    const image = await doc.embedPng(input.signature.png);
    for (const field of input.fields) {
      const page = field.type === "signature" && field.box ? pages[field.box.page] : undefined;
      if (!page) continue;
      drawSignature(page, field.box!, image);
      signedBoxes++;
    }
    await addSignaturePage(doc, image, input.signature, fonts, signedBoxes);
  }

  // Generic metadata only — never personal details.
  doc.setTitle("Completed form");
  doc.setProducer("Paper AI");
  doc.setCreator("Paper AI");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setAuthor("");
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  return { bytes, written, skipped, signedBoxes };
}
