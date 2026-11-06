"use client";

import { useEffect, useImperativeHandle, useRef, type PointerEvent, type Ref } from "react";

export interface SignaturePadHandle {
  clear(): void;
  /** The signature as a PNG with a transparent background, trimmed to the ink. Null when empty. */
  toPng(): Promise<Blob | null>;
}

type Point = { x: number; y: number };

const INK = "#0f1e6b"; // dark blue, like a ballpoint pen (matches the ink used for answers)
const WIDTH = 2.6; // css px

function drawStroke(ctx: CanvasRenderingContext2D, pts: Point[], scale: number, ox = 0, oy = 0) {
  if (!pts.length) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = WIDTH * scale;
  const p = (q: Point) => ({ x: (q.x - ox) * scale, y: (q.y - oy) * scale });
  if (pts.length === 1) {
    const a = p(pts[0]);
    ctx.beginPath();
    ctx.arc(a.x, a.y, (WIDTH * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Quadratic curves through the midpoints: smooth lines from a jittery finger.
  ctx.beginPath();
  const first = p(pts[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = p(pts[i]);
    const b = p(pts[i + 1]);
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  const last = p(pts[pts.length - 1]);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/**
 * A finger-signature area, like the "sign here" box of an e-signature app. Any mark counts — the same
 * as on paper, where some people sign with a cross.
 */
export function SignaturePad({ ref, label, hint, onInk }: { ref?: Ref<SignaturePadHandle>; label: string; hint: string; onInk: (has: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef<number | null>(null);
  const onInkRef = useRef(onInk);
  useEffect(() => {
    onInkRef.current = onInk;
  });

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes.current) drawStroke(ctx, s, dpr);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    clear() {
      strokes.current = [];
      redraw();
      onInkRef.current(false);
    },
    async toPng() {
      const all = strokes.current.flat();
      if (!all.length) return null;
      const pad = WIDTH * 2;
      const minX = Math.min(...all.map((p) => p.x)) - pad;
      const minY = Math.min(...all.map((p) => p.y)) - pad;
      const maxX = Math.max(...all.map((p) => p.x)) + pad;
      const maxY = Math.max(...all.map((p) => p.y)) + pad;
      // Twice the on-screen size (at most 1200 px wide) so it prints crisply.
      const scale = Math.min(2, 1200 / Math.max(1, maxX - minX));
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.ceil((maxX - minX) * scale));
      out.height = Math.max(1, Math.ceil((maxY - minY) * scale));
      const ctx = out.getContext("2d")!;
      for (const s of strokes.current) drawStroke(ctx, s, scale, minX, minY);
      return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
    },
  }));

  const point = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current !== null) return;
    e.preventDefault();
    drawing.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // fine: the stroke ends if the finger leaves the box
    }
    strokes.current.push([point(e)]);
    redraw();
    onInkRef.current(true);
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current !== e.pointerId) return;
    const stroke = strokes.current[strokes.current.length - 1];
    // Coalesced events give the full path of a fast finger, not just one point per frame.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const r = e.currentTarget.getBoundingClientRect();
    if (events.length) for (const ev of events) stroke.push({ x: ev.clientX - r.left, y: ev.clientY - r.top });
    else stroke.push(point(e));
    redraw();
  };
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current === e.pointerId) drawing.current = null;
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="block h-48 w-full touch-none rounded-xl border-2 border-slate-300 bg-white"
      />
      {/* "Sign here" line, like on paper. */}
      <div className="pointer-events-none absolute inset-x-5 bottom-10 flex items-end gap-2 text-slate-400" aria-hidden>
        <span className="text-lg leading-none">×</span>
        <span className="mb-1 h-px flex-1 bg-slate-300" />
      </div>
      <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-400" aria-hidden>
        {hint}
      </p>
    </div>
  );
}
