"use client";

import { LANGUAGES, type LanguageCode } from "@/lib/i18n/languages";
import type { SpeechProvider, VoiceStyle } from "@/lib/types";
import { api } from "./api";

/**
 * Speech OUTPUT. A cloud voice (ElevenLabs or OpenAI, proxied through our server) when configured,
 * otherwise the browser's built-in speechSynthesis. Swappable behind this interface.
 */
export interface SpeechOutput {
  readonly kind: SpeechProvider | "browser" | "none";
  /** Resolves when speech has finished or was stopped. */
  speak(text: string, lang: LanguageCode): Promise<void>;
  stop(): void;
}

class BrowserSpeechOutput implements SpeechOutput {
  readonly kind = "browser" as const;
  private resolveCurrent: (() => void) | null = null;

  private voiceFor(lang: LanguageCode): SpeechSynthesisVoice | undefined {
    const locale = LANGUAGES[lang].speechLocale.toLowerCase();
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((v) => v.lang.toLowerCase() === locale) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(LANGUAGES[lang].isoCode))
    );
  }

  speak(text: string, lang: LanguageCode) {
    this.stop();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = LANGUAGES[lang].speechLocale;
      const voice = this.voiceFor(lang);
      if (voice) u.voice = voice;
      u.rate = 0.9;
      const done = () => {
        if (this.resolveCurrent === done) this.resolveCurrent = null;
        resolve();
      };
      this.resolveCurrent = done;
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.speak(u);
    });
  }

  stop() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.resolveCurrent?.();
    this.resolveCurrent = null;
  }
}

// --- One audio player for the whole visit ---------------------------------------------------------
// Phone browsers (iPhone above all) only let a page start sound during a tap, or while the microphone
// is on. A reply is spoken after its audio has been fetched, so the tap is long over by then. But an
// audio element that has played once during a tap may play again later without one. So the first
// tap anywhere plays a moment of silence on this one element, and every reply reuses it. This is
// what lets the voice speak in demo mode (no microphone running) and right after typing an answer.
let player: HTMLAudioElement | null = null;
let unlocked = false;
let unlockInstalled = false;

function sharedPlayer(): HTMLAudioElement {
  player ??= new Audio();
  return player;
}

/** 0.05 s of silence as a WAV blob (blob: is allowed by the page's media-src; data: is not). */
function silenceUrl(): string {
  const n = 400;
  const v = new DataView(new ArrayBuffer(44 + n));
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  ascii(36, "data");
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([v.buffer], { type: "audio/wav" }));
}

function unlockAudioOnFirstTap() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const events = ["touchend", "click", "keydown"] as const;
  const unlock = () => {
    if (unlocked) return;
    const p = sharedPlayer();
    // Never interrupt a reply that is already playing.
    if (!p.paused) return;
    const url = silenceUrl();
    p.src = url;
    p.play()
      .then(() => {
        unlocked = true;
        events.forEach((e) => window.removeEventListener(e, unlock, true));
      })
      .catch(() => undefined)
      .finally(() => setTimeout(() => URL.revokeObjectURL(url), 1000));
    // The browser's own voice (the fallback) has the same rule on iPhone: start it once, silently.
    try {
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    } catch {
      // no browser voice
    }
  };
  events.forEach((e) => window.addEventListener(e, unlock, { capture: true, passive: true }));
}

class CloudSpeechOutput implements SpeechOutput {
  private resolveCurrent: (() => void) | null = null;
  private cache = new Map<string, string>();
  private generation = 0;

  constructor(
    readonly kind: SpeechProvider,
    private readonly fallback: SpeechOutput | null,
    private readonly voice?: VoiceStyle,
  ) {}

  async speak(text: string, lang: LanguageCode) {
    this.stop();
    const gen = ++this.generation;
    const key = `${lang}:${text}`;
    let url = this.cache.get(key);
    try {
      if (!url) {
        const blob = await api.tts(text, lang, this.kind, this.kind === "elevenlabs" ? this.voice : undefined);
        url = URL.createObjectURL(blob);
        this.cache.set(key, url);
        if (this.cache.size > 40) {
          const [oldKey, oldUrl] = this.cache.entries().next().value as [string, string];
          URL.revokeObjectURL(oldUrl);
          this.cache.delete(oldKey);
        }
      }
    } catch {
      if (gen !== this.generation) return;
      return this.fallback?.speak(text, lang);
    }
    if (gen !== this.generation) return; // stopped while fetching
    const audio = sharedPlayer();
    await new Promise<void>((resolve) => {
      const done = () => {
        audio.onended = null;
        audio.onerror = null;
        if (this.resolveCurrent === done) this.resolveCurrent = null;
        resolve();
      };
      this.resolveCurrent = done;
      audio.onended = done;
      audio.onerror = done;
      audio.src = url!;
      audio.play().catch(() => {
        // Autoplay blocked (no user gesture yet): use the browser voice instead.
        done();
        void this.fallback?.speak(text, lang);
      });
    });
  }

  stop() {
    this.generation++;
    this.fallback?.stop();
    // Only pause: the shared element keeps its permission to play.
    if (player && !player.paused) player.pause();
    this.resolveCurrent?.();
    this.resolveCurrent = null;
  }
}

class SilentOutput implements SpeechOutput {
  readonly kind = "none" as const;
  async speak() {}
  stop() {}
}

export function createSpeechOutput(provider: SpeechProvider | null, voice?: VoiceStyle): SpeechOutput {
  unlockAudioOnFirstTap();
  const browser = typeof window !== "undefined" && "speechSynthesis" in window ? new BrowserSpeechOutput() : null;
  if (provider) return new CloudSpeechOutput(provider, browser, voice);
  return browser ?? new SilentOutput();
}
