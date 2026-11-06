import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, formFile, HttpError, rateLimit, readForm, route } from "@/server/http";
import { analyseDocument } from "@/server/services/analysis";
import { decodeImageBytes, isPdf } from "@/server/services/image";
import { zLang } from "@/server/validation";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PAGES = 4;

/**
 * POST multipart: lang, page0..page3 (JPEG/PNG renders of each page) and/or pdf (original PDF).
 * The browser sends both; API clients may send only a PDF (Claude then reads the PDF directly).
 * Nothing is stored: images and text are processed in memory and returned to the browser.
 */
export const POST = route("documents.analyze", async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(req, "analyze", 6);
  const form = await readForm(req, 40_000_000);
  const lang = zLang.parse(form.get("lang"));
  const images = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const bytes = await formFile(form, `page${i}`, 8_000_000);
    if (!bytes) break;
    images.push(decodeImageBytes(bytes));
  }
  const pdf = await formFile(form, "pdf", 20_000_000);
  if (pdf && !isPdf(pdf)) throw new HttpError(400, "not_pdf", "The file is not a PDF.");
  if (!images.length && !pdf) throw new HttpError(400, "no_pages", "Send page images or a PDF.");

  const analysis = await analyseDocument({ lang, images, pdf });
  return NextResponse.json(analysis);
});
