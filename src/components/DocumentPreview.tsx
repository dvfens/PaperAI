"use client";

import type { Box, PageImage } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Highlight {
  box: Box;
  tone: "sign" | "warning" | "missing" | "info";
  label?: string;
}

const TONES: Record<Highlight["tone"], string> = {
  sign: "border-blue-600 bg-blue-500/15",
  warning: "border-amber-500 bg-amber-400/20",
  missing: "border-red-600 bg-red-500/10",
  info: "border-slate-500 bg-slate-400/10",
};

const LABEL_TONES: Record<Highlight["tone"], string> = {
  sign: "bg-blue-700 text-white",
  warning: "bg-amber-500 text-black",
  missing: "bg-red-700 text-white",
  info: "bg-slate-700 text-white",
};

/** Page images with optional highlighted regions (where to sign, uncertain placements, missing answers). */
export function DocumentPreview({
  pages,
  highlights = [],
  alt,
  maxPages,
  className,
}: {
  pages: PageImage[];
  highlights?: Highlight[];
  alt: string;
  maxPages?: number;
  className?: string;
}) {
  const shown = maxPages ? pages.slice(0, maxPages) : pages;
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {shown.map((page, i) => (
        <figure key={i} className="relative overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.dataUrl} alt={`${alt} — ${i + 1}`} className="block h-auto w-full" draggable={false} />
          {highlights
            .filter((h) => h.box.page === i)
            .map((h, j) => (
              <div
                key={j}
                className={cn("pointer-events-none absolute rounded border-2", TONES[h.tone])}
                style={{
                  left: `${h.box.x * 100}%`,
                  top: `${h.box.y * 100}%`,
                  width: `${h.box.w * 100}%`,
                  height: `${Math.max(h.box.h * 100, 1.5)}%`,
                }}
              >
                {h.label && (
                  <span
                    className={cn(
                      "absolute -top-7 left-0 whitespace-nowrap rounded-md px-2 py-0.5 text-sm font-semibold",
                      LABEL_TONES[h.tone],
                    )}
                  >
                    {h.label}
                  </span>
                )}
              </div>
            ))}
        </figure>
      ))}
    </div>
  );
}
