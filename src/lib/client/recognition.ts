"use client";

import { LANGUAGES, type LanguageCode } from "@/lib/i18n/languages";
import type { SpeechHint, SpeechProvider } from "@/lib/types";
import { api } from "./api";
import { canCapturePcm, MicError, primeAudioOnTap } from "./audioCapture";
import { OpenAIRealtimeSpeechInput } from "./openaiRecognition";
import { RealtimeSpeechInput } from "./realtimeRecognition";

export { MicError };

/**
 * Speech INPUT, kept modular so the recogniser can be replaced:
 *  - RealtimeSpeechInput (realtimeRecognition.ts): streams the microphone to ElevenLabs Scribe
 *    realtime, so words appear while the person speaks. Falls back to batch transcription of the
 *    same audio if streaming fails, and to the recorder below if the browser gives it no audio.
 *  - ElevenLabsSpeechInput: records with MediaRecorder, stops automatically after a pause in
 *    speech, and transcribes the recording with ElevenLabs Scribe via our server.
 *  - BrowserSpeechInput: the Web Speech API (Chrome/Edge/Safari), used when ElevenLabs is not set up.
 * Typing is always available as a further option in the UI.
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
  /** What is being answered (question, field type, options): improves recognition. */
  hint?: SpeechHint;
  /** Why this input is being used, for server logs (e.g. "recorder:no-audio"). */
  via?: string;
  onPartial?: (text: string) => void;
  onLevel?: (level: number) => void;
  /** Called when recording ends and transcription starts. */
  onProcessing?: () => void;
}

export interface SpeechInput {
  readonly kind: SpeechProvider | "browser";
  listen(opts: ListenOptions): ListenSession;
}

// ---------------------------------------------------------------------------------------------

/** Records with MediaRecorder and transcribes the recording (ElevenLabs or OpenAI) via our server. */
class RecorderSpeechInput implements SpeechInput {
  constructor(readonly kind: SpeechProvider) {}

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

      // Adaptive voice-activity detection. Phone microphones differ a lot, so the speech threshold is
      // set from the room's own noise floor (measured in the first 400 ms) instead of a fixed level.
      const ctx = new AudioContext();
      // Started without a fresh tap (hands-free), mobile browsers may create the context suspended;
      // a suspended context reads pure silence, so try to resume it and never trust silence alone.
      await ctx.resume().catch(() => undefined);
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const started = performance.now();
      const noise: number[] = [];
      let threshold = 0.02;
      let vadWorking = false; // any non-zero signal seen at all
      let heardSpeech = false;
      let loudSince = 0;
      let lastLoud = 0;
      let manualStop = false;
      let timer = 0;

      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      const stopRecording = () => {
        window.clearInterval(timer);
        if (recorder.state !== "inactive") recorder.stop();
      };
      stopFn = () => {
        manualStop = true;
        stopRecording();
      };

      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        if (rms > 0.0005) vadWorking = true;
        const now = performance.now();
        const elapsed = now - started;
        if (elapsed < 400) {
          noise.push(rms);
          if (noise.length >= 5) {
            const sorted = [...noise].sort((a, b) => a - b);
            threshold = Math.max(0.005, Math.min(0.06, sorted[Math.floor(sorted.length / 5)] * 2.5));
          }
        }
        opts.onLevel?.(Math.min(1, rms / (threshold * 4)));
        if (rms > threshold) {
          loudSince ||= now;
          lastLoud = now;
          if (now - loudSince > 150) heardSpeech = true; // ignore clicks and taps
        } else if (now - lastLoud > 250) {
          loudSince = 0;
        }
        if (
          (heardSpeech && now - lastLoud > 1400) || // finished speaking
          (!heardSpeech && vadWorking && elapsed > 10000) || // nobody spoke
          (!vadWorking && elapsed > 8000) || // meter silent (suspended audio): fixed window
          elapsed > 30000
        ) {
          stopRecording();
        }
      };

      recorder.start(250);
      // A timer, not requestAnimationFrame: it keeps running when the screen dims or the tab is hidden.
      timer = window.setInterval(tick, 50);
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      const duration = performance.now() - started;
      // Always let the recogniser decide: a soft voice may never trip the loudness meter, and making
      // people shout to be heard is exactly what must not happen.
      if (cancelled || duration < 400) return "";
      opts.onProcessing?.();
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const { text } = await api.stt(blob, opts.lang, opts.hint, opts.via ?? "recorder", this.kind);
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

/** The cloud engine to use: the person's choice when it is configured, else whichever is. */
export function pickProvider(cloud: Record<SpeechProvider, boolean>, preferred: SpeechProvider): SpeechProvider | null {
  if (cloud[preferred]) return preferred;
  if (cloud.elevenlabs) return "elevenlabs";
  if (cloud.openai) return "openai";
  return null;
}

export function createSpeechInput(cloud: Record<SpeechProvider, boolean>, preferred: SpeechProvider = "elevenlabs"): SpeechInput | null {
  if (typeof window === "undefined") return null;
  const canRecord = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const provider = pickProvider(cloud, preferred);
  if (provider && canRecord && canCapturePcm()) {
    primeAudioOnTap();
    return provider === "openai"
      ? new OpenAIRealtimeSpeechInput(new RecorderSpeechInput("openai"))
      : new RealtimeSpeechInput(new RecorderSpeechInput("elevenlabs"));
  }
  if (provider && canRecord) return new RecorderSpeechInput(provider);
  if (recognitionCtor()) return new BrowserSpeechInput();
  return null;
}
