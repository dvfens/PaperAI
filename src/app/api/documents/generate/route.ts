import type { NextRequest } from "next/server";
import { generationToken, sha256Hex } from "@/server/crypto";
import { isAddress, isSignMethod, SIGN_FRESH_FOR_PDF_S, signedAtOk } from "@/lib/signing";
import { assertSameOrigin, formFile, formJson, HttpError, publicBaseUrl, rateLimit, readForm, route } from "@/server/http";
import { decodeImageBytes, isPdf } from "@/server/services/image";
import { generateCompletedPdf, type OriginalDocument, type SignatureStamp } from "@/server/services/pdfGeneration";
import { zAnswers, zFields } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST multipart: fields (JSON), answers (JSON) and the original — either `pdf` or page0..page3 images.
 * Optional, when the person signed with a finger: `signature` (PNG), `signer` (their phone key's
 * address), `signedAt` (unix seconds) and `signMethod`. Returns the completed PDF. Nothing is stored. The X-Generation-Token header lets the person later
 * prove (when they choose to save) that this is exactly the PDF Paper AI produced.
 */
export const POST = route("documents.generate", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "generate", 20);
  const form = await readForm(req, 40_000_000);
  const fields = formJson(form, "fields", zFields);
  const answers = formJson(form, "answers", zAnswers);

  let original: OriginalDocument;
  const pdf = await formFile(form, "pdf", 20_000_000);
  if (pdf) {
    if (!isPdf(pdf)) throw new HttpError(400, "not_pdf", "The file is not a PDF.");
    original = { kind: "pdf", bytes: pdf };
  } else {
    const images = [];
    for (let i = 0; i < 4; i++) {
      const bytes = await formFile(form, `page${i}`, 8_000_000);
      if (!bytes) break;
      images.push(decodeImageBytes(bytes));
    }
    if (!images.length) throw new HttpError(400, "no_original", "The original document is missing.");
    original = { kind: "images", images };
  }

  let signature: SignatureStamp | undefined;
  const png = await formFile(form, "signature", 400_000);
  if (png) {
    const signer = String(form.get("signer") ?? "");
    const signedAt = Number(form.get("signedAt"));
    const method = form.get("signMethod");
    const isPng = png.length > 8 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
    if (!isPng || !isAddress(signer) || !isSignMethod(method) || !signedAtOk(signedAt, SIGN_FRESH_FOR_PDF_S)) {
      throw new HttpError(400, "bad_signature", "The signature could not be used.");
    }
    signature = { png, signer, signedAt: new Date(signedAt * 1000), method, verifyUrl: `${publicBaseUrl(req)}/verify` };
  }

  const { bytes, written, skipped, signedBoxes } = await generateCompletedPdf({ original, fields, answers, signature });
  const sha = sha256Hex(bytes);
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="completed-form.pdf"',
      "x-document-sha256": sha,
      "x-generation-token": generationToken(sha, signature?.signer),
      "x-signed-boxes": String(signedBoxes),
      "x-fields-written": String(written),
      "x-fields-skipped": skipped.join(","),
      "cache-control": "no-store",
    },
  });
});
