import type { NextRequest } from "next/server";
import { generationToken, sha256Hex } from "@/server/crypto";
import { assertSameOrigin, formFile, formJson, HttpError, rateLimit, readForm, route } from "@/server/http";
import { decodeImageBytes, isPdf } from "@/server/services/image";
import { generateCompletedPdf, type OriginalDocument } from "@/server/services/pdfGeneration";
import { zAnswers, zFields } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST multipart: fields (JSON), answers (JSON) and the original — either `pdf` or page0..page3 images.
 * Returns the completed PDF. Nothing is stored. The X-Generation-Token header lets the person later
 * prove (when they choose to save) that this is exactly the PDF Saathi produced.
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

  const { bytes, written, skipped } = await generateCompletedPdf({ original, fields, answers });
  const sha = sha256Hex(bytes);
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="completed-form.pdf"',
      "x-document-sha256": sha,
      "x-generation-token": generationToken(sha),
      "x-fields-written": String(written),
      "x-fields-skipped": skipped.join(","),
      "cache-control": "no-store",
    },
  });
});
