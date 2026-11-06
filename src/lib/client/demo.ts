/**
 * Demo mode, for recording a demonstration video: open the app with ?demo=1 (the Acme bank loan
 * form) or ?demo=2 (the National Bank loan application form); ?demo=0 turns it off. It lasts for
 * this browser tab. Every question is really spoken, and the PDF is really made, signed and
 * recorded on Arkiv. Two things are instant instead of waiting on the AI:
 * - Reading the form: a scanned photo is understood at once with a ready-made reading of the chosen
 *   demo form (public/demo/*.json). The real reading still runs in the background, only to place
 *   the answers exactly on this photo (withRealPlacement).
 * - The person's answers: each one appears word by word as if it were being said, and is applied
 *   on the device at once, with no listening and no AI round trip.
 * The presenter records their own voice over it afterwards.
 *
 * Answers are scripted for one fictional person (Ram Kumar Sharma, a retired railway station
 * master in Pune), matched to questions by the field's label. That covers both demo forms and the
 * app's own sample form. A question with no scripted answer is left empty.
 */
import type { DocumentPreviewInfo } from "@/lib/client/api";
import type { LanguageCode } from "@/lib/i18n/languages";
import type { DocumentAnalysis, FormField } from "@/lib/types";

const KEY = "paperai.demo";

// Read ?demo= as soon as the app's code loads (before any screen strips the query string), keep
// the setting for this tab, and take the parameter out of the address bar so it is not in the video.
if (typeof window !== "undefined") {
  try {
    const url = new URL(window.location.href);
    const v = url.searchParams.get("demo");
    if (v !== null) {
      if (v === "0" || v === "off") sessionStorage.removeItem(KEY);
      else sessionStorage.setItem(KEY, v === "2" ? "2" : "1");
      url.searchParams.delete("demo");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  } catch {
    // Storage blocked: demo mode simply stays off.
  }
}

export type DemoForm = "1" | "2";

/** The ready-made reading of each demo form. */
export const DEMO_READINGS: Record<DemoForm, string> = {
  "1": "/demo/bank-loan-form.json",
  "2": "/demo/national-bank-loan-form.json",
};

/** Which demo is on: "1" the Acme bank loan form, "2" the National Bank form; null when off. */
export function demoForm(): DemoForm | null {
  if (typeof window === "undefined") return null;
  try {
    const v = sessionStorage.getItem(KEY);
    return v === "1" || v === "2" ? v : null;
  } catch {
    return null;
  }
}

export function demoEnabled(): boolean {
  return demoForm() !== null;
}

export interface DemoAnswer {
  /** What the person "says" (shown as "You said"). */
  heard: string;
  /** What is written on the form. */
  value: string;
  /** How it is read back. */
  display: string;
}

/** Spoken words in English and Hindi; every other language uses the English ones. */
type Said = { en: string; hi: string };
const pick = (s: Said, lang: LanguageCode) => (lang === "hi" ? s.hi : s.en);

const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  hi: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
};

/** A date the way the form asks for it (MM/DD/YYYY on the loan form, DD/MM/YYYY otherwise). */
function writeDate(field: FormField, d: number, m: number, y: number): string {
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const fmt = `${field.format ?? ""} ${field.label} ${field.hint ?? ""}`;
  if (/mm\s*[/.-]\s*dd/i.test(fmt)) return `${mm}/${dd}/${y}`;
  if (/yyyy\s*[/.-]\s*mm/i.test(fmt)) return `${y}-${mm}-${dd}`;
  return `${dd}/${mm}/${y}`;
}

function dateAnswer(field: FormField, lang: LanguageCode, d: number, m: number, y: number, heard: Said): DemoAnswer {
  return { heard: pick(heard, lang), value: writeDate(field, d, m, y), display: `${d} ${(lang === "hi" ? MONTHS.hi : MONTHS.en)[m - 1]} ${y}` };
}

function option(field: FormField, re: RegExp): string | null {
  return field.options?.find((o) => re.test(o)) ?? null;
}

type Rule = { match: RegExp; answer: (field: FormField, lang: LanguageCode) => DemoAnswer | null };

const say = (en: string, hi: string) => ({ en, hi });
const plain = (heard: Said, value: string, display = value) => (_f: FormField, lang: LanguageCode): DemoAnswer => ({
  heard: pick(heard, lang),
  value,
  display,
});
/** Pick the option matching `re`; a field read as plain text (no options) gets `fallback` written. */
const choose = (re: RegExp, fallback: string, heard: Said) => (f: FormField, lang: LanguageCode): DemoAnswer | null => {
  const o = f.options?.length ? option(f, re) : fallback;
  return o ? { heard: pick(heard, lang), value: o, display: o } : null;
};

// First match wins, so "Date of birth" is caught before the plain "Date" of the application.
const RULES: Rule[] = [
  { match: /birth|\bdob\b/i, answer: (f, l) => dateAnswer(f, l, 13, 3, 1960, say("13 March 1960", "तेरह मार्च उन्नीस सौ साठ")) },
  { match: /full\s*name|^name\b|applicant'?s? name/i, answer: plain(say("Ram Kumar Sharma", "मेरा नाम राम कुमार शर्मा है"), "Ram Kumar Sharma") },
  { match: /phone|mobile/i, answer: plain(say("98765 43210", "नौ आठ सात छह पाँच, चार तीन दो एक शून्य"), "98765 43210") },
  { match: /e-?mail/i, answer: plain(say("ramsharma.pune at gmail dot com", "रामशर्मा डॉट पुणे एट जीमेल डॉट कॉम"), "ramsharma.pune@gmail.com") },
  {
    match: /address/i,
    answer: plain(
      say("Flat 4, Shanti Niwas, 18 Karve Road, Pune 411004", "फ़्लैट चार, शांति निवास, अठारह कर्वे रोड, पुणे चार एक एक शून्य शून्य चार"),
      "Flat 4, Shanti Niwas, 18 Karve Road, Pune 411004",
    ),
  },
  { match: /loan\s*type|type of loan/i, answer: choose(/personal/i, "Personal", say("Personal loan", "पर्सनल लोन")) },
  { match: /amount/i, answer: plain(say("Two lakh rupees", "दो लाख रुपये"), "Rs. 2,00,000") },
  { match: /purpose/i, answer: plain(say("For my knee operation", "घुटने के ऑपरेशन के लिए"), "Medical treatment (knee surgery)") },
  { match: /employer|company|organi[sz]ation/i, answer: plain(say("I retired from Indian Railways", "मैं भारतीय रेलवे से रिटायर हुआ हूँ"), "Indian Railways (retired)") },
  { match: /job|title|designation|occupation|position/i, answer: plain(say("I was a station master", "मैं स्टेशन मास्टर था"), "Station Master (retired)") },
  { match: /income|salary|pension/i, answer: plain(say("My pension is thirty-five thousand a month", "मेरी पेंशन पैंतीस हज़ार रुपये महीना है"), "Rs. 35,000 (pension)") },
  { match: /gender|\bsex\b/i, answer: choose(/^male$/i, "Male", say("Male", "पुरुष")) },
  { match: /language/i, answer: choose(/hindi/i, "Hindi", say("Hindi", "हिंदी")) },
  {
    match: /^date\b|date of application|application date|today/i,
    answer: (f, l) => {
      const now = new Date();
      return dateAnswer(f, l, now.getDate(), now.getMonth() + 1, now.getFullYear(), say("Today's date", "आज की तारीख़"));
    },
  },
];

/** The scripted answer to this question, or null when the script has none (then it is listened to). */
export function demoAnswer(field: FormField, lang: LanguageCode): DemoAnswer | null {
  if (field.type === "checkbox") return { heard: lang === "hi" ? "हाँ" : "Yes", value: "true", display: lang === "hi" ? "हाँ" : "Yes" };
  const label = `${field.label} ${field.labelLocalized ?? ""}`;
  for (const rule of RULES) {
    if (!rule.match.test(label)) continue;
    const a = rule.answer(field, lang);
    if (!a) return null;
    // The form asks for capitals ("BLOCK LETTERS"): write it that way, as the AI would.
    const caps = /block\s*letters|capital/i.test(`${field.format ?? ""} ${field.label}`);
    // "₹" is already printed in the box: write only the amount.
    const rupeePrinted = /₹|\brs\b|rupee/i.test(field.format ?? "");
    const value = rupeePrinted ? a.value.replace(/^Rs\.?\s*/i, "") : a.value;
    return caps ? { ...a, value: value.toUpperCase(), display: a.display.toUpperCase() } : { ...a, value };
  }
  return null;
}

/** The reply to "Is that right?". */
export function demoYes(lang: LanguageCode): string {
  return lang === "hi" ? "हाँ" : "Yes";
}

// --- Instant reading of the demo form ------------------------------------------------------------

export interface DemoReading {
  preview: DocumentPreviewInfo;
  analysis: DocumentAnalysis;
}

/** The ready-made reading of the chosen demo form, in Hindi or (any other language) English. */
export async function demoReading(lang: LanguageCode): Promise<DemoReading | null> {
  const form = demoForm();
  if (!form) return null;
  try {
    const res = await fetch(DEMO_READINGS[form]);
    if (!res.ok) return null;
    const all = (await res.json()) as Record<"en" | "hi", DemoReading>;
    const r = lang === "hi" ? all.hi : all.en;
    // A fresh id, so a late background result can tell this document apart from an earlier one.
    return { ...r, analysis: { ...r.analysis, analysisId: `demo-${Date.now()}` } };
  } catch {
    return null;
  }
}

const labelKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The ready-made reading with each answer's place taken from the real reading of THIS photo, matched
 * by the label printed on the form (the questions, their ids and the answers given stay the same).
 * A field the real reading did not find keeps its ready-made place.
 */
export function withRealPlacement(ready: DocumentAnalysis, real: DocumentAnalysis): DocumentAnalysis {
  const found = new Map(real.fields.map((f) => [labelKey(f.label), f]));
  return {
    ...ready,
    fields: ready.fields.map((f) => {
      const r = found.get(labelKey(f.label));
      if (!r || r.type !== f.type || !r.box) return f;
      return { ...f, box: r.box, optionBoxes: r.optionBoxes ?? f.optionBoxes, mappingConfidence: r.mappingConfidence };
    }),
  };
}
