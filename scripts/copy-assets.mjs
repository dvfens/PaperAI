// Copies runtime assets that must be served or read from stable paths:
//  - the pdf.js worker (served from /pdf.worker.min.mjs so the browser can load it)
//  - TTF/WOFF fonts used by the PDF writer (Latin + Devanagari)
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const nm = join(root, "node_modules");

function copy(from, to) {
  if (!existsSync(from)) {
    console.warn(`[copy-assets] missing ${from}`);
    return;
  }
  mkdirSync(join(to, ".."), { recursive: true });
  copyFileSync(from, to);
}

copy(join(nm, "pdfjs-dist", "build", "pdf.worker.min.mjs"), join(root, "public", "pdf.worker.min.mjs"));

const fontsOut = join(root, "assets", "fonts");
mkdirSync(fontsOut, { recursive: true });
const fontSources = [
  ["@fontsource/noto-sans", "noto-sans-latin-400-normal.woff", "NotoSans-Regular.woff"],
  ["@fontsource/noto-sans", "noto-sans-latin-700-normal.woff", "NotoSans-Bold.woff"],
  ["@fontsource/noto-sans-devanagari", "noto-sans-devanagari-devanagari-400-normal.woff", "NotoSansDevanagari-Regular.woff"],
];
for (const [pkg, file, out] of fontSources) {
  const dir = join(nm, pkg, "files");
  if (!existsSync(dir)) {
    console.warn(`[copy-assets] ${pkg} not installed`);
    continue;
  }
  const match = readdirSync(dir).find((f) => f === file);
  if (match) copy(join(dir, match), join(fontsOut, out));
  else console.warn(`[copy-assets] ${file} not found in ${pkg}`);
}
console.log("[copy-assets] done");
