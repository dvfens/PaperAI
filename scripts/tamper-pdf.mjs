// Demo helper: makes a visibly edited copy of a PDF so you can show a FAILED verification.
//   npm run demo:tamper -- completed-form.pdf        → writes completed-form.edited.pdf
// Then open /verify and choose the edited copy: it will not match the recorded fingerprint.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run demo:tamper -- <file.pdf>");
  process.exit(1);
}
const original = readFileSync(input);
const doc = await PDFDocument.load(original);
const page = doc.getPages()[0];
const font = await doc.embedFont(StandardFonts.Helvetica);
page.drawText("EDITED", { x: 36, y: page.getHeight() - 30, size: 10, font, color: rgb(0.8, 0, 0) });
const edited = await doc.save();
const out = input.replace(/\.pdf$/i, "") + ".edited.pdf";
writeFileSync(out, edited);
const h = (b) => createHash("sha256").update(b).digest("hex");
console.log(`original sha256: ${h(original)}`);
console.log(`edited   sha256: ${h(edited)}`);
console.log(`wrote ${out}`);
