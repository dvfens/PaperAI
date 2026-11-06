import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, HttpError, rateLimit, readForm, route } from "@/server/http";
import { log } from "@/server/log";
import { speechService } from "@/server/services/speech";
import { parseSpeechHint, zLang } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 45;

/**
 * ElevenLabs Scribe batch speech-to-text: the backup when live streaming is unavailable. Audio is
 * forwarded, never stored; the optional hint (what is being answered) adds keyterms.
 */
export const POST = route("speech.stt", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "stt", 60);
  const form = await readForm(req, 10_000_000);
  const lang = zLang.parse(form.get("lang"));
  const hint = parseSpeechHint(form.get("hint")); // best-effort: a bad hint is ignored, never fatal
  const audio = form.get("audio");
  if (!audio || typeof audio === "string") throw new HttpError(400, "no_audio", "Missing audio.");
  if (audio.size < 800) return NextResponse.json({ text: "" });
  if (audio.size > 10_000_000) throw new HttpError(413, "too_large", "Recording too long.");
  // Which client path sent this (the live stream's backup, or the recorder): metadata only.
  const via = String(form.get("via") ?? "unknown").replace(/[^a-z:-]/g, "").slice(0, 40);
  log.info("stt.batch", { source: via, language: lang, bytes: audio.size, reason: hint?.kind ?? "none" });
  return NextResponse.json(await speechService().transcribe(audio, lang, hint));
});
