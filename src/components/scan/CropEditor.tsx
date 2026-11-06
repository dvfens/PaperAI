"use client";

import { Check, Maximize, ScanLine } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useApp } from "@/components/app/AppContext";
import type { NormQuad } from "@/lib/client/scanner";

const FULL: NormQuad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Corners still make a convex shape in the right order (so the page can be flattened). */
function convex(q: NormQuad, aspect: number) {
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4];
    const b = q[i];
    const c = q[(i + 1) % 4];
    const cross = (b.x - a.x) * aspect * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) * aspect;
    if (cross <= 0) return false;
  }
  return true;
}

/** Drag the four corners onto the page edges, over the original photo. */
export function CropEditor({
  source,
  initial,
  auto,
  onDone,
}: {
  source: HTMLCanvasElement;
  initial: NormQuad | null;
  auto: NormQuad | null;
  onDone: (quad: NormQuad) => void;
}) {
  const { t } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [quad, setQuad] = useState<NormQuad>(initial ?? auto ?? FULL);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<number | null>(null);

  useEffect(() => {
    let made: string | null = null;
    source.toBlob(
      (b) => {
        if (!b) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      },
      "image/jpeg",
      0.85,
    );
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [source]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Where the photo sits inside the box (object-contain).
  const scale = box.w && box.h ? Math.min(box.w / source.width, box.h / source.height) : 0;
  const iw = source.width * scale;
  const ih = source.height * scale;
  const ox = (box.w - iw) / 2;
  const oy = (box.h - ih) / 2;
  const aspect = source.width / source.height;
  const toScreen = (p: { x: number; y: number }) => ({ x: ox + p.x * iw, y: oy + p.y * ih });

  const moveTo = (i: number, x: number, y: number) => {
    setQuad((q) => {
      const next = q.map((p, k) => (k === i ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : p)) as NormQuad;
      return convex(next, aspect) ? next : q;
    });
  };

  const onPointerDown = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    drag.current = i;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not every pointer can be captured; dragging still works while the finger stays on the circle.
    }
  };
  const onPointerMove = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (drag.current !== i || !boxRef.current || !iw) return;
    const r = boxRef.current.getBoundingClientRect();
    moveTo(i, (e.clientX - r.left - ox) / iw, (e.clientY - r.top - oy) / ih);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 0.02 : 0.005;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    moveTo(i, quad[i].x + d[0], quad[i].y + d[1]);
  };

  const pts = quad.map(toScreen);
  const cornerNames = [t("scan_cornerTL"), t("scan_cornerTR"), t("scan_cornerBR"), t("scan_cornerBL")];

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black text-white">
      <p className="px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-center text-[15px] font-medium">{t("scan_dragCorners")}</p>
      <div ref={boxRef} className="relative mx-4 flex-1 touch-none select-none">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="absolute object-contain" style={{ left: ox, top: oy, width: iw, height: ih }} draggable={false} />
        )}
        {scale > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            <polygon
              points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(59,130,246,0.18)"
              stroke="#3b82f6"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          </svg>
        )}
        {scale > 0 &&
          pts.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={cornerNames[i]}
              onPointerDown={onPointerDown(i)}
              onPointerMove={onPointerMove(i)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKey(i)}
              className="absolute flex size-12 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
              style={{ left: p.x, top: p.y }}
            >
              <span className="block size-6 rounded-full border-[3px] border-blue-500 bg-white shadow-md" />
            </button>
          ))}
      </div>
      <div className="mx-auto grid w-full max-w-md grid-cols-3 gap-2 px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => auto && setQuad(auto)}
          disabled={!auto}
          className="flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-white/15 text-sm font-semibold hover:bg-white/25 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
        >
          <ScanLine className="size-4" aria-hidden /> {t("scan_autoCrop")}
        </button>
        <button
          type="button"
          onClick={() => setQuad(FULL)}
          className="flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-white/15 text-sm font-semibold hover:bg-white/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
        >
          <Maximize className="size-4" aria-hidden /> {t("scan_noCrop")}
        </button>
        <button
          type="button"
          onClick={() => onDone(quad)}
          className="flex min-h-12 items-center justify-center gap-1.5 rounded-full bg-blue-600 text-[15px] font-semibold hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
        >
          <Check className="size-5" aria-hidden /> {t("scan_done")}
        </button>
      </div>
    </div>
  );
}
