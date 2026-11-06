import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { COSIGN_ROLES, isAddress, isSignatureHex } from "@/lib/signing";
import { assertSameOrigin, rateLimit, readJson, route } from "@/server/http";
import { cosignShared } from "@/server/services/documents";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ token: string }> };

const Body = z.object({
  signer: z.string().refine(isAddress),
  signedAt: z.number().int(),
  method: z.literal("tap"),
  role: z.enum(COSIGN_ROLES),
  signature: z.string().refine(isSignatureHex),
});

/**
 * POST { signer, signedAt, method: "tap", role, signature } — co-sign the shared document. The
 * signature is EIP-712 over the document's SHA-256 (src/lib/signing.ts), made by the co-signer's
 * phone key. Recorded on Arkiv next to the owner's signature. → 201 { role, signedAt, txHash, explorerTxUrl }
 */
export const POST = route("share.cosign", async (req: NextRequest, ctx: Ctx) => {
  assertSameOrigin(req);
  rateLimit(req, "cosign", 10);
  const { token } = await ctx.params;
  const body = await readJson(req, Body, 4_000);
  const result = await cosignShared(token, {
    signer: body.signer as `0x${string}`,
    signedAt: body.signedAt,
    method: body.method,
    role: body.role,
    signature: body.signature as `0x${string}`,
  });
  return NextResponse.json(result, { status: 201 });
});
