import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, HttpError, rateLimit, route } from "@/server/http";
import { speechService } from "@/server/services/speech";
import { zLang, zSpeechProvider } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 15;

const Body = z.object({ provider: zSpeechProvider, lang: zLang.optional() });

/**
 * Mints a short-lived token for ONE realtime speech-to-text connection (an ElevenLabs single-use
 * token, or an OpenAI client secret for a transcription-only session). The browser streams microphone
 * audio straight to the provider with it, so the API keys never leave the server.
 */
export const POST = route("speech.token", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "stt-token", 40);
  const raw = await req.text();
  if (raw.length > 2000) throw new HttpError(413, "too_large", "Request too large.");
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(raw ? JSON.parse(raw) : {});
  } catch {
    throw new HttpError(400, "invalid_request", "The request was not in the expected format.");
  }
  const token = await speechService(body.provider).realtimeToken(body.lang ?? "en");
  return NextResponse.json({ ...token, provider: body.provider }, { headers: { "cache-control": "no-store" } });
});
