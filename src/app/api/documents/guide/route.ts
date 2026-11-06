import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { t } from "@/lib/i18n";
import type { LanguageCode } from "@/lib/i18n/languages";
import type { FormField, GuideStep, NextStepsGuide } from "@/lib/types";
import { features } from "@/server/env";
import { assertSameOrigin, rateLimit, readJson, route } from "@/server/http";
import { ClaudeUnavailableError } from "@/server/services/claude";
import { guideWithClaude } from "@/server/services/claudeDocument";
import { zAnalysisContext, zAnswers, zFields, zLang } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ lang: zLang, analysis: zAnalysisContext, fields: zFields, answers: zAnswers });

function where(box: FormField["box"], lang: LanguageCode) {
  if (!box) return "";
  const pos = box.y > 0.66 ? (lang === "hi" ? "नीचे" : "bottom") : box.y > 0.33 ? (lang === "hi" ? "बीच में" : "middle") : lang === "hi" ? "ऊपर" : "top";
  return lang === "hi" ? `पन्ना ${box.page + 1}, ${pos}।` : `Page ${box.page + 1}, near the ${pos}.`;
}

/** Deterministic guide built only from what the analysis found (used without Claude). */
function basicGuide(lang: LanguageCode, body: z.infer<typeof Body>, missing: FormField[]): NextStepsGuide {
  const hi = lang === "hi";
  const steps: GuideStep[] = [];
  for (const f of body.fields.filter((f) => f.type === "signature")) {
    steps.push({ kind: "sign", title: hi ? `यहाँ हस्ताक्षर करें: ${f.label}` : `Sign here: ${f.label}`, detail: where(f.box, lang), box: f.box });
  }
  if (missing.length) {
    steps.push({
      kind: "check",
      title: hi ? "खाली खाने भरें" : "Fill the empty boxes",
      detail: missing.map((f) => f.labelLocalized || f.label).join(", "),
    });
  }
  for (const d of body.analysis.requiredDocuments) steps.push({ kind: "attach", title: hi ? "साथ लगाएँ" : "Attach", detail: d });
  for (const i of body.analysis.instructions) steps.push({ kind: "info", title: hi ? "ध्यान दें" : "Note", detail: i });
  steps.push({
    kind: "submit",
    title: hi ? "जमा करें" : "Hand it in",
    detail:
      body.analysis.submission ??
      (hi ? "जिस दफ़्तर से यह फ़ॉर्म मिला था, वहीं पूछिए कि इसे कहाँ जमा करना है।" : "Ask the office that gave you this form where to hand it in."),
  });
  return {
    source: "basic",
    intro: hi ? "आपका फ़ॉर्म तैयार है। आगे ये करना है:" : "Your form is ready. Here is what to do next:",
    steps,
    notSubmittedNotice: t(lang, "notSubmitted"),
  };
}

export const POST = route("documents.guide", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "guide", 20);
  const body = await readJson(req, Body, 600_000);
  const missing = body.fields.filter(
    (f) => f.aiFillable && f.required && !["answered", "confirmed"].includes(body.answers[f.id]?.status ?? ""),
  );
  if (features.claude()) {
    try {
      const g = await guideWithClaude({
        lang: body.lang,
        analysis: body.analysis,
        signatureFields: body.fields.filter((f) => f.type === "signature"),
        missingRequired: missing.map((f) => f.label),
      });
      const guide: NextStepsGuide = {
        source: "claude",
        intro: g.intro,
        steps: g.steps.map(({ fieldId: _f, ...s }) => s),
        notSubmittedNotice: t(body.lang, "notSubmitted"),
      };
      return NextResponse.json(guide);
    } catch (err) {
      if (!(err instanceof ClaudeUnavailableError)) throw err;
    }
  }
  return NextResponse.json(basicGuide(body.lang, body, missing));
});
