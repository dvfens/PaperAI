// Generates the demo forms used by "Try a sample form" and the README walkthrough:
//   public/samples/library-membership-form.pdf       — fillable (AcroForm) version
//   public/samples/library-membership-form-flat.pdf  — "paper" version with printed blanks (scan/flat path)
// The form is fictional and asks for nothing sensitive.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @pdf-lib/fontkit's Indic shaper needs the regenerator runtime as a global.
import "regenerator-runtime/runtime.js";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";

const OUT = join(process.cwd(), "public", "samples");
mkdirSync(OUT, { recursive: true });

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.35, 0.38, 0.45);
const ACCENT = rgb(0.11, 0.3, 0.75);
const LINE = rgb(0.55, 0.58, 0.64);

const FIELDS = [
  { name: "full_name", label: "Full name (in BLOCK LETTERS)", tip: "Full name (in BLOCK LETTERS)", required: true },
  { name: "date_of_birth", label: "Date of birth (DD/MM/YYYY)", tip: "Date of birth (DD/MM/YYYY)", required: true },
  { name: "gender", label: "Gender", tip: "Gender", radio: ["Male", "Female", "Other"] },
  { name: "mobile", label: "Mobile number", tip: "Mobile number", required: true },
  { name: "email", label: "Email (optional)", tip: "Email (optional)" },
  { name: "address", label: "Residential address", tip: "Residential address", multiline: true, required: true },
  { name: "pin_code", label: "PIN code", tip: "PIN code" },
  { name: "reading_language", label: "Preferred reading language", tip: "Preferred reading language", dropdown: ["English", "Hindi", "Marathi", "Other"] },
  { name: "senior_citizen", label: "I am a senior citizen (60 years or older) - no annual fee", tip: "Senior citizen (60+)", checkbox: true },
  { name: "emergency_name", label: "Emergency contact name", tip: "Emergency contact name" },
  { name: "emergency_mobile", label: "Emergency contact mobile", tip: "Emergency contact mobile" },
];

async function build(fillable) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle("Library membership application (sample)");
  doc.setProducer("Saathi sample generator");
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const deva = await doc.embedFont(readFileSync(join(process.cwd(), "assets", "fonts", "NotoSansDevanagari-Regular.woff")), { subset: true });
  const form = fillable ? doc.getForm() : null;
  const W = page.getWidth();
  const left = 48;
  const right = W - 48;

  // Header
  page.drawRectangle({ x: 0, y: 782, width: W, height: 60, color: rgb(0.93, 0.95, 0.99) });
  page.drawText("SUNRISE COMMUNITY LIBRARY", { x: left, y: 816, size: 17, font: bold, color: ACCENT });
  page.drawText("सनराइज़ सामुदायिक पुस्तकालय", { x: left, y: 794, size: 12, font: deva, color: ACCENT });
  page.drawText("Membership Application Form", { x: right - bold.widthOfTextAtSize("Membership Application Form", 13), y: 816, size: 13, font: bold, color: INK });
  page.drawText("Form LIB-01  |  Sample form for demonstration", { x: right - font.widthOfTextAtSize("Form LIB-01  |  Sample form for demonstration", 8.5), y: 798, size: 8.5, font, color: MUTED });

  // Photo box
  page.drawRectangle({ x: right - 92, y: 660, width: 92, height: 108, borderColor: LINE, borderWidth: 1 });
  page.drawText("Affix passport-", { x: right - 82, y: 722, size: 8.5, font, color: MUTED });
  page.drawText("size photograph", { x: right - 82, y: 710, size: 8.5, font, color: MUTED });

  page.drawText("Section A - Personal details", { x: left, y: 762, size: 12, font: bold, color: INK });

  const tip = (field, text) => field.acroField.dict.set(PDFName.of("TU"), PDFString.of(text));
  let y = 736;
  const fieldRight = (yy) => (yy > 660 ? right - 104 : right);

  for (const f of FIELDS) {
    const r = fieldRight(y);
    if (f.checkbox) {
      const box = 13;
      if (fillable) {
        const cb = form.createCheckBox(f.name);
        cb.addToPage(page, { x: left, y: y - 3, width: box, height: box, borderColor: INK, borderWidth: 1 });
        tip(cb, f.tip);
        page.drawText(f.label, { x: left + 20, y, size: 10.5, font, color: INK });
      } else {
        page.drawText(`[  ]  ${f.label}`, { x: left, y, size: 10.5, font, color: INK });
      }
      y -= 30;
      continue;
    }
    const label = `${f.label}${f.required ? " *" : ""}:`;
    page.drawText(label, { x: left, y, size: 10.5, font, color: INK });
    const lx = left + font.widthOfTextAtSize(label, 10.5) + 8;

    if (f.radio) {
      let x = lx;
      if (fillable) {
        const rg = form.createRadioGroup(f.name);
        for (const opt of f.radio) {
          rg.addOptionToPage(opt, page, { x, y: y - 2, width: 12, height: 12, borderColor: INK, borderWidth: 1 });
          page.drawText(opt, { x: x + 17, y, size: 10.5, font, color: INK });
          x += 17 + font.widthOfTextAtSize(opt, 10.5) + 22;
        }
        tip(rg, f.tip);
      } else {
        page.drawText(f.radio.map((o) => `[  ] ${o}`).join("      "), { x, y, size: 10.5, font, color: INK });
      }
      y -= 30;
      continue;
    }

    if (f.dropdown) {
      if (fillable) {
        const dd = form.createDropdown(f.name);
        dd.addOptions(f.dropdown);
        dd.addToPage(page, { x: lx, y: y - 5, width: 160, height: 18, borderColor: LINE, borderWidth: 1, font });
        tip(dd, f.tip);
      } else {
        page.drawText(`______________________   (${f.dropdown.join(" / ")})`, { x: lx, y, size: 10.5, font, color: INK });
      }
      y -= 30;
      continue;
    }

    const height = f.multiline ? 40 : 18;
    if (fillable) {
      const tf = form.createTextField(f.name);
      if (f.multiline) tf.enableMultiline();
      tf.addToPage(page, { x: lx, y: y - (f.multiline ? 27 : 5), width: r - lx, height, borderColor: LINE, borderWidth: 1, font });
      tip(tf, f.tip);
      if (f.required) tf.enableRequired();
    } else {
      const unders = "_".repeat(Math.max(10, Math.floor((r - lx) / font.widthOfTextAtSize("_", 10.5))));
      page.drawText(unders, { x: lx, y, size: 10.5, font, color: LINE });
      if (f.multiline) page.drawText("_".repeat(Math.floor((r - left) / font.widthOfTextAtSize("_", 10.5))), { x: left, y: y - 20, size: 10.5, font, color: LINE });
    }
    y -= f.multiline ? 48 : 30;
  }

  // Section B — family members (basic table)
  y -= 6;
  page.drawText("Section B - Family members who will also use this card (optional)", { x: left, y, size: 12, font: bold, color: INK });
  y -= 22;
  const cols = [
    { title: "Name", w: 260 },
    { title: "Relation", w: 140 },
    { title: "Age", w: 99 },
  ];
  const rowH = 22;
  let x = left;
  for (const c of cols) {
    page.drawRectangle({ x, y: y - 6, width: c.w, height: rowH, borderColor: LINE, borderWidth: 1, color: rgb(0.96, 0.97, 0.99) });
    page.drawText(c.title, { x: x + 6, y: y + 1, size: 10, font: bold, color: INK });
    x += c.w;
  }
  for (let row = 1; row <= 2; row++) {
    y -= rowH;
    x = left;
    page.drawText(`${row}.`, { x: left - 14, y: y + 1, size: 10, font, color: MUTED });
    for (const c of cols) {
      page.drawRectangle({ x, y: y - 6, width: c.w, height: rowH, borderColor: LINE, borderWidth: 1 });
      if (fillable) {
        const tf = form.createTextField(`family_${row}_${c.title.toLowerCase()}`);
        tf.addToPage(page, { x: x + 2, y: y - 4, width: c.w - 4, height: rowH - 4, borderWidth: 0, font });
        tip(tf, `Family member ${row} - ${c.title}`);
      }
      x += c.w;
    }
  }

  // Section C — declaration and signature
  y -= 40;
  page.drawText("Section C - Declaration", { x: left, y, size: 12, font: bold, color: INK });
  y -= 18;
  page.drawText("I confirm that the details above are correct and I will follow the library rules.", { x: left, y, size: 10, font, color: INK });
  y -= 34;
  page.drawText("Date of application:", { x: left, y, size: 10.5, font, color: INK });
  const dx = left + font.widthOfTextAtSize("Date of application:", 10.5) + 8;
  if (fillable) {
    const tf = form.createTextField("application_date");
    tf.addToPage(page, { x: dx, y: y - 5, width: 120, height: 18, borderColor: LINE, borderWidth: 1, font });
    tip(tf, "Date of application");
  } else {
    page.drawText("________________", { x: dx, y, size: 10.5, font, color: LINE });
  }
  page.drawText("Signature of applicant:", { x: 320, y, size: 10.5, font, color: INK });
  page.drawLine({ start: { x: 320, y: y - 30 }, end: { x: right, y: y - 30 }, thickness: 1, color: INK });
  if (fillable) {
    const sig = form.createTextField("applicant_signature");
    sig.addToPage(page, { x: 320, y: y - 29, width: right - 320, height: 22, borderWidth: 0, font });
    tip(sig, "Signature of applicant");
  }

  // Instructions
  y -= 62;
  page.drawRectangle({ x: left - 8, y: y - 92, width: right - left + 16, height: 108, color: rgb(0.97, 0.97, 0.98) });
  page.drawText("Instructions", { x: left, y, size: 11, font: bold, color: INK });
  const lines = [
    "1. Fill in all fields marked * in BLOCK LETTERS.",
    "2. Attach one proof of address (Aadhaar card copy, electricity bill or ration card) and one passport-size photograph.",
    "3. Senior citizens (60 years or older) pay no annual fee. Others pay Rs. 200 per year at the front desk.",
    "4. Sign the form and hand it in at the front desk: Sunrise Community Library, 12 MG Road, Pune 411001.",
    "   Open Monday to Saturday, 10 am to 6 pm. Your card will be ready in 7 working days.",
  ];
  let ly = y - 16;
  for (const l of lines) {
    page.drawText(l, { x: left, y: ly, size: 9.2, font, color: INK });
    ly -= 14.5;
  }
  page.drawText("FOR OFFICE USE ONLY   Member no: __________   Received by: __________", { x: left, y: 40, size: 8.5, font, color: MUTED });

  return doc.save();
}

writeFileSync(join(OUT, "library-membership-form.pdf"), await build(true));
writeFileSync(join(OUT, "library-membership-form-flat.pdf"), await build(false));
console.log("Wrote public/samples/library-membership-form.pdf and library-membership-form-flat.pdf");
