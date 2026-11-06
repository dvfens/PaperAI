"use client";

import type { PageImage } from "@/lib/types";

/**
 * Hosted serverless functions accept request bodies of about 4.5 MB, and the original PDF travels
 * with the page images on analysis and generation — so keep originals and page images small.
 * 1600 px on the long edge is plenty for OCR and close to the size Claude's vision works at.
 */
export const MAX_UPLOAD_BYTES = 3_500_000;
export const MAX_REQUEST_BYTES = 4_200_000;
export const MAX_PAGE_EDGE = 1600;

export interface PreparedPage extends PageImage {
  blob: Blob;
}

/** Drop trailing pages until the request fits under the host's body-size limit. */
export function pagesWithinBudget<T extends { blob: Blob }>(pages: T[], extraBytes = 0): T[] {
  const out: T[] = [];
  let total = extraBytes;
  for (const p of pages) {
    if (out.length && total + p.blob.size > MAX_REQUEST_BYTES) break;
    total += p.blob.size;
    out.push(p);
  }
  return out;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality),
  );
}

export async function pageFromCanvas(canvas: HTMLCanvasElement): Promise<PreparedPage> {
  const blob = await canvasToBlob(canvas);
  return { blob, dataUrl: canvas.toDataURL("image/jpeg", 0.8), width: canvas.width, height: canvas.height };
}

function scaledCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_PAGE_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Grab the current camera frame as a page image. */
export function captureVideoFrame(video: HTMLVideoElement): Promise<PreparedPage> {
  return pageFromCanvas(scaledCanvas(video, video.videoWidth, video.videoHeight));
}

/** Load an image file (any browser-decodable format) and normalise it to a JPEG page. */
export async function imageFileToPage(file: Blob): Promise<PreparedPage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return await pageFromCanvas(scaledCanvas(bitmap, bitmap.width, bitmap.height));
  } finally {
    bitmap.close();
  }
}

/** Render the first pages of a PDF to images with pdf.js (loaded only in the browser). */
export async function pdfToPages(data: ArrayBuffer, maxPages = 4, targetWidth = 1600): Promise<{ pages: PreparedPage[]; pageCount: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  const doc = await task.promise;
  const pages: PreparedPage[] = [];
  try {
    for (let i = 1; i <= Math.min(maxPages, doc.numPages); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: targetWidth / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      pages.push(await pageFromCanvas(canvas));
    }
    return { pages, pageCount: doc.numPages };
  } finally {
    await task.destroy();
  }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
