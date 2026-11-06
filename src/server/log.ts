import "server-only";

/**
 * Structured logger that refuses to log personal data.
 * Only an event name plus a small set of allow-listed, non-personal metadata keys are written.
 * Request bodies, transcripts, answers, OCR text and file contents are never passed in here.
 */
const ALLOWED_KEYS = new Set([
  "documentId",
  "route",
  "status",
  "durationMs",
  "pages",
  "fields",
  "source",
  "category",
  "language",
  "provider",
  "bytes",
  "code",
  "entityKey",
  "txHash",
  "attempt",
  "reason",
]);

type Meta = Record<string, string | number | boolean | null | undefined>;

function clean(meta?: Meta): Meta {
  if (!meta) return {};
  const out: Meta = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    out[k] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  return out;
}

function write(level: "info" | "warn" | "error", event: string, meta?: Meta) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...clean(meta) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, meta?: Meta) => write("info", event, meta),
  warn: (event: string, meta?: Meta) => write("warn", event, meta),
  error: (event: string, meta?: Meta) => write("error", event, meta),
};

/** Safe description of an error: class name and HTTP status only, never the message (which can echo input). */
export function errorCode(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  // Walk the cause chain (e.g. EntityMutationError > InsufficientFundsError) — names only.
  for (let depth = 0; cur && typeof cur === "object" && depth < 5; depth++) {
    const e = cur as { name?: string; status?: number; code?: string | number; cause?: unknown };
    const label = [e.name, e.status, typeof e.code === "number" || typeof e.code === "string" ? e.code : undefined]
      .filter((x) => x !== undefined && x !== "")
      .join(":");
    if (label && parts[parts.length - 1] !== label) parts.push(label);
    cur = e.cause;
  }
  return parts.join(">") || "Error";
}
