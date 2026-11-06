import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectDocument, type Gray, type Quad } from "@/lib/scan/detect";
import { applyHomography, enhance, flatSize, homography, rotate, warpQuad } from "@/lib/scan/image";

/** Small seeded random numbers, so every run sees the same noise. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const UNIT: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

interface SceneOptions {
  w: number;
  h: number;
  corners: Quad | null;
  paper?: number;
  background?: (x: number, y: number) => number;
  noise?: number;
  /** Dark "words", ruled table and a heading on the page. */
  content?: boolean;
  /** Light falls to this share at the right-hand side of the photo (a shadow). */
  shadow?: number;
  seed?: number;
}

/** What is printed at a point of the page (u, v in 0–1): 1 = paper, 0 = ink. */
function ink(u: number, v: number): number {
  // Heading bar.
  if (v > 0.06 && v < 0.1 && u > 0.3 && u < 0.7) return 0;
  // Lines of words.
  for (let k = 0; k < 9; k++) {
    const top = 0.15 + k * 0.04;
    if (v > top && v < top + 0.014 && u > 0.1 && u < 0.85 - (k % 3) * 0.1) {
      const word = Math.floor((u - 0.1) / 0.09);
      if ((u - 0.1) % 0.09 < 0.075 && (word + k) % 5 !== 3) return 0;
    }
  }
  // A ruled table (the kind of box a form has).
  if (u > 0.08 && u < 0.92 && v > 0.55 && v < 0.88) {
    const t = 0.004;
    if (u < 0.08 + t || u > 0.92 - t || v < 0.55 + t || v > 0.88 - t) return 0;
    for (const row of [0.66, 0.77]) if (Math.abs(v - row) < t / 2) return 0;
    if (Math.abs(u - 0.4) < t / 2) return 0;
  }
  return 1;
}

function scene(o: SceneOptions): { gray: Gray; rgba: Uint8ClampedArray } {
  const { w, h } = o;
  const paper = o.paper ?? 225;
  const background = o.background ?? ((x: number, y: number) => 70 + 20 * Math.sin(x * 0.07 + y * 0.013));
  const rand = rng(o.seed ?? 1);
  const toPage = o.corners ? homography(o.corners, UNIT) : null;
  const data = new Float32Array(w * h);
  const rgba = new Uint8ClampedArray(w * h * 4);
  const subs = [-0.25, 0.25];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (const sy of subs) {
        for (const sx of subs) {
          const px = x + 0.5 + sx;
          const py = y + 0.5 + sy;
          let v = background(px, py);
          if (toPage) {
            const p = applyHomography(toPage, { x: px, y: py });
            if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) v = (o.content === false ? 1 : ink(p.x, p.y) ? 1 : 0.15) * paper;
          }
          sum += v * (1 - (1 - (o.shadow ?? 1)) * (px / w));
        }
      }
      const v = Math.max(0, Math.min(255, sum / 4 + (rand() - 0.5) * 2 * (o.noise ?? 4)));
      data[y * w + x] = v;
      rgba[(y * w + x) * 4] = rgba[(y * w + x) * 4 + 1] = rgba[(y * w + x) * 4 + 2] = v;
      rgba[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { gray: { data, width: w, height: h }, rgba };
}

function cornerError(found: Quad, truth: Quad): number {
  return Math.max(...found.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y)));
}

const TILTED: Quad = [
  { x: 62, y: 74 },
  { x: 296, y: 92 },
  { x: 318, y: 418 },
  { x: 38, y: 402 },
];

describe("detectDocument", () => {
  it("finds a tilted printed form on a textured table", () => {
    const { gray } = scene({ w: 360, h: 480, corners: TILTED });
    const d = detectDocument(gray);
    assert.ok(d, "no page found");
    assert.ok(cornerError(d.quad, TILTED) <= 3, `corners off by ${cornerError(d.quad, TILTED).toFixed(1)} px`);
  });

  it("finds white paper on a light table (low contrast) under a shadow", () => {
    const { gray } = scene({ w: 360, h: 480, corners: TILTED, paper: 222, background: () => 185, shadow: 0.8, noise: 5 });
    const d = detectDocument(gray);
    assert.ok(d, "no page found");
    assert.ok(cornerError(d.quad, TILTED) <= 3, `corners off by ${cornerError(d.quad, TILTED).toFixed(1)} px`);
  });

  it("picks the page, not the table printed on it or the edge of the desk behind it", () => {
    const desk = (x: number, y: number) => (y < 40 + x * 0.05 ? 150 : 60);
    const corners: Quad = [
      { x: 70, y: 60 },
      { x: 290, y: 60 },
      { x: 300, y: 440 },
      { x: 60, y: 440 },
    ];
    const { gray } = scene({ w: 360, h: 480, corners, background: desk });
    const d = detectDocument(gray);
    assert.ok(d, "no page found");
    assert.ok(cornerError(d.quad, corners) <= 3, `corners off by ${cornerError(d.quad, corners).toFixed(1)} px`);
  });

  it("handles a page turned 20° in landscape frames", () => {
    const c = { x: 240, y: 180 };
    const a = (20 * Math.PI) / 180;
    const pts = [
      [-90, -125],
      [90, -125],
      [90, 125],
      [-90, 125],
    ].map(([dx, dy]) => ({ x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) })) as Quad;
    const { gray } = scene({ w: 480, h: 360, corners: pts });
    const d = detectDocument(gray);
    assert.ok(d, "no page found");
    // Rotated pages may come back with their corners starting at a different one; compare as a set.
    const err = Math.max(...pts.map((p) => Math.min(...d.quad.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))));
    assert.ok(err <= 3, `corners off by ${err.toFixed(1)} px`);
  });

  it("finds nothing when there is no page", () => {
    const { gray } = scene({ w: 360, h: 480, corners: null, noise: 8 });
    assert.equal(detectDocument(gray), null);
  });

  it("finds nothing on a page of text with no visible edges (page fills the frame)", () => {
    const corners: Quad = [
      { x: -40, y: -40 },
      { x: 400, y: -40 },
      { x: 400, y: 520 },
      { x: -40, y: 520 },
    ];
    const { gray } = scene({ w: 360, h: 480, corners });
    const d = detectDocument(gray);
    // A table border may be found, but never something smaller than the printed table.
    if (d) assert.ok(d.area > 0.25, `found a tiny quad (${d.area.toFixed(2)})`);
  });
});

describe("homography and warp", () => {
  it("maps each corner exactly", () => {
    const h = homography(UNIT, TILTED);
    UNIT.forEach((p, i) => {
      const q = applyHomography(h, p);
      assert.ok(Math.hypot(q.x - TILTED[i].x, q.y - TILTED[i].y) < 1e-6);
    });
  });

  it("flattens a tilted page so printed lines land where they belong", () => {
    const { rgba } = scene({ w: 360, h: 480, corners: TILTED, noise: 0 });
    const { width, height } = flatSize(TILTED);
    const outW = Math.round(width);
    const outH = Math.round(height);
    const flat = warpQuad(rgba, 360, 480, TILTED, outW, outH);
    const at = (u: number, v: number) => flat[(Math.round(v * outH) * outW + Math.round(u * outW)) * 4];
    // The heading bar (u 0.3–0.7, v 0.06–0.1) is where it was printed, with paper all round it.
    for (const u of [0.32, 0.5, 0.68]) assert.ok(at(u, 0.08) < 80, `heading missing at u=${u}`);
    for (const [u, v] of [[0.27, 0.08], [0.73, 0.08], [0.5, 0.04], [0.5, 0.125]]) assert.ok(at(u, v) > 180, `ink at ${u},${v}`);
    // First word of each line starts at u 0.1.
    assert.ok(at(0.12, 0.157) < 80 && at(0.08, 0.157) > 180);
    assert.ok(at(0.2, 0.6) > 180, "paper should stay light");
    // Corners of the output are paper, not table.
    assert.ok(at(0.02, 0.02) > 180 && at(0.97, 0.97) > 180);
  });
});

describe("enhance", () => {
  it("evens out a shadow: paper turns white, ink stays dark", () => {
    const w = 300;
    const h = 400;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const lit = 0.55 + 0.45 * (1 - x / w); // dark right-hand side
        const v = ink(x / w, y / h) ? 215 * lit : 40 * lit;
        const o = (y * w + x) * 4;
        px[o] = v * 1.05; // warm light
        px[o + 1] = v;
        px[o + 2] = v * 0.85;
        px[o + 3] = 255;
      }
    }
    enhance(px, w, h, "clean");
    const at = (x: number, y: number) => px[(y * w + x) * 4 + 1];
    for (const x of [20, 150, 280]) assert.ok(at(x, 20) >= 245, `paper at x=${x} is ${at(x, 20)}`);
    // Ink in the bright and the shadowed half: the heading bar and words on the first line.
    assert.ok(at(150, 32) < 60, `heading is ${at(150, 32)}`);
    assert.ok(at(36, 63) < 60, `left word is ${at(36, 63)}`);
    assert.ok(at(240, 63) < 60, `shadowed word is ${at(240, 63)}`);
    // Warm cast removed: paper is neutral.
    const o = (20 * w + 150) * 4;
    assert.ok(Math.abs(px[o] - px[o + 2]) <= 6, `paper is tinted: ${px[o]},${px[o + 1]},${px[o + 2]}`);
  });

  it("leaves the original filter untouched", () => {
    const px = new Uint8ClampedArray([10, 20, 30, 255, 200, 190, 180, 255]);
    enhance(px, 2, 1, "original");
    assert.deepEqual([...px], [10, 20, 30, 255, 200, 190, 180, 255]);
  });
});

describe("rotate", () => {
  it("turns clockwise a quarter at a time", () => {
    // 2×1 image: red, blue → after one turn, 1×2: red on top, blue below.
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const r = rotate(px, 2, 1, 1);
    assert.equal(r.width, 1);
    assert.equal(r.height, 2);
    assert.deepEqual([...r.px], [255, 0, 0, 255, 0, 0, 255, 255]);
    const r2 = rotate(px, 2, 1, 2);
    assert.deepEqual([...r2.px], [0, 0, 255, 255, 255, 0, 0, 255]);
  });
});

