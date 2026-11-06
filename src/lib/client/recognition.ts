"use client";

import { LANGUAGES, type LanguageCode } from "@/lib/i18n/languages";
import { api } from "./api";

/**
 * Speech INPUT, kept modular so the recogniser can be replaced:
 *  - ElevenLabsSpeechInput: records with MediaRecorder, stops automatically after a pause in
 *    speech, and transcribes with ElevenLabs Scribe via our server (best Hindi accuracy).
 *  - BrowserSpeechInput: the Web Speech API (Chrome/Edge/Safari), used when ElevenLabs is not set up.
 * Typing is always available as a third option in the UI.
 */
export interface ListenSession {
  /** Final transcript ("" when nothing was heard). */
  result: Promise<string>;
  /** Stop listening and transcribe what was said so far. */
  stop(): void;
  /** Abort without a result. */
  cancel(): void;
}

export interface ListenOptions {
  lang: LanguageCode;
  onPartial?: (text: string) => void;
  onLevel?: (level: number) => void;
  /** Called when recording ends and transcription starts. */
  onProcessing?: () => void;
}

export interface SpeechInput {
  readonly kind: "elevenlabs" | "browser";
  listen(opts: ListenOptions): ListenSession;
}

export class MicError extends Error {
  constructor(readonly code: "denied" | "unavailable") {
    super(code);
  }
}

// ---------------------------------------------------------------------------------------------

class ElevenLabsSpeechInput implements SpeechInput {
  readonly kind = "elevenlabs" as const;

  listen(opts: ListenOptions): ListenSession {
    let stopFn: () => void = () => {};
    let cancelled = false;

    const result = (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        throw new MicError((err as DOMException)?.name === "NotAllowedError" ? "denied" : "unavailable");
      }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

      // Simple voice-activity detection: stop after ~1.6 s of quiet once speech has started.
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const started = performance.now();
      let heardSpeech = false;
      let lastLoud = performance.now();
      let raf = 0;

      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      const stopRecording = () => {
        cancelAnimationFrame(raf);
        if (recorder.state !== "inactive") recorder.stop();
      };
      stopFn = stopRecording;

      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        opts.onLevel?.(Math.min(1, rms * 12));
        const now = performance.now();
        if (rms > 0.03) {
          heardSpeech = true;
          lastLoud = now;
        }
        const elapsed = now - started;
        if ((heardSpeech && now - lastLoud > 1600) || (!heardSpeech && elapsed > 9000) || elapsed > 30000) {
          stopRecording();
          return;
        }
        raf = requestAnimationFrame(tick);
      };

      recorder.start(250);
      raf = requestAnimationFrame(tick);
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      if (cancelled || !heardSpeech) return "";
      opts.onProcessing?.();
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const { text } = await api.stt(blob, opts.lang);
      return text;
    })();

    return {
      result,
      stop: () => stopFn(),
      cancel: () => {
        cancelled = true;
        stopFn();
      },
    };
  }
}

// ---------------------------------------------------------------------------------------------

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

class BrowserSpeechInput implements SpeechInput {
  readonly kind = "browser" as const;

  listen(opts: ListenOptions): ListenSession {
    const Ctor = recognitionCtor()!;
    const rec = new Ctor();
    rec.lang = LANGUAGES[opts.lang].speechLocale;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    let cancelled = false;

    const result = new Promise<string>((resolve, reject) => {
      rec.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        finalText = text;
        opts.onPartial?.(text);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") reject(new MicError("denied"));
        else if (e.error === "audio-capture") reject(new MicError("unavailable"));
        // "no-speech" / "aborted" end normally with an empty result
      };
      rec.onend = () => resolve(cancelled ? "" : finalText.trim());
    });
    try {
      rec.start();
    } catch {
      // already started
    }
    return { result, stop: () => rec.stop(), cancel: () => ((cancelled = true), rec.abort()) };
  }
}

export function createSpeechInput(elevenLabsAvailable: boolean): SpeechInput | null {
  if (typeof window === "undefined") return null;
  const canRecord = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  if (elevenLabsAvailable && canRecord) return new ElevenLabsSpeechInput();
  if (recognitionCtor()) return new BrowserSpeechInput();
  return null;
}
