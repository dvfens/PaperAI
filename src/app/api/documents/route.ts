import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { RetentionChoice } from "@/lib/types";
import { assertSameOrigin, deviceOwnerHash, formFile, formJson, HttpError, rateLimit, readForm, route } from "@/server/http";
import { errorCode, log } from "@/server/log";
import { approveAndStore, purgeExpired } from "@/server/services/documents";
import { zCategory, zLang } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

const Meta = z.object({
  category: zCategory,
  language: zLang,
  pageCount: z.number().int().min(1).max(50),
  fieldCount: z.number().int().min(0).max(500),
});

/**
 * Save & protect. Requires explicit consent ("consent=yes") — sent only after the person tapped
 * "Save and protect" on the consent screen. Encrypts and stores the PDF, then records the document
 * fingerprint and the consent event on Arkiv.
 */
export const POST = route("documents.approve", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "approve", 10);
  // Retention purge runs after the response (kept alive on serverless via waitUntil); a daily cron also runs it.
  after(() => purgeExpired().then(() => undefined).catch((err) => log.warn("retention.failed", { code: errorCode(err) })));
  const form = await readForm(req, 25_000_000);
  if (form.get("consent") !== "yes") throw new HttpError(400, "consent_required", "Explicit consent is required.");
  const pdf = await formFile(form, "pdf", 20_000_000);
  if (!pdf) throw new HttpError(400, "no_pdf", "Missing PDF.");
  const token = String(form.get("token") ?? "");
  const meta = formJson(form, "meta", Meta);
  const retention = Number(form.get("retentionDays"));
  if (![7, 30, 180].includes(retention)) throw new HttpError(400, "bad_retention", "Invalid retention.");
  const method = form.get("method") === "voice+tap" ? "voice+tap" : "tap";
  const ownerHash = (await deviceOwnerHash(true))!;

  const receipt = await approveAndStore({
    ownerHash,
    pdf,
    token,
    ...meta,
    retentionDays: retention as RetentionChoice,
    consentMethod: method,
  });
  return NextResponse.json(receipt, { status: 201 });
});
