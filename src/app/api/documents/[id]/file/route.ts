import type { NextRequest } from "next/server";
import { deviceOwnerHash, HttpError, route } from "@/server/http";
import { readOwnedPdf } from "@/server/services/documents";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Owner download of the decrypted PDF. Authorised by the HttpOnly device cookie. */
export const GET = route("documents.file", async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const ownerHash = await deviceOwnerHash(false);
  if (!ownerHash) throw new HttpError(404, "not_found", "Document not found.");
  const bytes = await readOwnedPdf(id, ownerHash);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": "attachment; filename=\"completed-form.pdf\"",
      "cache-control": "no-store, private",
    },
  });
});
