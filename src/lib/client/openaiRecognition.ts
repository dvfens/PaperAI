"use client";

import { api } from "./api";
import { encodeWav, MicError, pcmToBase64, startPcmCapture, VoiceActivity, type PcmCapture } from "./audioCapture";
import type { ListenOptions, ListenSession, SpeechInput } from "./recognition";
import { prefetchToken, takeToken } from "./sttTokens";

/**
 * Live speech recognition with OpenAI (gpt-live-transcribe), the engine people can switch to.
 *
 * The microphone is streamed as 24 kHz PCM over a WebSocket straight to OpenAI, authorised by a
 * short-lived client secret from our server whose session (model, language, noise reduction) is fixed
 * server-side. Words arrive as deltas while the person speaks. This model has no server-side turn
 * detection, so the end of an answer is decided here: a pause after speech, or no new words for a
 * while; then the audio is committed and the final transcript arrives.
 *
 * As with ElevenLabs, every frame is kept for the length of the answer: if the socket fails, the same
 * audio goes to OpenAI batch transcription; if the browser delivers no audio at all, the
 * MediaRecorder-based input takes over.
 */
const WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
/** The only PCM rate OpenAI realtime accepts. */
const RATE = 24_000;
/** Quiet after speech that ends an answer (older speakers pause, so this is generous). */
const END_SILENCE_MS = 1200;
/** Words stopped arriving although the room is not quiet (TV, traffic): treat the answer as over. */
const STALE_TEXT_MS = 3000;
const CONNECT_TIMEOUT_MS = 6000;
const NO_AUDIO_MS = 1500;
const NO_SPEECH_MS = 12_000;
const MAX_MS = 30_000;
const FINAL_WAIT_MS = 3000;

export class OpenAIRealtimeSpeechInput implements SpeechInput {
  readonly kind = "openai" as const;
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
    let live = "";
    let lastDeltaAt = 0;
    let fallbackReason = "unknown";
    const timers: number[] = [];
    const started = performance.now();
    const vad = new VoiceActivity(started);

    const text = () => live.replace(/\s+/g, " ").trim();
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
      capture?.stop();
      capture = null;
      closeSocket();
    };
    const finish = (value: string) => {
      if (done) return;
      done = true;
      cleanup();
      if (!cancelled && opts.onAudio && frames.length) opts.onAudio(encodeWav(frames, RATE));
      resolve(cancelled ? "" : value);
    };
    const fail = (err: unknown) => {
      if (done) return;
      done = true;
      cleanup();
      if (!cancelled && opts.onAudio && frames.length) opts.onAudio(encodeWav(frames, RATE));
      reject(err);
    };
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const send = (event: Record<string, unknown>) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
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
        const { text: heard } = await api.stt(encodeWav(recorded, RATE), opts.lang, opts.hint, `stream-backup:${fallbackReason}`, "openai");
        finish(heard);
      } catch (err) {
        fail(err);
      }
    };

    /** The answer is over: stop the microphone, commit the audio and wait for the final transcript. */
    const requestFinal = () => {
      if (done || finishing) return;
      finishing = true;
      capture?.stop();
      capture = null;
      opts.onProcessing?.();
      send({ type: "input_audio_buffer.commit" });
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
      let m: { type?: string; delta?: string; transcript?: string; error?: { code?: string; type?: string } };
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      switch (m.type) {
        case "session.created":
          mode = "live";
          for (const chunk of queued.splice(0)) send({ type: "input_audio_buffer.append", audio: chunk });
          prefetchToken("openai", opts.lang);
          if (stopRequested) requestFinal();
          return;
        case "conversation.item.input_audio_transcription.delta":
          if (!m.delta) return;
          live += m.delta;
          lastDeltaAt = performance.now();
          opts.onPartial?.(text());
          return;
        case "conversation.item.input_audio_transcription.completed": {
          const t = (m.transcript ?? live).replace(/\s+/g, " ").trim() || text();
          // Empty after the person's own tap: transcribe the recording rather than "heard nothing".
          if (finishing) return t ? finish(t) : stopRequested ? void transcribeBatch("empty-final") : finish("");
          live = t;
          return;
        }
        case "conversation.item.input_audio_transcription.failed":
          if (finishing) return text() ? finish(text()) : void transcribeBatch("transcription-failed");
          return;
        case "error":
          console.warn("[stt] openai realtime:", m.error?.code ?? m.error?.type);
          socketFailed(`error-${(m.error?.code ?? m.error?.type ?? "unknown").replace(/[^a-z_-]/gi, "").slice(0, 30)}`);
          return;
        default:
          return;
      }
    };

    const onFrame = (pcm: Int16Array, rms: number) => {
      if (done) return;
      frames.push(pcm);
      const now = performance.now();
      opts.onLevel?.(vad.update(rms, now));
      if (finishing) return;
      if (mode === "live") send({ type: "input_audio_buffer.append", audio: pcmToBase64(pcm) });
      else if (mode === "connecting") queued.push(pcmToBase64(pcm));

      const elapsed = now - started;
      if (mode === "batch") {
        if ((vad.heardSpeech && vad.silentFor(now) > 1400) || (!vad.heardSpeech && elapsed > NO_SPEECH_MS) || elapsed > MAX_MS) {
          void transcribeBatch();
        }
        return;
      }
      if (mode !== "live") return;
      if (elapsed > MAX_MS) return requestFinal();
      // A pause after words ends the answer. Without words (a cough, "hmm", thinking) keep listening:
      // only the no-speech rule below may end a wordless session.
      if (text() && vad.heardSpeech && vad.silentFor(now) >= END_SILENCE_MS) return requestFinal();
      if (text() && now - lastDeltaAt > STALE_TEXT_MS) return requestFinal();
      if (!text() && elapsed > NO_SPEECH_MS) return vad.heardSpeech ? requestFinal() : finish("");
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

    // Token and microphone in parallel; audio captured before the session is ready is queued.
    takeToken("openai", opts.lang).then(
      ({ token }) => {
        if (done || mode !== "connecting") return;
        const socket = new WebSocket(WS_URL, ["realtime", `openai-insecure-api-key.${token}`]);
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

    const handOff = (via: string) => {
      done = true;
      cleanup();
      const inner = this.fallback.listen({ ...opts, via });
      ctl.stop = inner.stop;
      ctl.cancel = inner.cancel;
      if (cancelled) inner.cancel();
      inner.result.then(resolve, reject);
    };

    startPcmCapture(onFrame, RATE).then(
      (c) => {
        if (done) return c.stop();
        capture = c;
        // No audio at all (the phone kept audio processing paused): hand over to the recorder.
        later(NO_AUDIO_MS, () => {
          if (!done && !frames.length) handOff("recorder:no-audio");
        });
      },
      (err) => {
        if (err instanceof MicError) return fail(err);
        if (!done) handOff("recorder:capture-error"); // audio processing unsupported here
      },
    );
  }
}
