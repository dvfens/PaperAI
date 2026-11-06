import "server-only";
import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hmacHex, randomToken } from "@/server/crypto";
import { env } from "@/server/env";
import { errorCode, log } from "@/server/log";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function jsonError(status: number, code: string, message?: string) {
  return NextResponse.json({ error: { code, message: message ?? code } }, { status });
}

/** Wraps a route handler: consistent error responses and PII-free logging. */
export function route<C>(name: string, handler: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C) => {
    const started = Date.now();
    try {
      const res = await handler(req, ctx);
      log.info("api", { route: name, status: res.status, durationMs: Date.now() - started });
      return res;
    } catch (err) {
      if (err instanceof HttpError) {
        log.warn("api", { route: name, status: err.status, code: err.code, durationMs: Date.now() - started });
        return jsonError(err.status, err.code, err.message);
      }
      if (err instanceof z.ZodError) {
        log.warn("api", { route: name, status: 400, code: "invalid_request", durationMs: Date.now() - started });
        return jsonError(400, "invalid_request", "The request was not in the expected format.");
      }
      log.error("api", { route: name, status: 500, code: errorCode(err), durationMs: Date.now() - started });
      return jsonError(500, "internal_error", "Something went wrong.");
    }
  };
}

/** CSRF defence for state-changing requests: the Origin must be this site. */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers / server-to-server
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "bad_origin", "Cross-site request blocked.");
  }
  // Compare hosts, not full origins: behind an HTTPS proxy or tunnel the app itself is reached over
  // plain http, so the scheme the server sees differs from the browser's. The host is what matters.
  const allowed = new Set([req.nextUrl.host, new URL(env.appUrl).host]);
  for (const h of [req.headers.get("x-forwarded-host"), req.headers.get("host")]) {
    if (h) allowed.add(h.split(",")[0].trim());
  }
  if (!allowed.has(originHost)) throw new HttpError(403, "bad_origin", "Cross-site request blocked.");
}

// --- Rate limiting (in-memory token bucket; swap for Redis when running more than one instance) ---
const buckets = new Map<string, { tokens: number; updated: number }>();

export function rateLimit(req: NextRequest, bucket: string, perMinute: number) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, updated: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.updated) / 60_000) * perMinute);
  b.updated = now;
  if (b.tokens < 1) throw new HttpError(429, "rate_limited", "Too many requests.");
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.updated > 300_000) buckets.delete(k);
  }
}

// --- Public address as the browser sees it (works behind HTTPS proxies and tunnels) ---
function forwarded(value: string | null): string | null {
  return value ? value.split(",")[0].trim() || null : null;
}

async function requestScheme(): Promise<"https" | "http"> {
  const h = await headers();
  return forwarded(h.get("x-forwarded-proto")) === "https" ? "https" : "http";
}

/** Base URL for links shown to people: APP_URL when configured, otherwise the address of this request. */
export function publicBaseUrl(req: NextRequest): string {
  if (process.env.APP_URL?.trim()) return env.appUrl.replace(/\/$/, "");
  const proto = forwarded(req.headers.get("x-forwarded-proto")) ?? req.nextUrl.protocol.replace(":", "");
  const host = forwarded(req.headers.get("x-forwarded-host")) ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

// --- Device identity (no accounts: a random HttpOnly cookie identifies the owner's device) ---
const DEVICE_COOKIE = "saathi_device";

export async function deviceOwnerHash(create: boolean): Promise<string | null> {
  const jar = await cookies();
  let token = jar.get(DEVICE_COOKIE)?.value ?? null;
  if (!token && create) {
    token = randomToken(32);
    jar.set(DEVICE_COOKIE, token, {
      httpOnly: true,
      // Secure whenever the browser reached us over HTTPS (directly or via a proxy/tunnel).
      secure: env.isProd && (await requestScheme()) === "https",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return token ? hmacHex(`device:${token}`) : null;
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T, maxBytes = 2_000_000): Promise<z.infer<T>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new HttpError(413, "too_large", "Request too large.");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "too_large", "Request too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be JSON.");
  }
  return schema.parse(body);
}

/** Read one uploaded file from multipart form data, bounded in size. */
export async function formFile(form: FormData, name: string, maxBytes: number): Promise<Buffer | null> {
  const v = form.get(name);
  if (!v || typeof v === "string") return null;
  if (v.size > maxBytes) throw new HttpError(413, "too_large", "File too large.");
  return Buffer.from(await v.arrayBuffer());
}

export async function readForm(req: NextRequest, maxBytes: number): Promise<FormData> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new HttpError(413, "too_large", "Upload too large.");
  try {
    return await req.formData();
  } catch {
    throw new HttpError(400, "invalid_form", "Expected multipart form data.");
  }
}

export function formJson<T extends z.ZodType>(form: FormData, name: string, schema: T): z.infer<T> {
  const raw = form.get(name);
  if (typeof raw !== "string") throw new HttpError(400, "invalid_request", `Missing ${name}.`);
  try {
    return schema.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof z.ZodError) throw err;
    throw new HttpError(400, "invalid_json", `${name} must be JSON.`);
  }
}
