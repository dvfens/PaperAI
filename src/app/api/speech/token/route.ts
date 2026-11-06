import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, rateLimit, route } from "@/server/http";
import { speechService } from "@/server/services/speech";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Mints a single-use ElevenLabs token for ONE realtime speech-to-text connection. The browser streams
 * microphone audio straight to ElevenLabs with it, so the API key itself never leaves the server.
 * Each token expires after 15 minutes and is consumed by the first connection that uses it.
 */
export const POST = route("speech.token", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "stt-token", 40);
  const token = await speechService().realtimeToken();
  return NextResponse.json({ token, model: "scribe_v2_realtime" }, { headers: { "cache-control": "no-store" } });
});
