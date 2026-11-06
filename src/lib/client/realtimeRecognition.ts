"use client";

import { LANGUAGES } from "@/lib/i18n/languages";
import { api } from "./api";
import { encodeWav, MicError, PCM_RATE, pcmToBase64, startPcmCapture, VoiceActivity, type PcmCapture } from "./audioCapture";
import type { ListenOptions, ListenSession, SpeechInput } from "./recognition";
import { prefetchToken, takeToken } from "./sttTokens";

/**
 * Live speech recognition with ElevenLabs Scribe realtime (scribe_v2_realtime).
 *
 * The microphone is streamed as 16 kHz PCM over a WebSocket straight to ElevenLabs, authorised by a
 * single-use token from our server (the API key never reaches the browser). Words appear while the
 * person is still speaking, and ElevenLabs' own voice-activity detection decides when they finished.
 *
 * Every frame is also kept in memory for the length of the answer, so if the socket fails at any point
 * the same audio is sent to batch transcription instead and nothing the person said is lost. If the
 * browser delivers no audio at all (some phones block audio processing until a tap), the session is
 * handed to the MediaRecorder-based input.
 */
const WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
/**
 * Pause that ends an answer. Speaking again within the grace period below keeps the answer open,
 * so a mid-sentence pause is not cut off. (1.2 s and 1.5 s measured equally accurate; 1.2 s answers
 * sooner.)
 */
const VAD_SILENCE_SECS = 1.2;
/** After a final transcript, wait this long for the person to carry on before accepting it. */
const GRACE_MS = 400;
const CONNECT_TIMEOUT_MS = 5000;
const NO_AUDIO_MS = 1500;
const NO_SPEECH_MS = 12_000;
const MAX_MS = 30_000;
const FINAL_WAIT_MS = 2500;

const ERRORS = new Set([
  "error",
  "auth_error",
  "quota_exceeded",
  "commit_throttled",
  "unaccepted_terms",
  "rate_limited",
  "queue_overflow",
  "resource_exhausted",
  "session_time_limit_exceeded",
  "input_error",
  "invalid_request",
  "chunk_size_exceeded",
  "insufficient_audio_activity",
  "transcriber_error",
]);


export class RealtimeSpeechInput implements SpeechInput {
  readonly kind = "elevenlabs" as const;
  constructor(private readonly fallback: SpeechInput) {}

  listen(opts: ListenOptions): ListenSession {
    const ctl = { stop: () => {}, cancel: () => {} };
    const result = new Promise<string>((resolve, reject) => this.run(opts, ctl, resolve, reject));
    return { result, stop: () => ctl.stop(), cancel: () => ctl.cancel() };
  }

  private run(
    opts: ListenOptions,
    ctl: { stop: () => void; cancel: () => void },
    resolve: (text: string) => void,
    reject: (err: unknown) => void,
  ) {
    let done = false;
    let cancelled = false;
    let stopRequested = false;
    let mode: "connecting" | "live" | "batch" = "connecting";
    let finishing = false;
    let capture: PcmCapture | null = null;
    let ws: WebSocket | null = null;
    const queued: string[] = [];
    const frames: Int16Array[] = [];
    const committed: string[] = [];
    let partial = "";
    let fallbackReason = "unknown";
    let lastChange = 0;
    let lastCommitAt = 0;
    let graceTimer = 0;
    const timers: number[] = [];
    const started = performance.now();
    const vad = new VoiceActivity(started);

    const text = () => [...committed, partial].join(" ").replace(/\s+/g, " ").trim();
    const closeSocket = () => {
      if (!ws) return;
      ws.onmessage = ws.onclose = ws.onerror = ws.onopen = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
      ws = null;
    };
    const cleanup = () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(graceTimer);
      capture?.stop();
      capture = null;
      closeSocket();
    };
    const finish = (value: string) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(cancelled ? "" : value);
    };
    const fail = (err: unknown) => {
      if (done) return;
      done = true;
      cleanup();
      reject(err);
    };
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const send = (audioBase64: string, commit = false) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: audioBase64, commit, sample_rate: PCM_RATE }));
      }
    };

    /** Streaming is unavailable: transcribe the whole recording in one request instead. */
    let batching = false;
    const transcribeBatch = async (reason?: string) => {
      if (done || batching) return; // never upload the same recording twice
      batching = true;
      if (reason) fallbackReason = reason;
      mode = "batch";
      finishing = true;
      capture?.stop();
      capture = null;
      closeSocket();
      const recorded = frames.slice();
      // Do not judge by loudness: a soft voice may never trip the meter. Let the recogniser decide.
      if (cancelled || recorded.length < 4) return finish("");
      opts.onProcessing?.();
      try {
        const { text: heard } = await api.stt(encodeWav(recorded), opts.lang, opts.hint, `stream-backup:${fallbackReason}`, "elevenlabs");
        finish(heard);
      } catch (err) {
        fail(err);
      }
    };

    /** Live: stop the microphone and ask ElevenLabs for the final text of what it has heard. */
    const requestFinal = () => {
      if (done || finishing) return;
      finishing = true;
      capture?.stop();
      capture = null;
      opts.onProcessing?.();
      send("", true);
      later(FINAL_WAIT_MS, () => (text() ? finish(text()) : stopRequested ? void transcribeBatch("no-final-text") : finish("")));
    };

    const socketFailed = (reason: string) => {
      if (done) return;
      fallbackReason = reason;
      closeSocket();
      if (finishing) {
        if (text()) finish(text());
        else void transcribeBatch();
        return;
      }
      mode = "batch"; // keep recording; the batch path takes over when they stop speaking
      if (stopRequested) void transcribeBatch();
    };

    const onMessage = (raw: string) => {
      let m: { message_type?: string; text?: string };
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      const now = performance.now();
      switch (m.message_type) {
        case "session_started":
          mode = "live";
          for (const chunk of queued.splice(0)) send(chunk);
          prefetchToken("elevenlabs", opts.lang);
          if (stopRequested) requestFinal();
          return;
        case "partial_transcript": {
          const t = (m.text ?? "").trim();
          // Partials double as keep-alives, which may repeat text that was already committed.
          if (!t || t === partial || t === committed[committed.length - 1]) return;
          partial = t;
          lastChange = now;
          opts.onPartial?.(text());
          return;
        }
        case "committed_transcript": {
          const t = (m.text ?? "").trim();
          if (t) {
            committed.push(t);
            partial = "";
            lastChange = now;
            lastCommitAt = now;
            opts.onPartial?.(text());
          }
          if (finishing) return text() ? finish(text()) : stopRequested ? void transcribeBatch("empty-final") : finish("");
          if (t && !vad.speaking(now)) {
            window.clearTimeout(graceTimer);
            graceTimer = window.setTimeout(() => finish(text()), GRACE_MS);
          }
          return;
        }
        default:
          if (m.message_type && ERRORS.has(m.message_type)) {
            console.warn("[stt] realtime:", m.message_type);
            socketFailed(m.message_type.replace(/_/g, "-"));
          }
      }
    };

    const onFrame = (pcm: Int16Array, rms: number) => {
      if (done) return;
      frames.push(pcm);
      const now = performance.now();
      opts.onLevel?.(vad.update(rms, now));
      if (finishing) return;
      if (mode === "live") send(pcmToBase64(pcm));
      else if (mode === "connecting") queued.push(pcmToBase64(pcm));

      // They started talking again after a pause: keep listening for the rest of the answer.
      if (graceTimer && rms > vad.threshold) {
        window.clearTimeout(graceTimer);
        graceTimer = 0;
      }
      const elapsed = now - started;
      if (mode === "batch") {
        if ((vad.heardSpeech && vad.silentFor(now) > 1400) || (!vad.heardSpeech && elapsed > NO_SPEECH_MS) || elapsed > MAX_MS) {
          void transcribeBatch();
        }
        return;
      }
      if (mode !== "live") return;
      // Safety nets in case ElevenLabs' end-of-speech never arrives.
      if (elapsed > MAX_MS) return requestFinal();
      if (partial && now - lastChange > 4000) return requestFinal();
      // An answer is in, and whatever sounded like more speech produced no words: accept the answer.
      if (committed.length && !partial && !graceTimer && now - lastCommitAt > 1000 && (vad.silentFor(now) > 2500 || now - lastCommitAt > 6000)) {
        return finish(text());
      }
      if (!committed.length && !partial && elapsed > NO_SPEECH_MS) return vad.heardSpeech ? requestFinal() : finish("");
    };

    ctl.cancel = () => {
      cancelled = true;
      finish("");
    };
    ctl.stop = () => {
      stopRequested = true;
      if (mode === "live") requestFinal();
      else void transcribeBatch(mode === "connecting" ? "stopped-while-connecting" : undefined);
    };

    // Token and microphone in parallel; audio captured before the socket is ready is queued.
    takeToken("elevenlabs", opts.lang).then(
      ({ token: tok, model }) => {
        if (done || mode !== "connecting") return;
        const q = new URLSearchParams({
          model_id: model,
          token: tok,
          audio_format: "pcm_16000",
          language_code: LANGUAGES[opts.lang].isoCode,
          commit_strategy: "vad",
          vad_silence_threshold_secs: String(VAD_SILENCE_SECS),
          filter_background_audio: "true", // ignore a TV or other people in the room
          no_verbatim: "true", // drop fillers and false starts
        });
        const socket = new WebSocket(`${WS_URL}?${q}`);
        ws = socket;
        socket.onmessage = (e) => onMessage(String(e.data));
        socket.onclose = () => socketFailed("socket-closed");
        socket.onerror = () => undefined; // onclose follows
      },
      () => {
        if (!done && mode === "connecting") socketFailed("no-token");
      },
    );
    later(CONNECT_TIMEOUT_MS, () => {
      if (mode === "connecting") socketFailed("connect-timeout");
    });

    startPcmCapture(onFrame).then(
      (c) => {
        if (done) return c.stop();
        capture = c;
        // No audio at all (the phone kept audio processing paused): hand over to the recorder.
        later(NO_AUDIO_MS, () => {
          if (done || frames.length) return;
          done = true;
          cleanup();
          const inner = this.fallback.listen({ ...opts, via: "recorder:no-audio" });
          ctl.stop = inner.stop;
          ctl.cancel = inner.cancel;
          if (cancelled) inner.cancel();
          inner.result.then(resolve, reject);
        });
      },
      (err) => {
        if (err instanceof MicError) return fail(err);
        // Audio processing unsupported here: use the recorder instead.
        if (done) return;
        done = true;
        cleanup();
        const inner = this.fallback.listen({ ...opts, via: "recorder:capture-error" });
        ctl.stop = inner.stop;
        ctl.cancel = inner.cancel;
        inner.result.then(resolve, reject);
      },
    );
  }
}
