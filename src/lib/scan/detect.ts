/**
 * Finds the four corners of a sheet of paper in a photo — plain TypeScript on a grey image, with no DOM
 * and no OpenCV download, so it runs on every camera frame on a cheap phone and in node tests.
 *
 * 1. Blur, Sobel gradients, thin to one-pixel edges.
 * 2. Every edge pixel votes for straight lines close to its own direction (Hough transform).
 * 3. Every pair of strong "horizontal" lines is tried with every pair of "vertical" ones. A quad survives
 *    only if each of its four sides sits on a continuous edge with one contrast direction along its whole
 *    length — a paper edge does, a line of text does not.
 * 4. Of the survivors the largest wins (weighted by how clean its sides are), so a table printed on the
 *    page never beats the page itself, and a slightly-too-big crop is preferred to cutting text off.
 * 5. Each chosen side is refitted to its own edge pixels for sub-pixel corners.
 */

export interface Point {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export interface Gray {
  data: Float32Array;
  width: number;
  height: number;
}

export interface Detection {
  /** Corners in pixels of the analysed image. */
  quad: Quad;
  /** 0–1: how much of the outline sits on a clean edge. */
  support: number;
  /** Share of the image the page covers. */
  area: number;
  score: number;
}

export interface DetectOptions {
  /** Smallest page, as a share of the image (default 0.12). */
  minArea?: number;
  /** Smallest average side support (default 0.6). */
  minSupport?: number;
}

/** Gradient strength (Sobel on a 0–255 image) that counts as an edge pixel for voting. */
const EDGE_T = 20;
/** Gradient strength across a side that counts as "this part of the side is on an edge". */
const SIDE_T = 24;
/** Degrees either side of an edge pixel's own direction that it votes for. */
const ANGLE_WINDOW = 4;
/** Pixels either side of a candidate side searched for its edge. */
const SEARCH = 3;
/** Gradient must point within ~25° of the side's normal. */
const ALIGN = 0.9;
const MIN_SIDE = 0.5;
const MIN_QUARTER = 0.25;
const MAX_LINES_BY_VOTES = 18;
const EXTREME_LINES = 5;

const COS = new Float64Array(180);
const SIN = new Float64Array(180);
for (let t = 0; t < 180; t++) {
  COS[t] = Math.cos((t * Math.PI) / 180);
  SIN[t] = Math.sin((t * Math.PI) / 180);
}

export function grayFromRgba(rgba: ArrayLike<number>, width: number, height: number): Gray {
  const n = width * height;
  const data = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) data[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { data, width, height };
}

/** Stretch contrast so dim photos give the same gradient strengths as bright ones (gain capped at 3×). */
function normalise(g: Gray): Float32Array {
  const hist = new Uint32Array(256);
  const src = g.data;
  for (let i = 0; i < src.length; i++) hist[Math.max(0, Math.min(255, src[i] | 0))]++;
  const pct = (p: number) => {
    const target = p * src.length;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  const lo = pct(0.01);
  const hi = pct(0.99);
  const gain = Math.min(3, Math.max(1, 255 / Math.max(1, hi - lo)));
  if (gain === 1) return src;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = (src[i] - lo) * gain;
  return out;
}

/** Separable [1 4 6 4 1]/16 blur with clamped borders. */
function blur5(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x < 2 ? 0 : x - 2;
      const x1 = x < 1 ? 0 : x - 1;
      const x3 = x + 1 >= w ? w - 1 : x + 1;
      const x4 = x + 2 >= w ? w - 1 : x + 2;
      tmp[r + x] = (src[r + x0] + 4 * src[r + x1] + 6 * src[r + x] + 4 * src[r + x3] + src[r + x4]) / 16;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = (y < 2 ? 0 : y - 2) * w;
    const y1 = (y < 1 ? 0 : y - 1) * w;
    const y3 = (y + 1 >= h ? h - 1 : y + 1) * w;
    const y4 = (y + 2 >= h ? h - 1 : y + 2) * w;
    const r = y * w;
    for (let x = 0; x < w; x++) out[r + x] = (tmp[y0 + x] + 4 * tmp[y1 + x] + 6 * tmp[r + x] + 4 * tmp[y3 + x] + tmp[y4 + x]) / 16;
  }
  return out;
}

interface Field {
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
  w: number;
  h: number;
}

function gradients(g: Gray): Field {
  const w = g.width;
  const h = g.height;
  const img = blur5(normalise(g), w, h);
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = img[i - w - 1];
      const b = img[i - w];
      const c = img[i - w + 1];
      const d = img[i - 1];
      const f = img[i + 1];
      const gg = img[i + w - 1];
      const hh = img[i + w];
      const k = img[i + w + 1];
      const sx = c + 2 * f + k - (a + 2 * d + gg);
      const sy = gg + 2 * hh + k - (a + 2 * b + c);
      gx[i] = sx;
      gy[i] = sy;
      mag[i] = Math.hypot(sx, sy);
    }
  }
  return { gx, gy, mag, w, h };
}

/** Non-maximum suppression: keep only the ridge of each edge. */
function thinEdges(f: Field, threshold: number): Uint8Array {
  const { gx, gy, mag, w, h } = f;
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < threshold) continue;
      const ax = Math.abs(gx[i]);
      const ay = Math.abs(gy[i]);
      let n1: number;
      let n2: number;
      if (ay <= ax * 0.4142) {
        n1 = i - 1;
        n2 = i + 1;
      } else if (ay >= ax * 2.4142) {
        n1 = i - w;
        n2 = i + w;
      } else if (gx[i] * gy[i] > 0) {
        n1 = i - w - 1;
        n2 = i + w + 1;
      } else {
        n1 = i - w + 1;
        n2 = i + w - 1;
      }
      if (m >= mag[n1] && m > mag[n2]) out[i] = 1;
    }
  }
  return out;
}

interface Line {
  /** Normal angle in whole degrees, 0–179. */
  theta: number;
  c: number;
  s: number;
  rho: number;
  votes: number;
}

function houghLines(f: Field, edges: Uint8Array, minVotes: number): Line[] {
  const { w, h } = f;
  const diag = Math.ceil(Math.hypot(w, h));
  const nRho = 2 * diag + 1;
  const acc = new Uint16Array(180 * nRho);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!edges[i]) continue;
      let deg = Math.round((Math.atan2(f.gy[i], f.gx[i]) * 180) / Math.PI);
      deg = ((deg % 180) + 180) % 180;
      for (let d = -ANGLE_WINDOW; d <= ANGLE_WINDOW; d++) {
        const t = (deg + d + 180) % 180;
        const r = Math.round(x * COS[t] + y * SIN[t]) + diag;
        const k = t * nRho + r;
        if (acc[k] < 65535) acc[k]++;
      }
    }
  }

  const peaks: Line[] = [];
  for (let t = 0; t < 180; t++) {
    for (let r = 0; r < nRho; r++) {
      const v = acc[t * nRho + r];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -2; dt <= 2 && isMax; dt++) {
        for (let dr = -3; dr <= 3; dr++) {
          if (!dt && !dr) continue;
          let tt = t + dt;
          let rr = r + dr;
          // θ wraps at 180° with ρ negated (index 2·diag − r).
          if (tt < 0 || tt >= 180) {
            tt = (tt + 180) % 180;
            rr = 2 * diag - rr;
          }
          if (rr < 0 || rr >= nRho) continue;
          const nv = acc[tt * nRho + rr];
          if (nv > v || (nv === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) peaks.push({ theta: t, c: COS[t], s: SIN[t], rho: r - diag, votes: v });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);

  // Merge near-duplicates (same direction, within a few pixels at the centre of the image).
  const cx = w / 2;
  const cy = h / 2;
  const kept: Line[] = [];
  for (const p of peaks) {
    const dp = cx * p.c + cy * p.s - p.rho;
    const dup = kept.some((k) => {
      let diff = Math.abs(k.theta - p.theta);
      let dk = cx * k.c + cy * k.s - k.rho;
      if (diff > 90) {
        diff = 180 - diff;
        dk = -dk;
      }
      return diff <= 3 && Math.abs(dk - dp) <= 4;
    });
    if (!dup) kept.push(p);
  }
  return kept;
}

const isHorizontal = (l: Line) => l.theta >= 45 && l.theta < 135;

/** The strongest lines, plus the outermost ones (a page edge is often weaker than a ruled line inside it). */
function pickLines(lines: Line[], position: (l: Line) => number): Line[] {
  const chosen = new Set(lines.slice(0, MAX_LINES_BY_VOTES));
  const byPos = [...lines].sort((a, b) => position(a) - position(b));
  for (const l of byPos.slice(0, EXTREME_LINES)) chosen.add(l);
  for (const l of byPos.slice(-EXTREME_LINES)) chosen.add(l);
  return [...chosen];
}

/** Edge evidence along a whole line, as prefix sums, so any stretch of it is scored in O(1). */
interface Profile {
  line: Line;
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  half: number;
  n: number;
  pos: Int32Array;
  neg: Int32Array;
  /** Summed edge strength of the hits, per contrast direction. */
  posMag: Float64Array;
  negMag: Float64Array;
  inside: Int32Array;
}

function profile(f: Field, line: Line): Profile {
  const { gx, gy, mag, w, h } = f;
  const cx = w / 2;
  const cy = h / 2;
  const dist = cx * line.c + cy * line.s - line.rho;
  const ox = cx - dist * line.c;
  const oy = cy - dist * line.s;
  const dx = -line.s;
  const dy = line.c;
  const half = Math.ceil(Math.hypot(w, h) / 2) + 2;
  const n = 2 * half + 1;
  const pos = new Int32Array(n + 1);
  const neg = new Int32Array(n + 1);
  const posMag = new Float64Array(n + 1);
  const negMag = new Float64Array(n + 1);
  const inside = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) {
    const x = ox + (k - half) * dx;
    const y = oy + (k - half) * dy;
    let hitPos = 0;
    let hitNeg = 0;
    let strength = 0;
    let isIn = 0;
    if (x >= 1 && x <= w - 2 && y >= 1 && y <= h - 2) {
      isIn = 1;
      let best = 0;
      let bestSign = 0;
      for (let d = -SEARCH; d <= SEARCH; d++) {
        const px = Math.round(x + d * line.c);
        const py = Math.round(y + d * line.s);
        if (px < 1 || px > w - 2 || py < 1 || py > h - 2) continue;
        const i = py * w + px;
        const m = mag[i];
        if (m < SIDE_T) continue;
        const g = gx[i] * line.c + gy[i] * line.s;
        if (Math.abs(g) < ALIGN * m) continue;
        if (Math.abs(g) > best) {
          best = Math.abs(g);
          bestSign = g > 0 ? 1 : -1;
        }
      }
      if (bestSign > 0) hitPos = 1;
      else if (bestSign < 0) hitNeg = 1;
      strength = best;
    }
    pos[k + 1] = pos[k] + hitPos;
    neg[k + 1] = neg[k] + hitNeg;
    posMag[k + 1] = posMag[k] + (hitPos ? strength : 0);
    negMag[k + 1] = negMag[k] + (hitNeg ? strength : 0);
    inside[k + 1] = inside[k] + isIn;
  }
  return { line, ox, oy, dx, dy, half, n, pos, neg, posMag, negMag, inside };
}

interface SideScore {
  support: number;
  minQuarter: number;
  sign: number;
  /**
   * Edge strength right next to corner a and corner b (1–8 % of the side in from each end), as a share
   * of the side's average strength. A side that overshoots a real corner (onto the desk edge behind the
   * page, say) has only faint texture there, or nothing.
   */
  nearA: number;
  nearB: number;
}

/** How well the stretch of a line between two corners sits on one clean edge. */
function sideScore(p: Profile, a: Point, b: Point): SideScore | null {
  const sa = (a.x - p.ox) * p.dx + (a.y - p.oy) * p.dy + p.half;
  const sb = (b.x - p.ox) * p.dx + (b.y - p.oy) * p.dy + p.half;
  const full0 = Math.min(sa, sb);
  const full1 = Math.max(sa, sb);
  const len = full1 - full0;
  const idx = (s: number) => Math.max(0, Math.min(p.n, Math.round(s)));
  const i0 = idx(full0 + len * 0.04);
  const i1 = idx(full1 - len * 0.04);
  const span = i1 - i0;
  if (span < 8) return null;
  const inside = p.inside[i1] - p.inside[i0];
  if (inside < span * 0.6) return null;
  const pos = p.pos[i1] - p.pos[i0];
  const neg = p.neg[i1] - p.neg[i0];
  const sign = pos >= neg ? 1 : -1;
  const arr = sign > 0 ? p.pos : p.neg;
  const mags = sign > 0 ? p.posMag : p.negMag;
  const share = (from: number, to: number) => {
    const j0 = idx(from);
    const j1 = idx(to);
    const n = p.inside[j1] - p.inside[j0];
    return n > 0 ? (arr[j1] - arr[j0]) / n : 0;
  };
  const strength = (from: number, to: number) => {
    const j0 = idx(from);
    const j1 = idx(to);
    const n = p.inside[j1] - p.inside[j0];
    return n > 0 ? (mags[j1] - mags[j0]) / n : 0;
  };
  const sideStrength = strength(i0, i1);
  const support = Math.max(pos, neg) / inside;
  let minQuarter = 1;
  for (let q = 0; q < 4; q++) minQuarter = Math.min(minQuarter, share(i0 + (span * q) / 4, i0 + (span * (q + 1)) / 4));
  const near = (from: number, to: number) => (sideStrength > 0 ? Math.min(1, strength(from, to) / sideStrength) : 0);
  const nearLo = near(full0 + len * 0.01, full0 + len * 0.08);
  const nearHi = near(full1 - len * 0.08, full1 - len * 0.01);
  return sa <= sb
    ? { support, minQuarter, sign, nearA: nearLo, nearB: nearHi }
    : { support, minQuarter, sign, nearA: nearHi, nearB: nearLo };
}

function intersect(a: { c: number; s: number; rho: number }, b: { c: number; s: number; rho: number }): Point | null {
  const det = a.c * b.s - a.s * b.c;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.rho * b.s - a.s * b.rho) / det, y: (a.c * b.rho - a.rho * b.c) / det };
}

export function quadArea(q: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Convex, corners in clockwise order, and no corner sharper than 30° or flatter than 150°. */
function wellShaped(q: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const prev = q[(i + 3) % 4];
    const next = q[(i + 1) % 4];
    const e1x = p.x - prev.x;
    const e1y = p.y - prev.y;
    const e2x = next.x - p.x;
    const e2y = next.y - p.y;
    if (e1x * e2y - e1y * e2x <= 0) return false;
    const ax = prev.x - p.x;
    const ay = prev.y - p.y;
    const cos = (ax * e2x + ay * e2y) / (Math.hypot(ax, ay) * Math.hypot(e2x, e2y) || 1);
    if (cos > 0.866 || cos < -0.866) return false;
  }
  return true;
}

/** Refit one side to the sub-pixel positions of its own edge pixels (total least squares). */
function refine(f: Field, line: Line, sign: number, a: Point, b: Point): { c: number; s: number; rho: number } | null {
  const { gx, gy, w, h } = f;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.floor(len);
  const xs: number[] = [];
  const ys: number[] = [];
  const along = (px: number, py: number) => {
    const ix = Math.round(px);
    const iy = Math.round(py);
    if (ix < 1 || ix > w - 2 || iy < 1 || iy > h - 2) return 0;
    const i = iy * w + ix;
    return sign * (gx[i] * line.c + gy[i] * line.s);
  };
  for (let k = 0; k < steps; k++) {
    const t = 0.06 + (0.88 * (k + 0.5)) / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    let best = SIDE_T;
    let bestD = NaN;
    for (let d = -SEARCH - 1; d <= SEARCH + 1; d++) {
      const v = along(x + d * line.c, y + d * line.s);
      if (v > best) {
        best = v;
        bestD = d;
      }
    }
    if (Number.isNaN(bestD)) continue;
    const l = along(x + (bestD - 1) * line.c, y + (bestD - 1) * line.s);
    const r = along(x + (bestD + 1) * line.c, y + (bestD + 1) * line.s);
    const denom = l - 2 * best + r;
    const sub = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / denom)) : 0;
    xs.push(x + (bestD + sub) * line.c);
    ys.push(y + (bestD + sub) * line.s);
  }
  if (xs.length < 10) return null;

  const fit = (keep: (i: number) => boolean) => {
    let n = 0;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < xs.length; i++) {
      if (!keep(i)) continue;
      n++;
      mx += xs[i];
      my += ys[i];
    }
    if (n < 10) return null;
    mx /= n;
    my /= n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      if (!keep(i)) continue;
      const dx = xs[i] - mx;
      const dy = ys[i] - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    // Normal = eigenvector of the smaller eigenvalue of the scatter matrix.
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2;
    let c = Math.cos(angle);
    let s = Math.sin(angle);
    if (c * line.c + s * line.s < 0) {
      c = -c;
      s = -s;
    }
    return { c, s, rho: mx * c + my * s };
  };
  const first = fit(() => true);
  if (!first) return null;
  return fit((i) => Math.abs(xs[i] * first.c + ys[i] * first.s - first.rho) <= 1.5) ?? first;
}

export function detectDocument(g: Gray, options: DetectOptions = {}): Detection | null {
  const minArea = options.minArea ?? 0.12;
  const minSupport = options.minSupport ?? 0.6;
  const { width: w, height: h } = g;
  if (w < 32 || h < 32) return null;
  const f = gradients(g);
  const edges = thinEdges(f, EDGE_T);
  const lines = houghLines(f, edges, Math.max(12, Math.round(0.12 * Math.min(w, h))));
  const cx = w / 2;
  const cy = h / 2;
  const yAt = (l: Line) => (l.rho - cx * l.c) / l.s;
  const xAt = (l: Line) => (l.rho - cy * l.s) / l.c;
  const hor = pickLines(lines.filter(isHorizontal), yAt);
  const ver = pickLines(
    lines.filter((l) => !isHorizontal(l)),
    xAt,
  );
  if (hor.length < 2 || ver.length < 2) return null;

  const profiles = new Map<Line, Profile>();
  const prof = (l: Line) => {
    let p = profiles.get(l);
    if (!p) {
      p = profile(f, l);
      profiles.set(l, p);
    }
    return p;
  };

  const pairs = (ls: Line[], at: (l: Line) => number, minGap: number) => {
    const out: [Line, Line, number][] = [];
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        let a = ls[i];
        let b = ls[j];
        if (at(a) > at(b)) [a, b] = [b, a];
        const gap = at(b) - at(a);
        let diff = Math.abs(a.theta - b.theta);
        if (diff > 90) diff = 180 - diff;
        if (gap >= minGap && diff <= 40) out.push([a, b, gap]);
      }
    }
    return out.sort((p, q) => q[2] - p[2]);
  };
  const hPairs = pairs(hor, yAt, 0.15 * h);
  const vPairs = pairs(ver, xAt, 0.15 * w);
  const total = w * h;
  const mx = 0.02 * w;
  const my = 0.02 * h;
  const inFrame = (p: Point) => p.x >= -mx && p.x <= w + mx && p.y >= -my && p.y <= h + my;

  let best: { quad: Quad; score: number; support: number; area: number; lines: Line[]; signs: number[] } | null = null;
  for (const [top, bottom] of hPairs) {
    for (const [left, right] of vPairs) {
      // Largest possible score is the area, so stop early once a better quad is in hand.
      const bound = ((yAt(bottom) - yAt(top)) * (xAt(right) - xAt(left))) / total;
      if (best && bound * 1.3 < best.score) continue;
      const tl = intersect(top, left);
      const tr = intersect(top, right);
      const br = intersect(bottom, right);
      const bl = intersect(bottom, left);
      if (!tl || !tr || !br || !bl) continue;
      const quad: Quad = [tl, tr, br, bl];
      if (!quad.every(inFrame) || !wellShaped(quad)) continue;
      const area = quadArea(quad) / total;
      if (area < minArea || area > 0.995) continue;
      if (best && area < best.score) continue;
      const sides = [
        sideScore(prof(top), tl, tr),
        sideScore(prof(right), tr, br),
        sideScore(prof(bottom), br, bl),
        sideScore(prof(left), bl, tl),
      ];
      if (sides.some((s) => !s || s.support < MIN_SIDE || s.minQuarter < MIN_QUARTER)) continue;
      const [st, sr, sbm, sl] = sides as SideScore[];
      const support = (st.support + sr.support + sbm.support + sl.support) / 4;
      if (support < minSupport) continue;
      // Each corner: the weaker of its two sides just next to it.
      const corner =
        (Math.min(st.nearA, sl.nearB) + Math.min(st.nearB, sr.nearA) + Math.min(sr.nearB, sbm.nearA) + Math.min(sbm.nearB, sl.nearA)) / 4;
      const score = area * support * support * (0.4 + 0.6 * corner);
      if (!best || score > best.score) {
        best = { quad, score, support, area, lines: [top, right, bottom, left], signs: sides.map((s) => s!.sign) };
      }
    }
  }
  if (!best) return null;

  // Sub-pixel refinement; keep the Hough corners if a refit looks wrong.
  const [tl, tr, br, bl] = best.quad;
  const ends: [Point, Point][] = [
    [tl, tr],
    [tr, br],
    [br, bl],
    [bl, tl],
  ];
  const fitted = best.lines.map((l, i) => refine(f, l, best!.signs[i], ends[i][0], ends[i][1]) ?? l);
  const corners = [intersect(fitted[0], fitted[3]), intersect(fitted[0], fitted[1]), intersect(fitted[2], fitted[1]), intersect(fitted[2], fitted[3])];
  const limit = 0.03 * Math.hypot(w, h);
  let quad = best.quad;
  if (corners.every((c, i) => c && Math.hypot(c.x - best!.quad[i].x, c.y - best!.quad[i].y) <= limit)) {
    const refined = corners as Quad;
    if (wellShaped(refined)) quad = refined;
  }
  return { quad, support: best.support, area: best.area, score: best.score };
}
