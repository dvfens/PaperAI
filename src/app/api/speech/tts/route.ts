import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, rateLimit, readJson, route } from "@/server/http";
import { speechService } from "@/server/services/speech";
import { zLang, zSpeechProvider } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ text: z.string().min(1).max(1500), lang: zLang, provider: zSpeechProvider });

/** Text-to-speech proxy (ElevenLabs or OpenAI) — the API keys never reach the browser. */
export const POST = route("speech.tts", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "tts", 60);
  const { text, lang, provider } = await readJson(req, Body, 10_000);
  const audio = await speechService(provider).synthesize(text, lang);
  return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
});
