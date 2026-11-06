import "server-only";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Server configuration. Every secret is read from the environment and is only ever used on the
 * server — none of these values are sent to the browser.
 */
function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

const isProd = process.env.NODE_ENV === "production";
const dataDir = resolve(str("DATA_DIR", ".data"));

export const env = {
  isProd,
  appUrl: str("APP_URL", "http://localhost:3000"),
  dataDir,

  anthropicApiKey: str("ANTHROPIC_API_KEY"),
  claudeModel: str("CLAUDE_MODEL", "claude-opus-5-5"),
  /** Effort for full document analysis (low | medium | high). Lower is faster. */
  claudeAnalysisEffort: (str("CLAUDE_ANALYSIS_EFFORT", "low") as "low" | "medium" | "high"),

  elevenLabsApiKey: str("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: str("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb"),
  elevenLabsTtsModel: str("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2"),
  elevenLabsSttModel: str("ELEVENLABS_STT_MODEL", "scribe_v2"),

  arkivAccessKey: str("ARKIV_ACCESS_KEY"),
  arkivPrivateKey: str("ARKIV_PRIVATE_KEY"),

  databaseUrl: str("DATABASE_URL"),
  storageDir: resolve(str("STORAGE_DIR", join(dataDir, "vault"))),
  ocrCacheDir: resolve(str("OCR_CACHE_DIR", join(dataDir, "tessdata"))),
  demoTools: str("NEXT_PUBLIC_DEMO_TOOLS", isProd ? "false" : "true") === "true",
};

export const features = {
  claude: () => Boolean(env.anthropicApiKey),
  elevenLabs: () => Boolean(env.elevenLabsApiKey),
  arkiv: () => /^0x[0-9a-fA-F]{64}$/.test(env.arkivPrivateKey),
};

/**
 * 32-byte secrets. In production they must be configured. In development they are generated once
 * and kept in .data/dev-secrets.json (git-ignored) so the app runs without manual setup.
 */
type SecretName = "DOCUMENT_ENCRYPTION_KEY" | "APP_SECRET";
const cache = new Map<SecretName, Buffer>();

export function secret(name: SecretName): Buffer {
  const hit = cache.get(name);
  if (hit) return hit;
  const raw = str(name);
  let value: Buffer | null = raw ? Buffer.from(raw, "base64") : null;
  if (value && value.length !== 32) {
    throw new Error(`${name} must be 32 bytes, base64 encoded (got ${value.length} bytes).`);
  }
  if (!value) {
    if (isProd) throw new Error(`${name} is not set. Generate one with: npm run setup`);
    value = devSecret(name);
  }
  cache.set(name, value);
  return value;
}

function devSecret(name: SecretName): Buffer {
  const file = join(dataDir, "dev-secrets.json");
  let store: Record<string, string> = {};
  if (existsSync(file)) store = JSON.parse(readFileSync(file, "utf8"));
  if (!store[name]) {
    store[name] = randomBytes(32).toString("base64");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
  }
  return Buffer.from(store[name], "base64");
}
