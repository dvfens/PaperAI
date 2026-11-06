/**
 * Shared domain types used by both the browser and the server.
 * Nothing in here may import server-only modules.
 */
import type { LanguageCode } from "@/lib/i18n/languages";

/** Normalised rectangle on a page: origin top-left, all values 0..1 of the page size. */
export interface Box {
  page: number; // zero-based page index
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FieldType =
  | "text"
  | "multiline"
  | "date"
  | "number"
  | "phone"
  | "email"
  | "checkbox"
  | "choice"
  | "signature"
  | "photo";

export type MappingConfidence = "high" | "medium" | "low";

/**
 * What kind of answer is expected, so speech recognition listens for the right words. Deliberately
 * holds no question text: while confirming, the question contains the person's answer.
 */
export interface SpeechHint {
  /** "yesno" while confirming an answer; otherwise the type of the field being filled. */
  kind?: FieldType | "yesno";
  /** Allowed answers of a choice field. */
  options?: string[];
}

export interface FormField {
  id: string;
  /** Label exactly as printed on the form. */
  label: string;
  /** Label translated/simplified into the user's language. */
  labelLocalized: string;
  type: FieldType;
  required: boolean;
  /** The question Saathi asks, in the user's language. One question per field. */
  question: string;
  /** Short helpful hint in the user's language, e.g. "10 digit mobile number". */
  hint?: string;
  /** Allowed values for choice fields, as printed on the form. */
  options?: string[];
  /** Where the answer is written on the page. */
  box?: Box;
  /** Name of the AcroForm field when the PDF is fillable. */
  acroName?: string;
  /** Sensitive values (ID numbers, bank details) are masked in the final read-back. */
  sensitive: boolean;
  /** Read the answer back and ask for confirmation before moving on. */
  confirm: boolean;
  /** False for signatures, photos and thumbprints — the person must do these by hand. */
  aiFillable: boolean;
  /** How confident we are about where this answer goes on the page. */
  mappingConfidence: MappingConfidence;
  /** Optional grouping, e.g. a table row "Family member 1". */
  group?: string;
  /** Formatting rule printed on the form, e.g. "DD/MM/YYYY" or "BLOCK LETTERS". */
  format?: string;
  /** For printed tick-box choices ("[ ] Male [ ] Female"): where to tick each option. */
  optionBoxes?: Record<string, Box>;
}

export const DOCUMENT_CATEGORIES = [
  "bank",
  "government",
  "pension",
  "health",
  "education",
  "utility",
  "insurance",
  "employment",
  "membership",
  "legal",
  "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_KINDS = ["blank_form", "instructions", "filled_document", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type AnalysisSource = "claude" | "basic";

export interface DocumentAnalysis {
  analysisId: string;
  /** "claude" when Claude analysed the document, "basic" for the offline rule-based fallback. */
  source: AnalysisSource;
  language: LanguageCode;
  category: DocumentCategory;
  kind: DocumentKind;
  /** Short title in the user's language, e.g. "Library membership form". */
  title: string;
  /** One or two sentence plain-language summary in the user's language. */
  summary: string;
  /** 3–6 short sentences explaining the document, in the user's language. */
  explanation: string[];
  fields: FormField[];
  /** Instructions found on the document, simplified, in the user's language. */
  instructions: string[];
  /** Supporting documents the form asks for, in the user's language. */
  requiredDocuments: string[];
  /** Where/how to submit, if the document says so. */
  submission?: string;
  /** Things that were unclear or could not be read. */
  ambiguities: string[];
  pageCount: number;
  /** ISO 639-1 code of the language the form is printed in; answers are written in its script. */
  documentLanguage: string;
  fillable: boolean;
  /** Plain text read from the document (OCR or PDF text). Kept in the browser only. */
  ocrText: string;
  warnings: string[];
}

export type AnswerStatus = "answered" | "confirmed" | "skipped" | "unknown";
export type AnswerSource = "voice" | "typed" | "edited";

export interface FieldAnswer {
  fieldId: string;
  /** Value exactly as it will be written on the form. */
  value: string;
  /** Natural read-back text in the user's language, e.g. "12 March 1960". */
  display: string;
  /** What the person actually said. */
  heard: string;
  status: AnswerStatus;
  source: AnswerSource;
  updatedAt: number;
}

export type ConversationPhase = "asking" | "confirming" | "paused" | "complete";

export interface PendingAnswer {
  fieldId: string;
  value: string;
  display: string;
  heard: string;
}

export interface ConversationTurn {
  role: "assistant" | "user";
  text: string;
  at: number;
}

export interface ConversationState {
  language: LanguageCode;
  phase: ConversationPhase;
  currentFieldId: string | null;
  /** Field to go back to after a correction detour. */
  returnToFieldId: string | null;
  pending: PendingAnswer | null;
  answers: Record<string, FieldAnswer>;
  /** Number of consecutive misunderstood turns on the current question. */
  misses: number;
  history: ConversationTurn[];
}

export type Intent =
  | "answer"
  | "yes"
  | "no"
  | "repeat"
  | "skip"
  | "dont_know"
  | "pause"
  | "resume"
  | "correct"
  | "help"
  | "finish"
  | "unclear";

/** What the language model (or the rule-based fallback) understood from one utterance. */
export interface Interpretation {
  intent: Intent;
  /** For "correct": the field the person wants to change. For "answer": usually the current field. */
  targetFieldId: string | null;
  /** Value ready to be written on the form (normalised, in the form's script). */
  value: string | null;
  /** How to read the value back in the user's language. */
  display: string | null;
  /** False when the value is clearly invalid for the field (e.g. 9 digit phone number). */
  valid: boolean;
  /** Short, kind explanation of the problem, in the user's language. */
  problem: string | null;
  /** Answer to a question the person asked about the field, in the user's language. */
  helpText: string | null;
}

export interface TurnResult {
  state: ConversationState;
  reply: string;
  interpretation: Interpretation;
  interpretedBy: AnalysisSource;
}

export interface GuideStep {
  kind: "sign" | "attach" | "submit" | "check" | "info";
  title: string;
  detail: string;
  /** Location on the completed document, for "sign" steps. */
  box?: Box;
}

export interface NextStepsGuide {
  source: AnalysisSource;
  intro: string;
  steps: GuideStep[];
  /** Always states that Saathi has not submitted the form anywhere. */
  notSubmittedNotice: string;
}

/** Page images produced in the browser (camera frame, image upload, or rendered PDF page). */
export interface PageImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Cloud speech engines the person can switch between (recognition and voice separately). */
export type SpeechProvider = "elevenlabs" | "openai";

/** Which speaking voice: a friendly young woman (default), a young man, or the calm older voice. */
export type VoiceStyle = "young-woman" | "young-man" | "calm";
export const VOICE_STYLES: VoiceStyle[] = ["young-woman", "young-man", "calm"];

export interface ServiceStatus {
  claude: boolean;
  elevenlabs: boolean;
  openai: boolean;
  arkiv: { configured: boolean; writerAddress: string | null; chainId: number; explorerUrl: string };
  database: "postgres" | "pglite" | "pglite-ephemeral";
  demoTools: boolean;
}

export type RetentionChoice = 7 | 30 | 180;

export interface CommitmentReceipt {
  documentId: string;
  sha256: string;
  approvedAt: string;
  retentionUntil: string;
  stored: boolean;
  arkiv:
    | {
        status: "recorded";
        commitmentKey: string;
        consentKey: string;
        txHash: string;
        expiresAtBlock: string;
        explorerTxUrl: string;
      }
    | { status: "not_configured" }
    | { status: "failed"; reason: string };
}

/** A form this device saved and can still open ("My forms"). No personal data: the title stays on the device. */
export interface SavedForm extends CommitmentReceipt {
  category: DocumentCategory;
  language: string;
  pageCount: number;
}

export interface VerificationEvent {
  kind: "approved" | "stored" | "shared" | "share_revoked" | "erased" | "other";
  at: number; // unix seconds
  entityKey: string;
  detail?: string;
}

export interface VerificationResult {
  sha256: string;
  status: "match" | "no_match" | "unavailable";
  commitment?: {
    entityKey: string;
    approvedAt: number;
    category: string;
    language: string;
    expiresAtBlock: string;
    expiresAtEstimate: string | null;
    readonly: boolean;
    creator: string;
  };
  history: VerificationEvent[];
  checkedAgainst: "arkiv" | "none";
  message?: string;
}
