import { NextResponse, type NextRequest } from "next/server";
import { features } from "@/server/env";
import { assertSameOrigin, formFile, HttpError, rateLimit, readForm, route } from "@/server/http";
import { ClaudeUnavailableError } from "@/server/services/claude";
import { summariseWithClaude } from "@/server/services/claudeDocument";
import { decodeImageBytes } from "@/server/services/image";
import { zLang } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Stage 1 of understanding: a quick "what is this document" so the person hears an explanation
 * within seconds. Runs in parallel with /api/documents/analyze. Returns { available: false } when
 * Claude is not configured — the app then waits for the full (basic-mode) analysis instead.
 */
export const POST = route("documents.summary", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "summary", 6);
  if (!features.claude()) return NextResponse.json({ available: false });
  const form = await readForm(req, 40_000_000);
  const lang = zLang.parse(form.get("lang"));
  const images = [];
  for (let i = 0; i < 4; i++) {
    const bytes = await formFile(form, `page${i}`, 8_000_000);
    if (!bytes) break;
    images.push(decodeImageBytes(bytes));
  }
  if (!images.length) throw new HttpError(400, "no_pages", "No page images were sent.");
  try {
    const summary = await summariseWithClaude({ lang, images });
    return NextResponse.json({ available: true, ...summary });
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) return NextResponse.json({ available: false });
    throw err;
  }
});
