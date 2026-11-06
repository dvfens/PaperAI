"use client";

import type { LanguageCode } from "@/lib/i18n/languages";
import type { SpeechProvider } from "@/lib/types";
import { api } from "./api";

/**
 * Realtime recognition tokens. Each token opens exactly one socket; the next one is fetched in the
 * background so the following question starts listening without waiting for our server.
 * ElevenLabs tokens last 15 minutes and are language-independent; OpenAI client secrets last
 * 10 minutes and carry the session's language, so they are cached per language.
 */
export type SttToken = { token: string; model: string; expiresAt: number | null };

const REUSE_MS = 8 * 60_000;
const cache = new Map<string, { p: Promise<SttToken>; at: number }>();
const keyOf = (provider: SpeechProvider, lang: LanguageCode) => (provider === "openai" ? `openai:${lang}` : provider);

export function takeToken(provider: SpeechProvider, lang: LanguageCode): Promise<SttToken> {
  const key = keyOf(provider, lang);
  const hit = cache.get(key);
  cache.delete(key);
  const fresh = () => api.sttToken(provider, lang);
  return hit && Date.now() - hit.at < REUSE_MS ? hit.p.catch(fresh) : fresh();
}

export function prefetchToken(provider: SpeechProvider, lang: LanguageCode) {
  const key = keyOf(provider, lang);
  const p = api.sttToken(provider, lang);
  p.catch(() => {
    if (cache.get(key)?.p === p) cache.delete(key);
  });
  cache.set(key, { p, at: Date.now() });
}
