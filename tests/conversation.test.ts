import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyTurn, initialState, nextOpenField } from "@/lib/conversation/engine";
import { detectYesNo, interpretWithRules, normaliseAnswer, parseDate, plainYesNo } from "@/lib/conversation/rules";
import type { ConversationState, FormField } from "@/lib/types";

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

const FIELDS: FormField[] = [
  field({ id: "name", label: "Full name", labelLocalized: "Full name", question: "What is your full name?", required: true, format: "BLOCK LETTERS" }),
  field({ id: "dob", label: "Date of birth", labelLocalized: "Date of birth", type: "date", question: "What is your date of birth?", confirm: true, required: true }),
  field({ id: "mobile", label: "Mobile number", labelLocalized: "Mobile number", type: "phone", question: "Mobile number?", confirm: true }),
  field({ id: "senior", label: "Senior citizen", labelLocalized: "Senior citizen", type: "checkbox", question: "Are you 60 or older?" }),
  field({ id: "sign", label: "Signature", labelLocalized: "Signature", type: "signature", aiFillable: false }),
];

function say(state: ConversationState, text: string) {
  return applyTurn(state, FIELDS, interpretWithRules(text, state, FIELDS), text, "typed");
}

describe("rule-based normalisation", () => {
  it("parses spoken and numeric dates", () => {
    assert.deepEqual(parseDate("12 March 1960"), { day: 12, month: 3, year: 1960 });
    assert.deepEqual(parseDate("12/03/1960"), { day: 12, month: 3, year: 1960 });
    assert.deepEqual(parseDate("१२ मार्च १९६०"), { day: 12, month: 3, year: 1960 });
    assert.equal(parseDate("31 February 1960"), null);
    assert.equal(parseDate("March 1960"), null, "never invents a missing day");
  });

  it("validates Indian mobile numbers without guessing digits", () => {
    const f = FIELDS[2];
    assert.equal(normaliseAnswer(f, "+91 98765 43210", "en").value, "9876543210");
    assert.equal(normaliseAnswer(f, "९८७६५ ४३२१०", "hi").value, "9876543210");
    const bad = normaliseAnswer(f, "98765 4321", "en");
    assert.equal(bad.valid, false);
    assert.equal(bad.value, null);
  });

  it("applies BLOCK LETTERS format rules", () => {
    assert.equal(normaliseAnswer(FIELDS[0], "Ram Kumar", "en").value, "RAM KUMAR");
  });

  it("detects yes / no in English, Hindi and Hinglish", () => {
    assert.equal(detectYesNo("haan ji"), "yes");
    assert.equal(detectYesNo("हाँ सही है"), "yes");
    assert.equal(detectYesNo("nahi"), "no");
    assert.equal(detectYesNo("नहीं"), "no");
    assert.equal(detectYesNo("my name is Ram"), null);
  });
});

describe("conversation engine", () => {
  it("asks one question at a time and skips signature fields", () => {
    const s = initialState("en", FIELDS);
    assert.equal(s.currentFieldId, "name");
    const order: string[] = [];
    let st = s;
    st = say(st, "Ram Kumar").state;
    order.push(st.currentFieldId!);
    assert.deepEqual(order, ["dob"]);
    assert.equal(st.answers.name.value, "RAM KUMAR");
  });

  it("confirms important answers and supports corrections", () => {
    let st = say(initialState("en", FIELDS), "Ram Kumar").state;
    let r = say(st, "12 March 1960");
    assert.equal(r.state.phase, "confirming");
    assert.match(r.reply, /12 March 1960/);
    // "No" with a corrected value → re-confirm the new value
    r = say(r.state, "no, 13 March 1960");
    assert.equal(r.state.phase, "confirming");
    assert.equal(r.state.pending?.value, "13/03/1960");
    r = say(r.state, "yes");
    st = r.state;
    assert.equal(st.answers.dob.status, "confirmed");
    assert.equal(st.answers.dob.value, "13/03/1960");
    assert.equal(st.currentFieldId, "mobile");
  });

  it("never stores an invalid value", () => {
    let st = say(initialState("en", FIELDS), "Ram").state;
    st = say(st, "12 March 1960").state;
    st = say(st, "yes").state;
    const r = say(st, "98765 4321");
    assert.equal(r.state.answers.mobile, undefined);
    assert.equal(r.state.currentFieldId, "mobile");
    assert.match(r.reply, /10 digits/);
  });

  it("handles repeat, pause/resume, skip and tick boxes", () => {
    let st = say(initialState("en", FIELDS), "Ram").state;
    let r = say(st, "repeat");
    assert.equal(r.state.currentFieldId, "dob");
    assert.match(r.reply, /date of birth/i);
    r = say(r.state, "wait");
    assert.equal(r.state.phase, "paused");
    r = say(r.state, "continue");
    assert.equal(r.state.phase, "asking");
    r = say(r.state, "skip");
    assert.equal(r.state.answers.dob.status, "skipped");
    assert.equal(r.state.currentFieldId, "mobile");
    r = say(r.state, "skip");
    st = r.state;
    assert.equal(st.currentFieldId, "senior");
    r = say(st, "haan");
    assert.equal(r.state.answers.senior.value, "true");
    assert.equal(r.state.phase, "complete");
    assert.equal(nextOpenField(r.state, FIELDS), null);
  });

  it("lets the person jump back and change an earlier answer", () => {
    let st = say(initialState("en", FIELDS), "Ram").state;
    st = say(st, "12 March 1960").state;
    st = say(st, "yes").state;
    const r = applyTurn(
      st,
      FIELDS,
      { intent: "correct", targetFieldId: "name", value: null, display: null, valid: true, problem: null, helpText: null },
      "change my name",
      "voice",
    );
    assert.equal(r.state.currentFieldId, "name");
    assert.equal(r.state.returnToFieldId, "mobile");
    const back = say(r.state, "Shyam Lal");
    assert.equal(back.state.answers.name.value, "SHYAM LAL");
    assert.equal(back.state.currentFieldId, "mobile", "returns to where it left off");
  });
});

describe("plainYesNo (on-device confirmation fast path)", () => {
  it("accepts replies that are only a yes or only a no", () => {
    for (const y of ["Yes.", "yes, that is correct", "हाँ, सही है।", "हां जी", "Haan ji", "ठीक है"]) assert.equal(plainYesNo(y), "yes", y);
    for (const n of ["No.", "नहीं", "गलत है", "नहीं, यह गलत है।", "that is wrong"]) assert.equal(plainYesNo(n), "no", n);
  });

  it("refuses negations, corrections and anything with extra words", () => {
    for (const u of ["सही नहीं", "not right", "no, it's Sharma", "yes but the year is 1948", "haan nahi", "नहीं, मेरा नाम सुनीता है", "no wait"]) {
      assert.equal(plainYesNo(u), null, u);
    }
  });
});
