import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, HttpError, rateLimit, readForm, route } from "@/server/http";
import { speechService } from "@/server/services/speech";
import { zLang } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 45;

/** ElevenLabs Scribe speech-to-text proxy. Audio is forwarded, never stored. */
export const POST = route("speech.stt", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "stt", 60);
  const form = await readForm(req, 10_000_000);
  const lang = zLang.parse(form.get("lang"));
  const audio = form.get("audio");
  if (!audio || typeof audio === "string") throw new HttpError(400, "no_audio", "Missing audio.");
  if (audio.size < 800) return NextResponse.json({ text: "" });
  if (audio.size > 10_000_000) throw new HttpError(413, "too_large", "Recording too long.");
  return NextResponse.json(await speechService().transcribe(audio, lang));
});
