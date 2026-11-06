import type { NextRequest } from "next/server";
import { HttpError, rateLimit, route } from "@/server/http";
import { resolveShare } from "@/server/services/documents";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ token: string }> };

/** Recipient download. Re-checks the link (DB + live Arkiv grant) on every request. */
export const GET = route("share.file", async (req: NextRequest, ctx: Ctx) => {
  rateLimit(req, "share-file", 20);
  const { token } = await ctx.params;
  const res = await resolveShare(token, true);
  if (!res.valid) throw new HttpError(410, "link_expired", "This link has expired or was stopped.");
  const bytes = await res.read();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": "attachment; filename=\"shared-document.pdf\"",
      "cache-control": "no-store, private",
      "x-robots-tag": "noindex",
    },
  });
});
