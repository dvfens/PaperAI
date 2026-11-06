import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Arkiv RPC host is contacted from the browser by the verification screen; ElevenLabs realtime
// speech recognition streams microphone audio straight from the browser (with a single-use token).
const ARKIV_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network wss://rpc.rabdi.db-chain.testnet.arkiv.network";
const ELEVENLABS_REALTIME = "wss://api.elevenlabs.io";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} 'wasm-unsafe-eval'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${ARKIV_RPC} ${ELEVENLABS_REALTIME}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Native/wasm-heavy packages run as plain Node modules on the server.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "@electric-sql/pglite", "pg"],
  // Files read through computed paths are invisible to output file tracing; ship them with the
  // serverless functions that need them (fonts for PDF writing, SQL migrations, OCR worker + wasm).
  outputFileTracingIncludes: {
    "/api/**/*": ["./db/migrations/*.sql"],
    "/api/documents/generate": ["./assets/fonts/**/*"],
    // The OCR worker runs in a worker thread started from a computed path, so nothing it loads is
    // traced: tesseract.js itself, its WASM engines and the worker's own dependencies.
    "/api/documents/analyze": [
      "./assets/tessdata/*.traineddata.gz",
      "./node_modules/tesseract.js/package.json",
      "./node_modules/tesseract.js/src/**/*",
      "./node_modules/tesseract.js-core/package.json",
      "./node_modules/tesseract.js-core/*.js",
      "./node_modules/tesseract.js-core/*.wasm",
      ...["bmp-js", "idb-keyval", "is-url", "node-fetch", "whatwg-url", "tr46", "webidl-conversions", "regenerator-runtime", "wasm-feature-detect", "zlibjs"].map(
        (p) => `./node_modules/${p}/**/*`,
      ),
    ],
  },
  // On Vercel the database is always Postgres (DATABASE_URL); keep the ~20 MB embedded PGlite out
  // of every function bundle there.
  ...(process.env.VERCEL ? { outputFileTracingExcludes: { "/*": ["./node_modules/@electric-sql/pglite/**/*"] } } : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
