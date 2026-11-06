"use client";

import type {
  AnswerSource,
  CommitmentReceipt,
  ConversationState,
  DocumentAnalysis,
  FieldAnswer,
  FormField,
  NextStepsGuide,
  RetentionChoice,
  SavedForm,
  ServiceStatus,
  TurnResult,
  SpeechHint,
  SpeechProvider,
  VerificationResult,
  VoiceStyle,
} from "@/lib/types";
import type { LanguageCode } from "@/lib/i18n/languages";
import type { SignatureProof, SignMethod } from "@/lib/signing";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  let code = "error";
  let message = res.statusText;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    // not JSON
  }
  throw new ApiError(res.status, code, message);
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "network", "Network error");
  }
  await check(res);
  return (await res.json()) as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Stage-1 understanding: what the document is, available before the fields are extracted. */
export type DocumentPreviewInfo = Pick<DocumentAnalysis, "title" | "summary" | "explanation" | "category" | "kind">;

export type AnalysisContext = Pick<
  DocumentAnalysis,
  "title" | "summary" | "explanation" | "instructions" | "requiredDocuments" | "submission" | "category" | "ocrText"
>;

export function analysisContext(a: DocumentAnalysis): AnalysisContext {
  return {
    title: a.title,
    summary: a.summary,
    explanation: a.explanation,
    instructions: a.instructions,
    requiredDocuments: a.requiredDocuments,
    submission: a.submission,
    category: a.category,
    ocrText: a.ocrText.slice(0, 40000),
  };
}

export const api = {
  health: () => json<ServiceStatus>("/api/health"),

  analyze: (lang: LanguageCode, pages: Blob[], pdf: Blob | null) => {
    const form = new FormData();
    form.set("lang", lang);
    pages.forEach((p, i) => form.set(`page${i}`, p, `page${i}.jpg`));
    if (pdf) form.set("pdf", pdf, "document.pdf");
    return json<DocumentAnalysis>("/api/documents/analyze", { method: "POST", body: form });
  },

  summary: (lang: LanguageCode, pages: Blob[]) => {
    const form = new FormData();
    form.set("lang", lang);
    pages.forEach((p, i) => form.set(`page${i}`, p, `page${i}.jpg`));
    return json<{ available: false } | ({ available: true } & DocumentPreviewInfo)>("/api/documents/summary", { method: "POST", body: form });
  },

  turn: (state: ConversationState, fields: FormField[], utterance: string, formLang: string, source: AnswerSource) =>
    json<TurnResult>("/api/conversation/turn", post({ state, fields, utterance, formLang, source })),

  ask: (lang: LanguageCode, question: string, analysis: DocumentAnalysis) =>
    json<{ answer: string; source: string }>(
      "/api/documents/ask",
      post({ lang, question, analysis: analysisContext(analysis), fields: analysis.fields }),
    ),

  generate: async (
    fields: FormField[],
    answers: Record<string, FieldAnswer>,
    original: { pdf: Blob | null; pages: Blob[] },
    /** The person's finger signature, drawn into the form with a signature record page. */
    signing?: { png: Blob; signer: string; signedAt: number; method: SignMethod },
  ) => {
    const form = new FormData();
    form.set("fields", JSON.stringify(fields));
    form.set("answers", JSON.stringify(answers));
    if (original.pdf) form.set("pdf", original.pdf, "original.pdf");
    else original.pages.forEach((p, i) => form.set(`page${i}`, p, `page${i}.jpg`));
    if (signing) {
      form.set("signature", signing.png, "signature.png");
      form.set("signer", signing.signer);
      form.set("signedAt", String(signing.signedAt));
      form.set("signMethod", signing.method);
    }
    let res: Response;
    try {
      res = await fetch("/api/documents/generate", { method: "POST", body: form, credentials: "same-origin" });
    } catch {
      throw new ApiError(0, "network", "Network error");
    }
    await check(res);
    return {
      bytes: await res.arrayBuffer(),
      sha256: res.headers.get("x-document-sha256") ?? "",
      token: res.headers.get("x-generation-token") ?? "",
      skipped: (res.headers.get("x-fields-skipped") ?? "").split(",").filter(Boolean),
      signedBoxes: Number(res.headers.get("x-signed-boxes") ?? 0),
    };
  },

  guide: (lang: LanguageCode, analysis: DocumentAnalysis, answers: Record<string, FieldAnswer>) =>
    json<NextStepsGuide>("/api/documents/guide", post({ lang, analysis: analysisContext(analysis), fields: analysis.fields, answers })),

  approve: (input: {
    pdf: Blob;
    token: string;
    meta: { category: string; language: LanguageCode; pageCount: number; fieldCount: number };
    retentionDays: RetentionChoice;
    method: "voice+tap" | "tap";
    signature?: SignatureProof;
  }) => {
    const form = new FormData();
    form.set("pdf", input.pdf, "completed.pdf");
    form.set("token", input.token);
    form.set("meta", JSON.stringify(input.meta));
    form.set("retentionDays", String(input.retentionDays));
    form.set("method", input.method);
    form.set("consent", "yes");
    if (input.signature) {
      form.set("signer", input.signature.signer);
      form.set("signedAt", String(input.signature.signedAt));
      form.set("signMethod", input.signature.method);
      form.set("signature", input.signature.signature);
    }
    return json<CommitmentReceipt>("/api/documents", { method: "POST", body: form });
  },

  myForms: () => json<{ forms: SavedForm[] }>("/api/documents").then((r) => r.forms),

  receipt: (id: string) => json<CommitmentReceipt & { arkivExpiry: string | null; erased: boolean }>(`/api/documents/${id}`),

  erase: (id: string) => json<{ erased: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),

  createShare: (id: string, hours: 1 | 24 | 168) =>
    json<{ shareId: string; url: string; expiresAt: string; arkiv: { txHash: string | null; explorerTxUrl: string | null } | null }>(
      `/api/documents/${id}/shares`,
      post({ hours }),
    ),

  revokeShare: (id: string, shareId: string) =>
    json<{ revoked: boolean }>(`/api/documents/${id}/shares/${shareId}`, { method: "DELETE" }),

  verify: (sha256: string) => json<VerificationResult>("/api/verify", post({ sha256 })),

  tts: async (text: string, lang: LanguageCode, provider: SpeechProvider = "elevenlabs", voice?: VoiceStyle): Promise<Blob> => {
    const res = await check(await fetch("/api/speech/tts", post({ text, lang, provider, voice })));
    return res.blob();
  },

  stt: (audio: Blob, lang: LanguageCode, hint?: SpeechHint, via = "unknown", provider: SpeechProvider = "elevenlabs") => {
    const form = new FormData();
    form.set("provider", provider);
    if (hint) form.set("hint", JSON.stringify(hint));
    form.set("via", via);
    const ext = /wav/.test(audio.type) ? "wav" : /mp4|aac/.test(audio.type) ? "m4a" : /ogg/.test(audio.type) ? "ogg" : "webm";
    form.set("audio", audio, `speech.${ext}`);
    form.set("lang", lang);
    return json<{ text: string }>("/api/speech/stt", { method: "POST", body: form });
  },

  /** Single-use token for one realtime transcription socket (the API key stays on the server). */
  sttToken: (provider: SpeechProvider, lang: LanguageCode) =>
    json<{ token: string; model: string; expiresAt: number | null }>("/api/speech/token", post({ provider, lang })),
};

export function errorKey(err: unknown): "errorNetwork" | "errorBusy" | "errorTooBig" | "errorFileType" | "errorGeneric" {
  if (err instanceof ApiError) {
    if (err.status === 0) return "errorNetwork";
    if (err.status === 429) return "errorBusy";
    if (err.status === 413) return "errorTooBig";
    if (err.code === "not_pdf" || err.code === "bad_image") return "errorFileType";
  }
  return "errorGeneric";
}
