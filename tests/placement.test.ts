import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { afterPrintedHint } from "@/server/services/pdfGeneration";

// An A4 page, and text that is 0.5 pt wide per character per point of size (close to the real font).
const page = { getSize: () => ({ width: 595.28, height: 841.89 }) };
const width = (text: string, size: number) => text.length * size * 0.5;
const box = { page: 0, x: 0.4, y: 0.5, w: 0.55, h: 0.05 };

describe("answers start after what is printed at the start of their box", () => {
  it("moves past a printed ₹ sign", () => {
    const out = afterPrintedHint(page, box, { type: "number", format: "₹", label: "Monthly Income :" }, width);
    assert.ok(out.x > box.x && out.x < box.x + box.w * 0.25);
    assert.ok(Math.abs(out.x + out.w - (box.x + box.w)) < 1e-9); // same right edge
  });

  it("moves past a date pattern printed inside the box", () => {
    const out = afterPrintedHint(page, box, { type: "date", format: "DD / MM / YYYY", label: "Date of Birth :" }, width);
    assert.ok(out.x > box.x + 0.1, `x ${out.x}`);
    assert.ok(out.w >= box.w * 0.4);
  });

  it("leaves the box alone when the pattern is part of the label (printed outside the box)", () => {
    const f = { type: "date", format: "DD/MM/YYYY", label: "Date of birth (DD/MM/YYYY) *" };
    assert.deepEqual(afterPrintedHint(page, box, f, width), box);
  });

  it("leaves ordinary fields alone, and never squeezes the answer below 40% of the box", () => {
    assert.deepEqual(afterPrintedHint(page, box, { type: "text", format: "BLOCK LETTERS", label: "Full name" }, width), box);
    assert.deepEqual(afterPrintedHint(page, box, { type: "text", label: "Full name" }, width), box);
    const small = { ...box, w: 0.12 };
    assert.deepEqual(afterPrintedHint(page, small, { type: "date", format: "DD / MM / YYYY", label: "Date" }, width), small);
  });
});
