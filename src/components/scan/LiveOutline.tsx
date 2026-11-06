"use client";

import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { findPage, LIVE_EDGE, type NormQuad } from "@/lib/client/scanner";

export type TrackState = "searching" | "found" | "steady";

/** How often a frame is analysed (each analysis takes ~10–60 ms depending on the phone). */
const TICK_MS = 140;
/** Analyses in a row with the page not moving before it counts as steady (~0.7 s). */
const STEADY_TICKS = 5;
/** Corner movement between analyses (share of the frame) still counted as "not moving". */
const STILL = 0.012;
/** Bigger jumps are a different page (or a mistake), not movement to smooth over. */
const JUMP = 0.08;
/** Analyses without a page before the outline is dropped. */
const MISSES = 3;

function maxShift(a: NormQuad, b: NormQuad) {
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
}

function blend(a: NormQuad, b: NormQuad, t: number): NormQuad {
  return a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * t, y: p.y + (b[i].y - p.y) * t })) as NormQuad;
}

/**
 * The blue page outline over the live camera, like a document-scanner app: it follows the page while
 * the phone moves and, once the page has been still for a moment, asks for the photo to be taken.
 */
export function LiveOutline({
  videoRef,
  active,
  autoAfter,
  quadRef,
  onState,
  onSteady,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Track only while the camera is showing (not while a photo is being checked). */
  active: boolean;
  /** Earliest time (Date.now()) an automatic photo may be taken. */
  autoAfter: number;
  /** Always holds the latest outline, for the shutter button. */
  quadRef: MutableRefObject<NormQuad | null>;
  onState: (state: TrackState) => void;
  onSteady: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onState, onSteady, autoAfter });
  useEffect(() => {
    callbacks.current = { onState, onSteady, autoAfter };
  });

  useEffect(() => {
    if (!active) return;
    let target: NormQuad | null = null;
    let shown: NormQuad | null = null;
    let alpha = 0;
    let lastRaw: NormQuad | null = null;
    let steady = 0;
    let misses = 0;
    let fired = false;
    let state: TrackState | null = null;
    let timer = 0;
    let raf = 0;
    let stopped = false;

    const setState = (s: TrackState) => {
      if (s === state) return;
      state = s;
      callbacks.current.onState(s);
    };

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth) {
        let raw: NormQuad | null = null;
        try {
          raw = findPage(video, video.videoWidth, video.videoHeight, LIVE_EDGE);
        } catch {
          raw = null;
        }
        if (raw) {
          misses = 0;
          if (target && maxShift(raw, target) < JUMP) {
            steady = lastRaw && maxShift(raw, lastRaw) < STILL ? steady + 1 : 0;
            target = blend(target, raw, 0.6);
          } else {
            target = raw;
            steady = 0;
          }
          lastRaw = raw;
        } else if (++misses >= MISSES) {
          target = null;
          lastRaw = null;
          steady = 0;
        }
        quadRef.current = target;
        setState(!target ? "searching" : steady >= STEADY_TICKS ? "steady" : "found");
        if (target && steady >= STEADY_TICKS && !fired && Date.now() >= callbacks.current.autoAfter) {
          fired = true;
          callbacks.current.onSteady();
        }
      }
      timer = window.setTimeout(tick, TICK_MS);
    };

    const draw = () => {
      if (stopped) return;
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || !video.videoWidth) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      if (target) shown = shown ? blend(shown, target, 0.35) : target;
      alpha += ((target ? 1 : 0) - alpha) * 0.25;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!shown || alpha < 0.02) {
        if (!target) shown = null;
        return;
      }
      // The video fills the screen with object-cover: scale to cover, centre, crop the rest.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.max(cw / vw, ch / vh);
      const ox = (cw - vw * scale) / 2;
      const oy = (ch - vh * scale) / 2;
      const pts = shown.map((p) => ({ x: (ox + p.x * vw * scale) * dpr, y: (oy + p.y * vh * scale) * dpr }));
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
      ctx.fill();
      ctx.lineJoin = "round";
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = "#3b82f6";
      ctx.stroke();
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    setState("searching");
    timer = window.setTimeout(tick, 60);
    raf = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      quadRef.current = null;
      const canvas = canvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, videoRef, quadRef]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
