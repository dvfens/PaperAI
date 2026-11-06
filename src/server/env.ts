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
/**
 * Serverless platforms (Vercel, AWS Lambda) give each instance a read-only filesystem except /tmp,
 * and /tmp is neither persistent nor shared between instances.
 */
const ephemeral = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const dataDir = resolve(str("DATA_DIR", ephemeral ? "/tmp/saathi" : ".data"));
const databaseUrl = str("DATABASE_URL");

export const env = {
  isProd,
  ephemeral,
  appUrl: str("APP_URL", "http://localhost:3000"),
  dataDir,

  anthropicApiKey: str("ANTHROPIC_API_KEY"),
  claudeModel: str("CLAUDE_MODEL", "claude-opus-5-5"),
  /** Effort for full document analysis (low | medium | high). Lower is faster. */
  claudeAnalysisEffort: (str("CLAUDE_ANALYSIS_EFFORT", "low") as "low" | "medium" | "high"),
  /**
   * Fast mode (Claude API research preview, Opus 5.5/5 and 4.8): the same model at up to 2.5x output
   * speed for 2x the per-token price. Used for every Claude call, because a person is waiting on each one
   * (reading the form, the first explanation, questions, each spoken answer, next steps).
   */
  claudeFastMode: str("CLAUDE_FAST_MODE", "true") === "true",

  elevenLabsApiKey: str("ELEVENLABS_API_KEY"),
  /** Default speaking voice: "Anjali", a warm, patient young Indian woman (native Hindi, Indian English). */
  elevenLabsVoiceId: str("ELEVENLABS_VOICE_ID", "Kfn3fYy8XcPyUvbTxn1H"),
  /** turbo_v2_5: about half the latency of multilingual_v2 for Hindi and English (measured). */
  elevenLabsTtsModel: str("ELEVENLABS_TTS_MODEL", "eleven_turbo_v2_5"),
  elevenLabsSttModel: str("ELEVENLABS_STT_MODEL", "scribe_v2"),

  /** OpenAI speech: an optional second engine the person can switch to. */
  openaiApiKey: str("OPENAI_API_KEY"),
  openaiSttModel: str("OPENAI_STT_MODEL", "gpt-transcribe"),
  openaiLiveSttModel: str("OPENAI_LIVE_STT_MODEL", "gpt-live-transcribe"),
  openaiTtsModel: str("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
  openaiTtsVoice: str("OPENAI_TTS_VOICE", "coral"),

  arkivAccessKey: str("ARKIV_ACCESS_KEY"),
  arkivPrivateKey: str("ARKIV_PRIVATE_KEY"),

  databaseUrl,
  /**
   * Where encrypted documents are kept: "database" (a table in Postgres — required on serverless) or
   * "filesystem" (STORAGE_DIR). Defaults to the database whenever a Postgres URL is configured, and
   * is always the database on serverless hosts, whose disk is wiped when an instance is recycled.
   */
  storageDriver: (!ephemeral && str("STORAGE_DRIVER", databaseUrl ? "database" : "filesystem") === "filesystem"
    ? "filesystem"
    : "database") as "database" | "filesystem",
  /** Request timeout for Claude calls; serverless functions have a hard duration limit. */
  claudeTimeoutMs: Number(str("CLAUDE_TIMEOUT_MS", ephemeral ? "100000" : "120000")),
  claudeMaxRetries: ephemeral ? 1 : 2,
  storageDir: resolve(str("STORAGE_DIR", join(dataDir, "vault"))),
  ocrCacheDir: resolve(str("OCR_CACHE_DIR", join(dataDir, "tessdata"))),
  demoTools: str("NEXT_PUBLIC_DEMO_TOOLS", isProd ? "false" : "true") === "true",
};

export const features = {
  claude: () => Boolean(env.anthropicApiKey),
  elevenLabs: () => Boolean(env.elevenLabsApiKey),
  openai: () => Boolean(env.openaiApiKey),
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
