import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, deviceOwnerHash, HttpError, publicBaseUrl, rateLimit, readJson, route } from "@/server/http";
import { createShareLink, listShareLinks } from "@/server/services/documents";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ hours: z.union([z.literal(1), z.literal(24), z.literal(168)]) });

async function owner() {
  const hash = await deviceOwnerHash(false);
  if (!hash) throw new HttpError(404, "not_found", "Document not found.");
  return hash;
}

export const GET = route("shares.list", async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json({ shares: await listShareLinks(id, await owner()) });
});

/** Create a short-lived share link; its lifetime is recorded (and enforced) as an Arkiv entity expiry. */
export const POST = route("shares.create", async (req: NextRequest, ctx: Ctx) => {
  assertSameOrigin(req);
  rateLimit(req, "share", 10);
  const { id } = await ctx.params;
  const { hours } = await readJson(req, Body, 1000);
  return NextResponse.json(await createShareLink(id, await owner(), hours, publicBaseUrl(req)), { status: 201 });
});
