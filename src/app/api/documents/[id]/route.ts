import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, deviceOwnerHash, HttpError, route } from "@/server/http";
import { documentReceipt, eraseDocument } from "@/server/services/documents";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function owner() {
  const hash = await deviceOwnerHash(false);
  if (!hash) throw new HttpError(404, "not_found", "Document not found.");
  return hash;
}

/** Receipt for the owner, including the retention date read back from Arkiv. */
export const GET = route("documents.get", async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json(await documentReceipt(id, await owner()));
});

/** Owner-requested secure deletion (crypto-shred + Arkiv entity deletion). */
export const DELETE = route("documents.erase", async (req: NextRequest, ctx: Ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  return NextResponse.json(await eraseDocument(id, await owner()));
});
