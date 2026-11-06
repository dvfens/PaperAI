import "server-only";
import { z } from "zod";
import { isEnabledLanguage, type LanguageCode } from "@/lib/i18n/languages";
import { DOCUMENT_CATEGORIES, type SpeechHint } from "@/lib/types";

/** Request validation for every API route. Limits keep payloads small and bounded. */

export const zLang = z.string().refine(isEnabledLanguage, "unsupported language").transform((v) => v as LanguageCode);

/** Which speech engine to use; ElevenLabs when not given (older clients). */
export const zSpeechProvider = z.enum(["elevenlabs", "openai"]).default("elevenlabs");

const s = (max: number) => z.string().max(max);

export const zBox = z.object({
  page: z.number().int().min(0).max(20),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const zField = z.object({
  id: s(80),
  label: s(300),
  labelLocalized: s(300),
  type: z.enum(["text", "multiline", "date", "number", "phone", "email", "checkbox", "choice", "signature", "photo"]),
  required: z.boolean(),
  question: s(600),
  hint: s(400).optional(),
  options: z.array(s(200)).max(40).optional(),
  box: zBox.optional(),
  acroName: s(200).optional(),
  sensitive: z.boolean(),
  confirm: z.boolean(),
  aiFillable: z.boolean(),
  mappingConfidence: z.enum(["high", "medium", "low"]),
  group: s(200).optional(),
  format: s(100).optional(),
  optionBoxes: z.record(s(200), zBox).optional(),
});
export const zFields = z.array(zField).max(200);

/**
 * What kind of answer a recording holds; only steers speech recognition, so it is best-effort:
 * anything malformed is dropped (never rejected) and options are trimmed, not refused.
 */
const zHintKind = z.enum(["text", "multiline", "date", "number", "phone", "email", "checkbox", "choice", "signature", "photo", "yesno"]);
export function parseSpeechHint(raw: unknown): SpeechHint | undefined {
  if (typeof raw !== "string" || !raw || raw.length > 4000) return undefined;
  let value: { kind?: unknown; options?: unknown };
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const kind = zHintKind.safeParse(value?.kind);
  if (!kind.success) return undefined;
  const options = Array.isArray(value.options)
    ? value.options.filter((o): o is string => typeof o === "string" && o.length > 0 && o.length <= 50).slice(0, 20)
    : [];
  return options.length ? { kind: kind.data, options } : { kind: kind.data };
}

export const zAnswer = z.object({
  fieldId: s(80),
  value: s(2000),
  display: s(2000),
  heard: s(2000),
  status: z.enum(["answered", "confirmed", "skipped", "unknown"]),
  source: z.enum(["voice", "typed", "edited"]),
  updatedAt: z.number(),
});
export const zAnswers = z.record(z.string().max(80), zAnswer);

export const zState = z.object({
  language: zLang,
  phase: z.enum(["asking", "confirming", "paused", "complete"]),
  currentFieldId: s(80).nullable(),
  returnToFieldId: s(80).nullable(),
  pending: z.object({ fieldId: s(80), value: s(2000), display: s(2000), heard: s(2000) }).nullable(),
  answers: zAnswers,
  misses: z.number().int().min(0).max(100),
  history: z.array(z.object({ role: z.enum(["assistant", "user"]), text: s(2000), at: z.number() })).max(20),
});

export const zCategory = z.enum(DOCUMENT_CATEGORIES);

export const zAnalysisContext = z.object({
  title: s(300),
  summary: s(2000),
  explanation: z.array(s(1000)).max(12),
  instructions: z.array(s(1000)).max(30),
  requiredDocuments: z.array(s(500)).max(30),
  submission: s(1000).optional(),
  category: zCategory,
  ocrText: s(40000).default(""),
});
