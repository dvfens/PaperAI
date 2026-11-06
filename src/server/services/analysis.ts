import "server-only";
import { randomUUID } from "node:crypto";
import type { LanguageCode } from "@/lib/i18n/languages";
import type { DocumentAnalysis } from "@/lib/types";
import { features } from "@/server/env";
import { log } from "@/server/log";
import { ClaudeUnavailableError } from "./claude";
import { analyseWithClaude } from "./claudeDocument";
import { basicSummary, fieldsFromAcro, fieldsFromOcr, finaliseFields } from "./formMapping";
import type { DecodedImage } from "./image";
import { tryRecognize } from "./ocr";
import { inspectPdf, type PdfInspection } from "./pdfForm";

/**
 * Screen 2 pipeline: OCR → (fillable-field inspection) → Claude understanding → field placement.
 * Falls back to deterministic "basic mode" when Claude is not configured or unavailable, and says so.
 */
export async function analyseDocument(input: {
  lang: LanguageCode;
  images: DecodedImage[];
  pdf: Buffer | null;
}): Promise<DocumentAnalysis> {
  const warnings: string[] = [];
  const inspection: PdfInspection | null = input.pdf ? await inspectPdf(input.pdf) : null;
  if (inspection && input.images.length && inspection.pageCount > input.images.length) {
    warnings.push(`only_first_${input.images.length}_pages`);
  }
  const acro = inspection?.fields ?? [];
  const ocr = input.images.length ? await tryRecognize(input.images) : null;
  if (!ocr && input.images.length) warnings.push("ocr_unavailable");
  const ocrText = (ocr ?? []).map((p) => p.lines.map((l) => l.text).join("\n")).join("\n\n");

  const base = {
    analysisId: randomUUID(),
    language: input.lang,
    pageCount: input.images.length || inspection?.pageCount || 1,
    fillable: acro.length > 0,
    ocrText,
  };

  if (features.claude()) {
    try {
      const { meta, drafts } = await analyseWithClaude({ lang: input.lang, images: input.images, pdf: input.pdf, pageCount: input.images.length || inspection?.pageCount || 1, ocr, acro });
      const fields = finaliseFields(drafts, ocr, acro);
      log.info("analysis.done", { source: "claude", fields: fields.length, pages: base.pageCount, category: meta.category });
      return { ...base, ...meta, source: "claude", fields, warnings };
    } catch (err) {
      if (!(err instanceof ClaudeUnavailableError)) throw err;
      warnings.push(`claude_${err.reason}`);
    }
  }

  const fields = acro.length ? fieldsFromAcro(acro, input.lang) : fieldsFromOcr(ocr ?? [], input.lang);
  const s = basicSummary(input.lang, fields.filter((f) => f.aiFillable).length);
  log.info("analysis.done", { source: "basic", fields: fields.length, pages: base.pageCount });
  return {
    ...base,
    source: "basic",
    category: "other",
    kind: fields.length ? "blank_form" : "other",
    documentLanguage: "en",
    title: s.title,
    summary: s.summary,
    explanation: s.explanation,
    fields,
    instructions: [],
    requiredDocuments: [],
    ambiguities: [],
    warnings,
  };
}
