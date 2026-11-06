import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit, readJson, route } from "@/server/http";
import { blockchain } from "@/server/services/blockchain";

export const runtime = "nodejs";

const Body = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) });

/**
 * Server-side mirror of the browser's Arkiv check (used when the browser cannot reach Arkiv).
 * Only the fingerprint is sent — never the document.
 */
export const POST = route("verify", async (req: NextRequest) => {
  rateLimit(req, "verify", 30);
  const { sha256 } = await readJson(req, Body, 1000);
  return NextResponse.json(await blockchain().verify(sha256));
});
