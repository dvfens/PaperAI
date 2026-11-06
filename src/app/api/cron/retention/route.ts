import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { HttpError, route } from "@/server/http";
import { purgeExpired } from "@/server/services/documents";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Retention enforcement for hosted deployments (Vercel Cron calls this daily, see vercel.json):
 * securely deletes stored documents whose retention period has ended. Vercel sends
 * "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET environment variable is set.
 */
export const GET = route("cron.retention", async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const ok =
    secret.length >= 16 &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) throw new HttpError(401, "unauthorized", "Unauthorized.");
  const purged = await purgeExpired(true);
  return NextResponse.json({ purged });
});
