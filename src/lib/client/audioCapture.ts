"use client";

/**
 * Microphone capture as raw 16 kHz mono PCM, for streaming speech recognition.
 * Audio stays in memory only for the length of one answer and is never stored.
 */
export const PCM_RATE = 16_000;

export class MicError extends Error {
  constructor(readonly code: "denied" | "unavailable") {
    super(code);
  }
}

// One AudioContext for the whole visit. Mobile browsers only let audio start after a tap, so it is
// resumed on every tap; later hands-free listening (started by a timer, not a tap) then still works.
let shared: AudioContext | null = null;
const withWorklet = new WeakSet<BaseAudioContext>();

function audioContext(): AudioContext {
  if (!shared || shared.state === "closed") shared = new AudioContext();
  return shared;
}

let primed = false;
export function primeAudioOnTap() {
  if (primed || typeof window === "undefined") return;
  primed = true;
  const resume = () => {
    const ctx = audioContext();
    if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
  };
  window.addEventListener("pointerdown", resume, { capture: true, passive: true });
  window.addEventListener("keydown", resume, { capture: true });
}

export function canCapturePcm(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof WebSocket !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/**
 * Averages input samples into output slots: a simple low-pass + decimate, good enough for speech.
 * Output sample k covers input samples [⌊k·r⌋, ⌊(k+1)·r⌋), computed from absolute positions so the
 * result does not depend on how the browser happens to chunk the audio.
 */
export class Downsampler {
  private carry = new Float32Array(0);
  private carryStart = 0; // absolute input index of carry[0]
  private k = 0; // output samples produced so far
  constructor(private readonly ratio: number) {}

  push(input: Float32Array, out: (v: number) => void) {
    const r = this.ratio;
    if (r === 1) {
      for (let i = 0; i < input.length; i++) out(input[i]);
      return;
    }
    const data = new Float32Array(this.carry.length + input.length);
    data.set(this.carry);
    data.set(input, this.carry.length);
    const end = this.carryStart + data.length;
    for (;;) {
      const a = Math.floor(this.k * r);
      const b = Math.max(a + 1, Math.floor((this.k + 1) * r));
      if (b > end) break;
      let sum = 0;
      for (let i = a; i < b; i++) sum += data[i - this.carryStart];
      out(sum / (b - a));
      this.k++;
    }
    const next = Math.floor(this.k * r);
    this.carry = data.slice(next - this.carryStart);
    this.carryStart = next;
  }
}

export interface PcmCapture {
  stop(): void;
}

/**
 * Opens the microphone and calls `onFrame` with every 100 ms of 16-bit PCM and its loudness (RMS).
 * Throws MicError when permission is refused or there is no microphone.
 */
export async function startPcmCapture(onFrame: (pcm: Int16Array, rms: number) => void, rate = PCM_RATE): Promise<PcmCapture> {
  /** 100 ms per frame — inside the chunk sizes both realtime APIs recommend. */
  const FRAME = Math.round(rate / 10);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    throw new MicError((err as DOMException)?.name === "NotAllowedError" ? "denied" : "unavailable");
  }

  try {
    const ctx = audioContext();
    await ctx.resume().catch(() => undefined);
    const source = ctx.createMediaStreamSource(stream);
    const sink = ctx.createGain();
    sink.gain.value = 0; // keep the graph running without playing the microphone back
    sink.connect(ctx.destination);

    const down = new Downsampler(ctx.sampleRate / rate);
    let frame = new Int16Array(FRAME);
    let n = 0;
    let sq = 0;
    let live = true;
    const feed = (input: Float32Array) => {
      if (!live) return;
      down.push(input, (v) => {
        const s = v > 1 ? 1 : v < -1 ? -1 : v;
        frame[n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        sq += s * s;
        if (n === FRAME) {
          const full = frame;
          const rms = Math.sqrt(sq / FRAME);
          frame = new Int16Array(FRAME);
          n = 0;
          sq = 0;
          onFrame(full, rms);
        }
      });
    };

    // AudioWorklet where available (runs off the main thread); ScriptProcessor elsewhere.
    let node: AudioWorkletNode | ScriptProcessorNode;
    try {
      if (!withWorklet.has(ctx)) {
        await ctx.audioWorklet.addModule("/audio/pcm-tap-worklet.js");
        withWorklet.add(ctx);
      }
      const w = new AudioWorkletNode(ctx, "pcm-tap", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
      });
      w.port.onmessage = (e: MessageEvent<Float32Array>) => feed(e.data);
      node = w;
    } catch {
      const sp = ctx.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = (e) => feed(e.inputBuffer.getChannelData(0));
      node = sp;
    }
    source.connect(node);
    node.connect(sink);

    return {
      stop() {
        if (!live) return;
        live = false;
        try {
          source.disconnect();
          node.disconnect();
          sink.disconnect();
        } catch {
          // already disconnected
        }
        if (node instanceof ScriptProcessorNode) node.onaudioprocess = null;
        else node.port.onmessage = null;
        stream.getTracks().forEach((t) => t.stop());
      },
    };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw err;
  }
}

export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 16-bit mono WAV, used to send the same recording to batch transcription if streaming fails. */
export function encodeWav(frames: Int16Array[], rate = PCM_RATE): Blob {
  const samples = frames.reduce((sum, f) => sum + f.length, 0);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  let at = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++, at += 2) v.setInt16(at, f[i], true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/**
 * Loudness-based voice activity, calibrated to the room: the quietest part of the first half second
 * sets the noise floor (so someone who starts talking at once does not raise it), and the threshold
 * stays low enough for a normal or soft voice — nobody should have to shout.
 * Used for the level meter, to notice when someone starts talking again, and as a safety net.
 */
export class VoiceActivity {
  threshold = 0.02;
  heardSpeech = false;
  working = false;
  private noise: number[] = [];
  private loudSince = 0;
  private lastLoud = 0;
  constructor(private readonly started: number) {}

  /** Returns a 0–1 level for the meter. */
  update(rms: number, now: number): number {
    if (rms > 0.0005) this.working = true;
    if (now - this.started < 500) {
      this.noise.push(rms);
      if (this.noise.length >= 3) {
        const sorted = [...this.noise].sort((a, b) => a - b);
        this.threshold = Math.max(0.005, Math.min(0.06, sorted[Math.floor(sorted.length / 5)] * 2.5));
      }
    }
    if (rms > this.threshold) {
      this.loudSince ||= now;
      this.lastLoud = now;
      if (now - this.loudSince >= 150) this.heardSpeech = true; // ignore clicks and taps
    } else if (now - this.lastLoud > 250) {
      this.loudSince = 0;
    }
    return Math.min(1, rms / (this.threshold * 4));
  }

  /** Talking right now (loud for at least 150 ms and still loud). */
  speaking(now: number): boolean {
    return this.loudSince > 0 && now - this.loudSince >= 150 && now - this.lastLoud < 300;
  }

  silentFor(now: number): number {
    return now - (this.lastLoud || this.started);
  }
}
