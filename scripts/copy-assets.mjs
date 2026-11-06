// Copies runtime assets that must be served or read from stable paths:
//  - the pdf.js worker (served from /pdf.worker.min.mjs so the browser can load it)
//  - WOFF fonts used by the PDF writer (Latin + Devanagari)
// Runs on postinstall and again before every build. On CI / Vercel a missing asset fails the build,
// so a deployment can never ship without them; local installs only warn.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const nm = join(root, "node_modules");
const strict = Boolean(process.env.VERCEL || process.env.CI);
const missing = [];

function copy(from, to) {
  if (!existsSync(from)) {
    missing.push(from);
    return;
  }
  mkdirSync(join(to, ".."), { recursive: true });
  copyFileSync(from, to);
}

copy(join(nm, "pdfjs-dist", "build", "pdf.worker.min.mjs"), join(root, "public", "pdf.worker.min.mjs"));

const fontsOut = join(root, "assets", "fonts");
const fontSources = [
  ["@fontsource/noto-sans", "noto-sans-latin-400-normal.woff", "NotoSans-Regular.woff"],
  ["@fontsource/noto-sans", "noto-sans-latin-700-normal.woff", "NotoSans-Bold.woff"],
  ["@fontsource/noto-sans-devanagari", "noto-sans-devanagari-devanagari-400-normal.woff", "NotoSansDevanagari-Regular.woff"],
];
for (const [pkg, file, out] of fontSources) copy(join(nm, pkg, "files", file), join(fontsOut, out));

// OCR language models (LSTM "best_int", matching OEM 1) — bundled so serverless instances never
// download them at runtime.
const tessOut = join(root, "assets", "tessdata");
for (const lang of ["eng", "hin"]) {
  copy(join(nm, "@tesseract.js-data", lang, "4.0.0_best_int", `${lang}.traineddata.gz`), join(tessOut, `${lang}.traineddata.gz`));
}

if (missing.length) {
  for (const m of missing) console.warn(`[copy-assets] missing ${m}`);
  if (strict) {
    console.error("[copy-assets] required build assets are missing — failing the build");
    process.exit(1);
  }
}
console.log("[copy-assets] done");
