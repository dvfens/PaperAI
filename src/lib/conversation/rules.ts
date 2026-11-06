/**
 * Offline, rule-based interpreter. Used when Claude is not configured or not reachable.
 * It understands control words (yes / no / repeat / skip / pause / change …) in English and Hindi,
 * and does light, deterministic normalisation of answers. It never guesses a value: the value is
 * always what the person said, cleaned up.
 */
import { t } from "@/lib/i18n";
import type { LanguageCode } from "@/lib/i18n/languages";
import type { ConversationState, FormField, Interpretation } from "@/lib/types";

const KEYWORDS = {
  yes: ["yes", "yeah", "yep", "yup", "correct", "right", "that's right", "ok", "okay", "sure", "haan", "han", "haa", "ha", "ji", "ji haan", "sahi", "sahi hai", "theek", "theek hai", "bilkul", "हाँ", "हां", "हा", "जी", "जी हाँ", "जी हां", "सही", "सही है", "ठीक", "ठीक है", "बिल्कुल", "हाँ जी", "हां जी"],
  no: ["no", "nope", "wrong", "not correct", "incorrect", "nahi", "nahin", "na", "galat", "नहीं", "नही", "ना", "गलत", "ग़लत", "नहीं है", "सही नहीं"],
  repeat: ["repeat", "again", "say again", "say that again", "pardon", "what", "sorry", "dobara", "phir se", "fir se", "kya", "दोबारा", "फिर से", "फिरसे", "क्या", "क्या कहा", "दुबारा"],
  skip: ["skip", "next", "skip it", "leave it", "chhodo", "chhod do", "aage", "छोड़ो", "छोड़ दो", "छोड़िए", "आगे", "अगला"],
  dontKnow: ["don't know", "dont know", "i don't know", "not sure", "no idea", "pata nahi", "maloom nahi", "पता नहीं", "मालूम नहीं", "नहीं पता", "नहीं मालूम"],
  pause: ["pause", "wait", "stop", "hold on", "ruko", "rukiye", "ruk jao", "रुको", "रुकिए", "रुक जाओ", "ठहरो"],
  resume: ["continue", "resume", "go on", "carry on", "chalo", "jaari", "चलो", "जारी", "जारी रखो", "आगे बढ़ो"],
  correct: ["change", "go back", "correct it", "edit", "fix", "badlo", "badalna", "peeche", "बदलो", "बदलना", "बदलिए", "पीछे", "ठीक करो"],
  finish: ["finish", "done", "that's all", "bas", "ho gaya", "बस", "हो गया", "ख़त्म", "खत्म"],
} as const;

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[।.,!?;:"“”'‘’]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function asciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

function matchesAny(utterance: string, words: readonly string[], maxWords = 4): boolean {
  const u = normaliseText(utterance);
  if (!u || u.split(" ").length > maxWords) return false;
  return words.some((w) => u === w || u.startsWith(`${w} `) || u.endsWith(` ${w}`));
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, जनवरी: 1, feb: 2, february: 2, फरवरी: 2, फ़रवरी: 2, mar: 3, march: 3, मार्च: 3,
  apr: 4, april: 4, अप्रैल: 4, may: 5, मई: 5, jun: 6, june: 6, जून: 6, jul: 7, july: 7, जुलाई: 7,
  aug: 8, august: 8, अगस्त: 8, sep: 9, sept: 9, september: 9, सितंबर: 9, सितम्बर: 9,
  oct: 10, october: 10, अक्टूबर: 10, nov: 11, november: 11, नवंबर: 11, नवम्बर: 11,
  dec: 12, december: 12, दिसंबर: 12, दिसम्बर: 12,
};
const MONTH_NAMES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function parseDate(text: string): { day: number; month: number; year: number } | null {
  const s = asciiDigits(normaliseText(text)).replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  let m = s.match(/\b(\d{1,2})[\s/\-.](\d{1,2})[\s/\-.](\d{4})\b/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{4})[\s/\-.](\d{1,2})[\s/\-.](\d{1,2})\b/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  const words = s.split(" ");
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  for (const w of words) {
    if (MONTHS[w] && month === null) month = MONTHS[w];
    else if (/^\d{4}$/.test(w) && year === null) year = +w;
    else if (/^\d{1,2}$/.test(w) && day === null) day = +w;
  }
  if (day && month && year) return valid(day, month, year);
  return null;

  function valid(d: number, mo: number, y: number) {
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    if (y < 1900 || y > 2100) return null;
    return { day: d, month: mo, year: y };
  }
}

function formatDateValue(d: { day: number; month: number; year: number }, format?: string) {
  const dd = String(d.day).padStart(2, "0");
  const mm = String(d.month).padStart(2, "0");
  const f = (format ?? "").toUpperCase();
  if (f.includes("YYYY-MM-DD")) return `${d.year}-${mm}-${dd}`;
  if (f.includes("MM/DD")) return `${mm}/${dd}/${d.year}`;
  if (f.includes("-")) return `${dd}-${mm}-${d.year}`;
  return `${dd}/${mm}/${d.year}`;
}

/** Light deterministic normalisation of an answer for a given field. */
export function normaliseAnswer(field: FormField, raw: string, lang: LanguageCode): Interpretation {
  const base: Interpretation = {
    intent: "answer",
    targetFieldId: field.id,
    value: null,
    display: null,
    valid: true,
    problem: null,
    helpText: null,
  };
  const cleaned = raw.replace(/\s+/g, " ").replace(/[।.]+$/, "").trim();
  if (!cleaned) return { ...base, valid: false, problem: t(lang, "convNotUnderstood") };

  switch (field.type) {
    case "phone": {
      let digits = asciiDigits(cleaned).replace(/\D/g, "");
      if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
      if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
      if (digits.length !== 10) {
        const problem =
          lang === "hi"
            ? `मुझे ${digits.length} अंक सुनाई दिए। मोबाइल नंबर में 10 अंक होते हैं।`
            : `I heard ${digits.length} digits. A mobile number has 10 digits.`;
        return { ...base, valid: false, problem };
      }
      return { ...base, value: digits, display: `${digits.slice(0, 5)} ${digits.slice(5)}` };
    }
    case "number": {
      const digits = asciiDigits(cleaned).replace(/[^\d.]/g, "");
      if (!digits) return { ...base, valid: false, problem: t(lang, "convNotUnderstood") };
      return { ...base, value: digits, display: digits };
    }
    case "email": {
      const email = normaliseText(cleaned)
        .replace(/\s+at the rate\s+|\s+at\s+/g, "@")
        .replace(/\s+dot\s+/g, ".")
        .replace(/\s+/g, "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return { ...base, valid: false, problem: lang === "hi" ? "यह ईमेल पता सही नहीं लगता।" : "That does not look like an email address." };
      }
      return { ...base, value: email, display: email };
    }
    case "date": {
      const d = parseDate(cleaned);
      if (!d) {
        return {
          ...base,
          valid: false,
          problem: lang === "hi" ? "कृपया पूरी तारीख़ बताइए — दिन, महीना और साल।" : "Please tell me the full date — day, month and year.",
        };
      }
      return { ...base, value: formatDateValue(d, field.format), display: `${d.day} ${MONTH_NAMES_EN[d.month - 1]} ${d.year}` };
    }
    case "choice": {
      const options = field.options ?? [];
      const n = normaliseText(cleaned);
      const hit = options.find((o) => n.includes(normaliseText(o)) || normaliseText(o).includes(n));
      if (!hit) {
        return { ...base, valid: false, problem: t(lang, "convChoiceOptions", { options: options.join(", ") }) };
      }
      return { ...base, value: hit, display: hit };
    }
    case "checkbox": {
      if (matchesAny(cleaned, KEYWORDS.yes)) return { ...base, value: "true", display: t(lang, "yes") };
      if (matchesAny(cleaned, KEYWORDS.no)) return { ...base, value: "false", display: t(lang, "no") };
      return { ...base, valid: false, problem: t(lang, "convSaidYesNo") };
    }
    default: {
      const value = field.format?.toUpperCase().includes("BLOCK") ? cleaned.toUpperCase() : cleaned;
      return { ...base, value, display: cleaned };
    }
  }
}

/** Plain yes/no detection for confirmation prompts outside the form conversation. */
/** Whole replies that are nothing but a yes or a no (after normalising punctuation and case). */
const PLAIN_YES = new Set([
  "yes", "yes yes", "yes correct", "yes it is correct", "yes that is correct", "yes that's correct", "yes right",
  "that is correct", "that's correct", "correct", "right", "ok", "okay", "yeah", "haan", "haan ji", "ji haan", "han",
  "bilkul", "sahi hai", "haan sahi hai", "theek hai", "हाँ", "हां", "हाँ हाँ", "हाँ जी", "हां जी", "जी हाँ", "जी हां", "जी",
  "सही है", "हाँ सही है", "हां सही है", "हाँ जी सही है", "हाँ बिल्कुल", "बिल्कुल", "ठीक है", "हाँ ठीक है", "हां ठीक है",
]);
const PLAIN_NO = new Set([
  "no", "no no", "nope", "wrong", "that is wrong", "that's wrong", "no that is wrong", "no it is wrong", "not correct",
  "incorrect", "nahi", "nahin", "galat", "galat hai", "नहीं", "नही", "ना", "नहीं नहीं", "गलत", "ग़लत", "गलत है", "ग़लत है",
  "नहीं गलत है", "नहीं यह गलत है", "यह गलत है", "सही नहीं है", "नहीं सही नहीं है",
]);

/**
 * A reply that is only "yes" or only "no" — no correction, no extra words. Safe to apply without
 * the AI interpreter; anything else (e.g. "no, it's Sharma", "सही नहीं") must go to the interpreter.
 */
export function plainYesNo(text: string): "yes" | "no" | null {
  const u = normaliseText(text);
  if (PLAIN_NO.has(u)) return "no";
  if (PLAIN_YES.has(u)) return "yes";
  return null;
}

export function detectYesNo(text: string): "yes" | "no" | null {
  if (matchesAny(text, KEYWORDS.no, 6)) return "no";
  if (matchesAny(text, KEYWORDS.yes, 6)) return "yes";
  return null;
}

function findFieldMentioned(utterance: string, fields: FormField[]): FormField | null {
  const u = normaliseText(utterance);
  let best: { field: FormField; score: number } | null = null;
  for (const f of fields) {
    if (!f.aiFillable) continue;
    for (const label of [f.label, f.labelLocalized]) {
      const words = normaliseText(label).split(" ").filter((w) => w.length > 2);
      const score = words.filter((w) => u.includes(w)).length;
      if (score > 0 && (!best || score > best.score)) best = { field: f, score };
    }
  }
  return best?.field ?? null;
}

export function interpretWithRules(
  utterance: string,
  state: ConversationState,
  fields: FormField[],
): Interpretation {
  const lang = state.language;
  const none: Interpretation = {
    intent: "unclear",
    targetFieldId: null,
    value: null,
    display: null,
    valid: true,
    problem: null,
    helpText: null,
  };
  const current = fields.find((f) => f.id === (state.pending?.fieldId ?? state.currentFieldId)) ?? null;
  if (!utterance.trim()) return none;

  if (matchesAny(utterance, KEYWORDS.pause, 3)) return { ...none, intent: "pause" };
  if (state.phase === "paused") return { ...none, intent: "resume" };
  if (matchesAny(utterance, KEYWORDS.repeat, 3)) return { ...none, intent: "repeat" };
  if (matchesAny(utterance, KEYWORDS.dontKnow, 5)) return { ...none, intent: "dont_know" };
  if (matchesAny(utterance, KEYWORDS.correct, 6)) {
    const target = findFieldMentioned(utterance, fields);
    return { ...none, intent: "correct", targetFieldId: target?.id ?? null };
  }

  if (state.phase === "confirming") {
    if (matchesAny(utterance, KEYWORDS.no, 2)) return { ...none, intent: "no" };
    if (matchesAny(utterance, KEYWORDS.yes) && !matchesAny(utterance, KEYWORDS.no, 6)) return { ...none, intent: "yes" };
    // Anything longer is treated as a corrected answer for the pending field.
    if (current) return normaliseAnswer(current, utterance, lang);
    return none;
  }

  if (current?.type === "checkbox") {
    if (matchesAny(utterance, KEYWORDS.yes)) return { ...none, intent: "yes" };
    if (matchesAny(utterance, KEYWORDS.no)) return { ...none, intent: "no" };
  }
  if (matchesAny(utterance, KEYWORDS.skip, 3)) return { ...none, intent: "skip" };
  if (matchesAny(utterance, KEYWORDS.finish, 3)) return { ...none, intent: "finish" };
  if (matchesAny(utterance, KEYWORDS.resume, 3)) return { ...none, intent: "resume" };

  if (!current) return none;
  return normaliseAnswer(current, utterance, lang);
}
