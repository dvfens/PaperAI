/**
 * Straightening and cleaning a photographed page — plain TypeScript on RGBA pixels (no DOM), so the
 * browser and node tests run the same code.
 */
import type { Point, Quad } from "./detect";

export type ScanFilter = "clean" | "gray" | "original";

/**
 * 3×3 homography (row-major, h[8] = 1) that maps each `from` corner onto the matching `to` corner.
 * Solved directly from the four correspondences with Gaussian elimination.
 */
export function homography(from: Quad, to: Quad): number[] {
  const m: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i];
    const { x, y } = to[i];
    m.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    m.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error("degenerate quad");
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const k = m[r][col] / m[col][col];
      if (!k) continue;
      for (let c = col; c < 9; c++) m[r][c] -= k * m[col][c];
    }
  }
  const h = m.map((row, i) => row[8] / row[i]);
  h.push(1);
  return h;
}

export function applyHomography(h: number[], p: Point): Point {
  const d = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / d, y: (h[3] * p.x + h[4] * p.y + h[5]) / d };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Width and height of the flattened page: the longer of each pair of opposite sides. */
export function flatSize(q: Quad): { width: number; height: number } {
  return {
    width: Math.max(dist(q[0], q[1]), dist(q[3], q[2])),
    height: Math.max(dist(q[0], q[3]), dist(q[1], q[2])),
  };
}

/**
 * Cut the quad out of `src` and flatten it to an outW × outH rectangle (bilinear sampling; anything
 * outside the photo becomes white).
 */
export function warpQuad(
  src: ArrayLike<number>,
  sw: number,
  sh: number,
  quad: Quad,
  outW: number,
  outH: number,
): Uint8ClampedArray {
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const h = homography(rect, quad);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const maxX = sw - 1;
  const maxY = sh - 1;
  for (let v = 0; v < outH; v++) {
    const pv = v + 0.5;
    // Numerators and denominator are linear in u, so step them along the row.
    let nx = h[0] * 0.5 + h[1] * pv + h[2];
    let ny = h[3] * 0.5 + h[4] * pv + h[5];
    let dd = h[6] * 0.5 + h[7] * pv + h[8];
    let o = v * outW * 4;
    for (let u = 0; u < outW; u++, o += 4, nx += h[0], ny += h[3], dd += h[6]) {
      const x = nx / dd - 0.5;
      const y = ny / dd - 0.5;
      if (x < -0.5 || y < -0.5 || x > maxX + 0.5 || y > maxY + 0.5) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255;
        continue;
      }
      const cx = x < 0 ? 0 : x > maxX ? maxX : x;
      const cy = y < 0 ? 0 : y > maxY ? maxY : y;
      const x0 = Math.floor(cx);
      const y0 = Math.floor(cy);
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = cx - x0;
      const fy = cy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
        const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Make a phone photo of a page look like a scan, in place:
 * - "clean": shadows and uneven light removed, paper turned white, ink darkened, colours kept;
 * - "gray": the same, in black and white;
 * - "original": untouched.
 *
 * The paper's brightness is estimated per area (a bright percentile per block, spread with a max filter
 * so text-heavy blocks still find their paper, then smoothed) and every pixel is divided by it.
 */
export function enhance(px: Uint8ClampedArray, w: number, h: number, filter: ScanFilter): void {
  if (filter === "original") return;
  const block = Math.max(8, Math.round(Math.max(w, h) / 40));
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const lum = new Float32Array(w * h);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];

  // 1. Bright (90th percentile) level per block.
  let bg = new Float32Array(bw * bh);
  const hist = new Uint32Array(256);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      const x0 = bx * block;
      const y0 = by * block;
      const x1 = Math.min(w, x0 + block);
      const y1 = Math.min(h, y0 + block);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[lum[y * w + x] | 0]++;
      const target = 0.9 * (x1 - x0) * (y1 - y0);
      let acc = 0;
      let v = 0;
      for (; v < 255; v++) {
        acc += hist[v];
        if (acc >= target) break;
      }
      bg[by * bw + bx] = v;
    }
  }
  // 2. Max filter (3×3 blocks), then two box blurs, so text never reads as "dark paper".
  const pass = (src: Float32Array, op: "max" | "mean") => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let acc = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= bh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= bw) continue;
            const v = src[yy * bw + xx];
            if (op === "max") acc = Math.max(acc, v);
            else acc += v;
            n++;
          }
        }
        out[y * bw + x] = op === "max" ? acc : acc / n;
      }
    }
    return out;
  };
  bg = pass(pass(pass(bg, "max"), "mean"), "mean");

  // Background at any pixel: bilinear between block centres.
  const bgAt = (x: number, y: number) => {
    const fx = Math.max(0, Math.min(bw - 1, (x + 0.5) / block - 0.5));
    const fy = Math.max(0, Math.min(bh - 1, (y + 0.5) / block - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(bw - 1, x0 + 1);
    const y1 = Math.min(bh - 1, y0 + 1);
    const ax = fx - x0;
    const ay = fy - y0;
    const top = bg[y0 * bw + x0] * (1 - ax) + bg[y0 * bw + x1] * ax;
    const bot = bg[y1 * bw + x0] * (1 - ax) + bg[y1 * bw + x1] * ax;
    return top * (1 - ay) + bot * ay;
  };

  // 3. Paper colour (for white balance): average of pixels close to their local paper level.
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sl = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = y * w + x;
      if (lum[i] < 0.9 * bgAt(x, y) || lum[i] < 60) continue;
      sr += px[i * 4];
      sg += px[i * 4 + 1];
      sb += px[i * 4 + 2];
      sl += lum[i];
    }
  }
  const gain = (s: number) => (s > 0 && sl > 0 ? Math.max(0.8, Math.min(1.25, sl / s)) : 1);
  const gr = gain(sr);
  const gg = gain(sg);
  const gb = gain(sb);

  // 4. Divide by the paper level, push near-white to white, darken ink a little.
  const curve = new Uint8ClampedArray(1024);
  for (let i = 0; i < 1024; i++) {
    const x = i / 4 / 255;
    const y = Math.max(0, Math.min(1, (x - 0.06) / (0.88 - 0.06)));
    curve[i] = Math.round(255 * Math.pow(y, 1.25));
  }
  const lut = (v: number) => curve[Math.max(0, Math.min(1023, Math.round(v * 4)))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      // Dark areas (not paper) are not brightened more than 3×.
      const k = 255 / Math.max(85, bgAt(x, y));
      if (filter === "gray") {
        const v = lut(lum[i] * k);
        px[o] = px[o + 1] = px[o + 2] = v;
      } else {
        px[o] = lut(px[o] * gr * k);
        px[o + 1] = lut(px[o + 1] * gg * k);
        px[o + 2] = lut(px[o + 2] * gb * k);
      }
    }
  }
}

/** Rotate RGBA pixels clockwise by 90° steps. */
export function rotate(px: Uint8ClampedArray, w: number, h: number, quarterTurns: number): { px: Uint8ClampedArray; width: number; height: number } {
  const q = ((quarterTurns % 4) + 4) % 4;
  if (!q) return { px, width: w, height: h };
  const nw = q % 2 ? h : w;
  const nh = q % 2 ? w : h;
  const out = new Uint8ClampedArray(px.length);
  const src32 = new Uint32Array(px.buffer, px.byteOffset, w * h);
  const dst32 = new Uint32Array(out.buffer);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (q === 1) {
        nx = h - 1 - y;
        ny = x;
      } else if (q === 2) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else {
        nx = y;
        ny = w - 1 - x;
      }
      dst32[ny * nw + nx] = src32[y * w + x];
    }
  }
  return { px: out, width: nw, height: nh };
}
