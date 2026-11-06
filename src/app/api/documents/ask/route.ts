import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { t } from "@/lib/i18n";
import { features } from "@/server/env";
import { assertSameOrigin, rateLimit, readJson, route } from "@/server/http";
import { ClaudeUnavailableError } from "@/server/services/claude";
import { answerQuestionWithClaude } from "@/server/services/claudeDocument";
import { zAnalysisContext, zFields, zLang } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  lang: zLang,
  question: z.string().min(1).max(1000),
  analysis: zAnalysisContext,
  fields: zFields,
});

/** Answer a spoken question about the document, in simple language. */
export const POST = route("documents.ask", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "ask", 20);
  const body = await readJson(req, Body, 600_000);
  if (features.claude()) {
    try {
      const answer = await answerQuestionWithClaude(body);
      return NextResponse.json({ answer, source: "claude" });
    } catch (err) {
      if (!(err instanceof ClaudeUnavailableError)) throw err;
    }
  }
  // Without Claude we cannot answer free-form questions honestly — say so.
  const answer =
    body.lang === "hi"
      ? "माफ़ कीजिए, अभी मैं इस कागज़ के बारे में सवालों के जवाब नहीं दे सकता। " + t(body.lang, "basicMode")
      : "Sorry, I can't answer questions about this document right now. " + t(body.lang, "basicMode");
  return NextResponse.json({ answer, source: "basic" });
});
