import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type FieldDraft, findLabel, finaliseFields, overlapShare, resolvePlacement, separateOverlaps } from "@/server/services/formMapping";
import type { OcrLine } from "@/server/services/ocr";
import type { Box } from "@/lib/types";

/** An OCR line from [text, x, width] words, all at the same height. */
function line(id: string, y: number, words: [string, number, number][], h = 0.015): OcrLine {
  const ws = words.map(([text, x, w]) => ({ text, box: { page: 0, x, y, w, h } }));
  const x0 = Math.min(...ws.map((w) => w.box.x));
  const x1 = Math.max(...ws.map((w) => w.box.x + w.box.w));
  return { id, page: 0, text: words.map((w) => w[0]).join(" "), confidence: 90, box: { page: 0, x: x0, y, w: x1 - x0, h }, words: ws };
}

function draft(id: string, label: string, anchorLineId: string | null, placement: FieldDraft["placement"], estimate: FieldDraft["estimate"]): FieldDraft {
  return {
    id,
    label,
    labelLocalized: label,
    type: "text",
    required: false,
    question: `What is your ${label}?`,
    sensitive: false,
    confirm: false,
    aiFillable: true,
    anchorLineId,
    placement,
    page: 0,
    estimate,
  };
}

// A photographed two-column web form: both labels of a row come back as ONE OCR line.
const twoColumn = line("p0-l2", 0.147, [
  ["Full", 0.071, 0.04],
  ["Name", 0.115, 0.05],
  ["*", 0.168, 0.008],
  ["Date", 0.476, 0.042],
  ["of", 0.522, 0.018],
  ["Birth", 0.544, 0.046],
  ["*", 0.594, 0.008],
]);
const lines = new Map([[twoColumn.id, twoColumn]]);
const acro = new Map();

describe("form placement on two-column forms", () => {
  it("finds each label's own words on a shared line", () => {
    const left = findLabel(twoColumn, "Full Name *")!;
    const right = findLabel(twoColumn, "Date of Birth *")!;
    assert.equal(left.start, 0);
    assert.ok(Math.abs(left.nextX! - 0.476) < 1e-9, "the next label on the line bounds the left field");
    assert.equal(right.start, 3);
    assert.equal(right.nextX, null);
  });

  it("puts the right-hand answer under its own label, not into the left-hand box", () => {
    const name = resolvePlacement(draft("full_name", "Full Name *", "p0-l2", "below_label", { x: 0.074, y: 0.17, w: 0.37, h: 0.036 }), lines, acro);
    const dob = resolvePlacement(draft("dob", "Date of Birth *", "p0-l2", "below_label", { x: 0.478, y: 0.163, w: 0.372, h: 0.036 }), lines, acro);
    assert.ok(Math.abs(name.box!.x - 0.071) < 0.01);
    assert.ok(name.box!.x + name.box!.w <= 0.476, "left box stops before the right-hand label");
    assert.ok(Math.abs(dob.box!.x - 0.476) < 0.01, `dob x ${dob.box!.x}`);
    assert.equal(overlapShare(name.box!, dob.box!), 0);
  });

  it("keeps a right-of-label blank between its label and the next label", () => {
    const l = line("p0-l21", 0.7245, [
      ["Date", 0.082, 0.04],
      ["of", 0.126, 0.018],
      ["application:", 0.148, 0.1],
      ["Signature", 0.538, 0.085],
      ["of", 0.627, 0.018],
      ["applicant:", 0.649, 0.062],
    ]);
    const r = resolvePlacement(draft("date", "Date of application", "p0-l21", "right_of_label", { x: 0.245, y: 0.717, w: 0.157, h: 0.02 }), new Map([[l.id, l]]), acro);
    assert.ok(r.box!.x > 0.248 && r.box!.x < 0.27, `x ${r.box!.x}`);
    assert.ok(r.box!.x + r.box!.w <= 0.538, "does not run into the signature label");
    assert.ok(r.box!.w > 0.1, `w ${r.box!.w}`);
  });

  it("treats a misread symbol next to the label as part of the label", () => {
    const l = line("p0-l7", 0.553, [
      ["Monthly", 0.12, 0.07],
      ["Income", 0.195, 0.06],
      ["(2)", 0.259, 0.022],
      ["Employer", 0.525, 0.08],
      ["Name", 0.609, 0.05],
    ]);
    const r = resolvePlacement(draft("income", "Monthly Income (₹)", "p0-l7", "below_label", { x: 0.122, y: 0.577, w: 0.372, h: 0.036 }), new Map([[l.id, l]]), acro);
    assert.ok(r.box!.w > 0.3, `w ${r.box!.w}`);
  });

  it("falls back to the whole line when the label is not on it", () => {
    const r = resolvePlacement(draft("x", "Something else entirely", "p0-l2", "below_label", null), lines, acro);
    assert.ok(Math.abs(r.box!.x - twoColumn.box.x) < 1e-9);
  });
});

describe("overlapping answers", () => {
  const box = (x: number, y: number, w = 0.3, h = 0.03): Box => ({ page: 0, x, y, w, h });

  it("moves a clashing field to its own estimate and asks for a check", () => {
    const placed = [
      { box: box(0.1, 0.2), confidence: "medium" as const },
      { box: box(0.1, 0.2), confidence: "medium" as const },
    ];
    separateOverlaps(placed, [null, box(0.5, 0.2)]);
    assert.equal(placed[0].confidence, "medium");
    assert.deepEqual(placed[1].box, box(0.5, 0.2));
    assert.equal(placed[1].confidence, "low");
  });

  it("marks both for checking when there is nowhere else to put it", () => {
    const placed = [
      { box: box(0.1, 0.2), confidence: "medium" as const },
      { box: box(0.12, 0.2), confidence: "medium" as const },
    ];
    separateOverlaps(placed, [null, box(0.1, 0.21)]);
    assert.equal(placed[0].confidence, "low");
    assert.equal(placed[1].confidence, "low");
  });

  it("never moves an exact fillable-PDF box", () => {
    const placed = [
      { box: box(0.1, 0.2), confidence: "high" as const },
      { box: box(0.1, 0.2), confidence: "high" as const },
    ];
    separateOverlaps(placed, [null, box(0.5, 0.2)]);
    assert.deepEqual(placed[1].box, box(0.1, 0.2));
  });

  it("finaliseFields gives every field of a two-column row its own place", () => {
    const fields = finaliseFields(
      [
        draft("full_name", "Full Name *", "p0-l2", "below_label", { x: 0.074, y: 0.17, w: 0.37, h: 0.036 }),
        draft("dob", "Date of Birth *", "p0-l2", "below_label", { x: 0.478, y: 0.163, w: 0.372, h: 0.036 }),
      ],
      [{ page: 0, text: twoColumn.text, confidence: 90, lines: [twoColumn] }],
      [],
    );
    assert.equal(overlapShare(fields[0].box!, fields[1].box!), 0);
    assert.ok(fields.every((f) => f.mappingConfidence === "medium"));
  });
});
