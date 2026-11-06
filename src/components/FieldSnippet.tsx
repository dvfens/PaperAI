"use client";

import type { Box, PageImage } from "@/lib/types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A zoomed-in crop of the form around one field, with the spot(s) where the answer will be written
 * outlined — so people can see on the paper itself which line or box a question is about.
 * For a choice field, pass every option's box (asking) or only the chosen one (confirming).
 *
 * The crop is a readable strip: room for the printed label to the left, the start of the box(es),
 * and a little of the lines above and below.
 */
export function FieldSnippet({ page, boxes, caption }: { page: PageImage; boxes: Box[]; caption: string }) {
  if (!boxes.length) return null;
  const W = page.width || 1;
  const H = page.height || 1;
  // The area to show: all highlighted boxes together.
  const ux = Math.min(...boxes.map((b) => b.x));
  const uy = Math.min(...boxes.map((b) => b.y));
  const uw = Math.max(...boxes.map((b) => b.x + b.w)) - ux;
  const uh = Math.max(...boxes.map((b) => b.y + b.h)) - uy;
  // Horizontal crop (fractions of the page width): room for a printed label to the left, then the
  // start of the area — a long single box does not need to be shown whole. Narrower = bigger text.
  const left = Math.min(0.3, ux);
  const shown = boxes.length > 1 ? uw : Math.min(uw, 0.4);
  // Option buttons have their printed words to the right: leave room for the last one.
  const right = boxes.length > 1 ? 0.1 : 0.04;
  const wc = clamp(left + shown + right, 0.45, 1);
  const x0 = clamp(ux - left, 0, 1 - wc);
  // Vertical crop (fractions of the page height): about a 3:1 strip, never shorter than the area.
  const hc = clamp(Math.max(uh + 0.05, (wc * W * 0.33) / H), 0.04, 1);
  const y0 = clamp(uy - (hc - uh) * 0.6, 0, 1 - hc);
  const pct = (v: number) => `${v * 100}%`;

  return (
    <figure className="w-full">
      <div
        className="relative w-full overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm"
        style={{ aspectRatio: `${wc * W} / ${hc * H}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={page.dataUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute h-auto max-w-none select-none"
          style={{ width: pct(1 / wc), left: pct(-x0 / wc), top: pct(-y0 / hc) }}
        />
        {boxes.map((b, i) => (
          <div
            key={i}
            aria-hidden
            className="absolute rounded-md border-[3px] border-blue-600 bg-blue-500/15 ring-4 ring-blue-500/25"
            style={{
              left: pct((b.x - x0) / wc),
              top: pct((b.y - y0) / hc),
              width: pct(b.w / wc),
              height: pct(Math.max(b.h / hc, 0.12)),
            }}
          />
        ))}
      </div>
      <figcaption className="mt-1.5 text-sm text-slate-600">{caption}</figcaption>
    </figure>
  );
}
