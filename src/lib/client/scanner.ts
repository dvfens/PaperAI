"use client";

import { detectDocument, grayFromRgba, type Quad } from "@/lib/scan/detect";
import { enhance, flatSize, rotate, warpQuad, type ScanFilter } from "@/lib/scan/image";
import { MAX_PAGE_EDGE, pageFromCanvas, type PreparedPage } from "@/lib/client/media";

/** Page corners in 0–1 coordinates of the photo (top-left, top-right, bottom-right, bottom-left). */
export type NormQuad = Quad;

export interface ScanSettings {
  quad: NormQuad | null;
  filter: ScanFilter;
  /** Clockwise quarter turns. */
  turns: number;
}

/** Live preview analyses a 480 px copy of each frame; a taken photo is analysed at 800 px. */
export const LIVE_EDGE = 480;
export const PHOTO_EDGE = 800;

let scratch: HTMLCanvasElement | null = null;

function context(canvas: HTMLCanvasElement) {
  return canvas.getContext("2d", { willReadFrequently: true })!;
}

/** Find the page in a video frame, image or canvas. Null when no clear page outline is visible. */
export function findPage(source: CanvasImageSource, sw: number, sh: number, longEdge = LIVE_EDGE): NormQuad | null {
  if (!sw || !sh) return null;
  const scale = Math.min(1, longEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  scratch ??= document.createElement("canvas");
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const ctx = context(scratch);
  ctx.drawImage(source, 0, 0, w, h);
  const found = detectDocument(grayFromRgba(ctx.getImageData(0, 0, w, h).data, w, h));
  return found ? (found.quad.map((p) => ({ x: p.x / w, y: p.y / h })) as NormQuad) : null;
}

/** Copy the current camera frame at full resolution. */
export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  return canvas;
}

/** Decode a photo file (respecting its EXIF rotation) onto a canvas, at most `maxEdge` px long. */
export async function imageToCanvas(file: Blob, maxEdge = 3000): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** Pull each corner 0.4 % towards the middle, so no sliver of table shows along the edges. */
function inset(q: Quad, share: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => ({ x: p.x + (cx - p.x) * share * 2, y: p.y + (cy - p.y) * share * 2 })) as Quad;
}

/** Let the browser paint (a spinner, say) before a few hundred milliseconds of pixel work. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 16));

/** Cut out, straighten, clean and rotate the page, and encode it like any other page image. */
export async function renderScan(source: HTMLCanvasElement, settings: ScanSettings): Promise<PreparedPage> {
  await nextFrame();
  const sw = source.width;
  const sh = source.height;
  let px: Uint8ClampedArray;
  let w: number;
  let h: number;
  if (settings.quad) {
    const quad = inset(settings.quad.map((p) => ({ x: p.x * sw, y: p.y * sh })) as Quad, 0.004);
    const flat = flatSize(quad);
    const scale = Math.min(1.5, MAX_PAGE_EDGE / Math.max(flat.width, flat.height));
    w = Math.max(1, Math.round(flat.width * scale));
    h = Math.max(1, Math.round(flat.height * scale));
    // Shrinking a lot: let the browser's filtered scaling go first, so fine print does not alias.
    let src = source;
    let k = 1;
    if (scale < 0.75) {
      k = Math.min(1, scale * 1.25);
      src = document.createElement("canvas");
      src.width = Math.round(sw * k);
      src.height = Math.round(sh * k);
      const ctx = src.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, src.width, src.height);
    }
    const data = context(src).getImageData(0, 0, src.width, src.height).data;
    px = warpQuad(data, src.width, src.height, quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad, w, h);
  } else {
    const scale = Math.min(1, MAX_PAGE_EDGE / Math.max(sw, sh));
    w = Math.max(1, Math.round(sw * scale));
    h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = context(canvas);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    px = ctx.getImageData(0, 0, w, h).data;
  }
  enhance(px, w, h, settings.filter);
  const turned = rotate(px, w, h, settings.turns);
  const out = document.createElement("canvas");
  out.width = turned.width;
  out.height = turned.height;
  out.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(turned.px), turned.width, turned.height), 0, 0);
  return pageFromCanvas(out);
}
