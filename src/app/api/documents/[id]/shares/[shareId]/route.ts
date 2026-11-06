import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, deviceOwnerHash, HttpError, route } from "@/server/http";
import { revokeShareLink } from "@/server/services/documents";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; shareId: string }> };

/** Revoke a share link: blocked in the database at once and its Arkiv grant entity is deleted. */
export const DELETE = route("shares.revoke", async (req: NextRequest, ctx: Ctx) => {
  assertSameOrigin(req);
  const { id, shareId } = await ctx.params;
  const ownerHash = await deviceOwnerHash(false);
  if (!ownerHash) throw new HttpError(404, "not_found", "Document not found.");
  return NextResponse.json(await revokeShareLink(id, shareId, ownerHash));
});
