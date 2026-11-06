import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, rateLimit, readJson, route } from "@/server/http";
import { conversationTurn } from "@/server/services/conversation";
import { zFields, zState } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  state: zState,
  fields: zFields,
  utterance: z.string().max(2000),
  formLang: z.string().max(10).default("en"),
  source: z.enum(["voice", "typed"]).default("voice"),
});

/**
 * One conversational turn. Stateless on the server: the conversation state (including answers)
 * lives in the person's browser and is never persisted or logged here.
 */
export const POST = route("conversation.turn", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "turn", 60);
  const body = await readJson(req, Body, 400_000);
  const result = await conversationTurn(body);
  return NextResponse.json(result);
});
