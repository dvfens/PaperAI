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

class CloudSpeechOutput implements SpeechOutput {
  private audio: HTMLAudioElement | null = null;
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
    const audio = new Audio(url);
    this.audio = audio;
    await new Promise<void>((resolve) => {
      const done = () => {
        if (this.resolveCurrent === done) this.resolveCurrent = null;
        resolve();
      };
      this.resolveCurrent = done;
      audio.onended = done;
      audio.onerror = done;
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
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
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
  const browser = typeof window !== "undefined" && "speechSynthesis" in window ? new BrowserSpeechOutput() : null;
  if (provider) return new CloudSpeechOutput(provider, browser, voice);
  return browser ?? new SilentOutput();
}
