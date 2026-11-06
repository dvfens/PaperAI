import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { demoAnswer, withRealPlacement, type DemoReading } from "@/lib/client/demo";
import { applyTurn, initialState } from "@/lib/conversation/engine";
import type { DocumentAnalysis, FormField, Interpretation } from "@/lib/types";

const field = (over: Partial<FormField>): FormField => ({
  id: "f",
  label: "Field",
  labelLocalized: "Field",
  type: "text",
  required: false,
  question: "Q?",
  sensitive: false,
  confirm: false,
  aiFillable: true,
  mappingConfidence: "high",
  ...over,
});

// The bank loan form used in the demo video, as the analysis reads it.
const LOAN: FormField[] = [
  field({ id: "full_name", label: "Full Name", confirm: true }),
  field({ id: "dob", label: "Date of Birth", type: "date", format: "mm/dd/yyyy", confirm: true }),
  field({ id: "phone", label: "Phone Number", type: "phone", confirm: true }),
  field({ id: "email", label: "Email Address", type: "email", confirm: true }),
  field({ id: "address", label: "Residential Address", type: "multiline", confirm: true }),
  field({ id: "loan_type", label: "Loan Type", type: "choice", options: ["Personal", "Mortgage", "Auto", "Business"] }),
  field({ id: "amount", label: "Loan Amount Requested", type: "number", confirm: true }),
  field({ id: "purpose", label: "Loan Purpose" }),
  field({ id: "employer", label: "Employer Name" }),
  field({ id: "job", label: "Job Title" }),
  field({ id: "income", label: "Monthly Income", type: "number", confirm: true }),
  field({ id: "date", label: "Date", type: "date", format: "mm/dd/yyyy" }),
  field({ id: "signature", label: "Signature", type: "signature", aiFillable: false }),
];

const byId = (id: string) => LOAN.find((f) => f.id === id)!;

describe("demo answers", () => {
  it("has an answer for every question on the loan form", () => {
    for (const f of LOAN.filter((x) => x.aiFillable)) assert.ok(demoAnswer(f, "en"), `no demo answer for "${f.label}"`);
  });

  it("writes each answer the way the form asks for it", () => {
    assert.equal(demoAnswer(byId("full_name"), "en")?.value, "Ram Kumar Sharma");
    assert.equal(demoAnswer(byId("dob"), "en")?.value, "03/13/1960"); // mm/dd/yyyy, not the Indian order
    assert.equal(demoAnswer(byId("dob"), "en")?.display, "13 March 1960");
    assert.equal(demoAnswer(byId("email"), "en")?.value, "ramsharma.pune@gmail.com"); // not caught by "address"
    assert.equal(demoAnswer(byId("loan_type"), "en")?.value, "Personal"); // one of the printed options
    assert.equal(demoAnswer(byId("employer"), "en")?.value, "Indian Railways (retired)"); // not caught by "name"
    assert.match(demoAnswer(byId("date"), "en")!.value, /^\d{2}\/\d{2}\/\d{4}$/); // today, not the birth date
    assert.notEqual(demoAnswer(byId("date"), "en")!.value, "03/13/1960");
  });

  it("speaks Hindi in Hindi and capitals where the form asks for them", () => {
    assert.equal(demoAnswer(byId("full_name"), "hi")?.heard, "मेरा नाम राम कुमार शर्मा है");
    assert.equal(demoAnswer(byId("full_name"), "hi")?.value, "Ram Kumar Sharma"); // still written in the form's script
    const sample = field({ label: "Full name (in BLOCK LETTERS)", format: "BLOCK LETTERS" });
    assert.equal(demoAnswer(sample, "en")?.value, "RAM KUMAR SHARMA");
    assert.equal(demoAnswer(field({ label: "Date of birth (DD/MM/YYYY)", type: "date" }), "en")?.value, "13/03/1960");
  });

  it("leaves unknown questions to the microphone", () => {
    assert.equal(demoAnswer(field({ label: "Blood group" }), "en"), null);
  });

  it("fills the whole loan form through the normal conversation engine", () => {
    let state = initialState("en", LOAN);
    for (let turns = 0; state.phase !== "complete" && turns < 40; turns++) {
      const f = LOAN.find((x) => x.id === state.currentFieldId)!;
      const answer = demoAnswer(f, "en")!;
      const interp: Interpretation =
        state.phase === "confirming"
          ? { intent: "yes", targetFieldId: null, value: null, display: null, valid: true, problem: null, helpText: null }
          : { intent: "answer", targetFieldId: null, value: answer.value, display: answer.display, valid: true, problem: null, helpText: null };
      state = applyTurn(state, LOAN, interp, answer.heard, "voice").state;
    }
    assert.equal(state.phase, "complete");
    assert.equal(Object.keys(state.answers).length, 12);
    assert.equal(state.answers.dob.status, "confirmed");
    assert.equal(state.answers.income.value, "Rs. 35,000 (pension)");
  });
});

describe("instant demo reading", () => {
  const ready = JSON.parse(readFileSync("public/demo/bank-loan-form.json", "utf8")) as Record<"en" | "hi", DemoReading>;

  for (const lang of ["en", "hi"] as const) {
    it(`has a scripted answer for every question it asks (${lang})`, () => {
      const asked = ready[lang].analysis.fields.filter((f) => f.aiFillable);
      assert.equal(asked.length, 12);
      for (const f of asked) assert.ok(demoAnswer(f, lang), `no demo answer for "${f.label}" (${lang})`);
      assert.ok(ready[lang].preview.title && ready[lang].analysis.fields.every((f) => f.box));
    });
  }

  it("takes each answer's place from the real reading of the photo, matched by printed label", () => {
    const base = ready.en.analysis;
    const real: DocumentAnalysis = {
      ...base,
      // Another read of a slightly different photo: other ids, shifted boxes, one field missing.
      fields: base.fields
        .filter((f) => f.label !== "Loan Purpose")
        .map((f) => ({ ...f, id: `x_${f.id}`, box: f.box && { ...f.box, y: f.box.y + 0.02 } })),
    };
    const out = withRealPlacement(base, real);
    assert.deepEqual(out.fields.map((f) => f.id), base.fields.map((f) => f.id)); // same questions and answers
    const name = out.fields.find((f) => f.label === "Full Name")!;
    assert.equal(name.box!.y, base.fields.find((f) => f.label === "Full Name")!.box!.y + 0.02);
    const purpose = out.fields.find((f) => f.label === "Loan Purpose")!;
    assert.deepEqual(purpose.box, base.fields.find((f) => f.label === "Loan Purpose")!.box); // kept
  });
});
