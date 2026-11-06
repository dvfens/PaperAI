import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Arkiv RPC host is contacted from the browser by the verification screen.
const ARKIV_RPC = "https://rpc.rabdi.db-chain.testnet.arkiv.network wss://rpc.rabdi.db-chain.testnet.arkiv.network";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} 'wasm-unsafe-eval'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${ARKIV_RPC}`,
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
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
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
