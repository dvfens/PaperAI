import type { SpeechHint } from "@/lib/types";

/** The hint as sent to the server: options only for choice fields, trimmed to keyterm limits. */
export function compactHint(kind: SpeechHint["kind"], options?: string[]): SpeechHint {
  const opts = kind === "choice" ? (options ?? []).filter((o) => o.trim() && o.length <= 50).slice(0, 20) : [];
  return opts.length ? { kind, options: opts } : { kind };
}

/**
 * Words speech recognition should listen for, derived from what is being answered.
 * Only used where the expected words are known (yes/no, the options of a choice): in measurements on
 * noisy Hindi and English answers these helped accuracy without making the model invent answers from
 * background noise, whereas giving the model the question itself did make it invent answers.
 */
const YES_NO = ["yes", "no", "correct", "wrong", "हाँ", "नहीं", "सही", "गलत", "haan", "nahin"];

/** Scribe keyterms: at most 50 characters and 5 words each; the characters < > { } [ ] \ are not allowed. */
export function keytermsFor(hint?: SpeechHint): string[] {
  if (!hint) return [];
  const raw = [
    ...(hint.kind === "yesno" || hint.kind === "checkbox" ? YES_NO : []),
    ...(hint.kind === "choice" ? (hint.options ?? []) : []),
  ];
  const out = new Set<string>();
  for (const t of raw) {
    const term = t.replace(/[<>{}[\]\\]/g, " ").replace(/\s+/g, " ").trim();
    if (term && term.length <= 50 && term.split(" ").length <= 5) out.add(term);
  }
  return [...out].slice(0, 50);
}
