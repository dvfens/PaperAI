import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, route } from "@/server/http";
import { resolveShare } from "@/server/services/documents";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ token: string }> };

/** Public metadata for a share link — only whether it is valid, until when, and the fingerprint. */
export const GET = route("share.meta", async (req: NextRequest, ctx: Ctx) => {
  rateLimit(req, "share-view", 30);
  const { token } = await ctx.params;
  const res = await resolveShare(token, false);
  if (!res.valid) return NextResponse.json({ valid: false });
  return NextResponse.json({
    valid: true,
    expiresAt: res.expiresAt,
    sha256: res.row.sha256,
    approvedAt: res.row.approvedAt.toISOString(),
    pageCount: res.row.pageCount,
    arkivChecked: res.arkivChecked,
  });
});
