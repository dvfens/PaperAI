import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Downsampler, encodeWav, PCM_RATE, pcmToBase64, VoiceActivity } from "@/lib/client/audioCapture";

const collect = (d: Downsampler, chunks: Float32Array[]) => {
  const out: number[] = [];
  for (const c of chunks) d.push(c, (v) => out.push(v));
  return out;
};

describe("Downsampler", () => {
  const tone = (f: number, rate: number, seconds = 1) => Float32Array.from({ length: rate * seconds }, (_, i) => Math.sin((2 * Math.PI * f * i) / rate));
  const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const gainDb = (f: number, from: number, to: number) => {
    const out = collect(new Downsampler(from / to), [tone(f, from)]);
    return 20 * Math.log10(rms(out.slice(200)) / Math.SQRT1_2);
  };

  it("keeps the speech band intact when going from 48 kHz to 16 kHz", () => {
    for (const f of [300, 1000, 3000, 5000]) assert.ok(Math.abs(gainDb(f, 48000, 16000)) < 0.7, `${f} Hz`);
  });

  it("stops high sounds folding back into the speech band (48 kHz, 44.1 kHz → 16 kHz)", () => {
    for (const f of [9000, 12000, 14000]) assert.ok(gainDb(f, 48000, 16000) < -40, `${f} Hz at 48 kHz`);
    for (const f of [10000, 15000]) assert.ok(gainDb(f, 44100, 16000) < -40, `${f} Hz at 44.1 kHz`);
  });

  it("keeps DC level and produces about one output per ratio input samples", () => {
    const out = collect(new Downsampler(3), [new Float32Array(4800).fill(0.5)]);
    assert.ok(out.length > 1560 && out.length <= 1600);
    assert.ok(out.slice(20).every((v) => Math.abs(v - 0.5) < 0.005));
  });

  it("gives the same output whatever size the incoming chunks are", () => {
    const signal = Float32Array.from({ length: 44_100 }, (_, i) => Math.sin(i / 20));
    const whole = collect(new Downsampler(44_100 / PCM_RATE), [signal]);
    const pieces: Float32Array[] = [];
    for (let i = 0; i < signal.length; i += 128) pieces.push(signal.subarray(i, i + 128));
    const chunked = collect(new Downsampler(44_100 / PCM_RATE), pieces);
    assert.equal(chunked.length, whole.length);
    assert.ok(Math.abs(whole.length - 16_000) <= 20);
    assert.ok(chunked.every((v, i) => Math.abs(v - whole[i]) < 1e-6));
  });

  it("passes 16 kHz audio through unchanged", () => {
    const input = Float32Array.from([0.1, -0.2, 0.3]);
    assert.deepEqual(collect(new Downsampler(1), [input]), [...input]);
  });
});

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM WAV header and the samples", async () => {
    const blob = encodeWav([Int16Array.from([1, -1, 32767]), Int16Array.from([-32768])]);
    assert.equal(blob.type, "audio/wav");
    const v = new DataView(await blob.arrayBuffer());
    const str = (at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));
    assert.equal(str(0, 4), "RIFF");
    assert.equal(str(8, 4), "WAVE");
    assert.equal(v.getUint16(22, true), 1); // mono
    assert.equal(v.getUint32(24, true), PCM_RATE);
    assert.equal(v.getUint16(34, true), 16);
    assert.equal(v.getUint32(40, true), 8); // 4 samples × 2 bytes
    assert.deepEqual([44, 46, 48, 50].map((at) => v.getInt16(at, true)), [1, -1, 32767, -32768]);
  });
});

describe("pcmToBase64", () => {
  it("encodes little-endian 16-bit samples", () => {
    assert.equal(pcmToBase64(Int16Array.from([1, 256])), Buffer.from([1, 0, 0, 1]).toString("base64"));
  });
});

describe("VoiceActivity", () => {
  it("calibrates to the room, then detects speech and the pause after it", () => {
    const vad = new VoiceActivity(0);
    let t = 0;
    const feed = (rms: number, frames: number) => {
      for (let i = 0; i < frames; i++, t += 100) vad.update(rms, t);
    };
    feed(0.004, 5); // quiet room: threshold ≈ 3 × noise floor (≥ 0.008)
    assert.ok(vad.threshold >= 0.008 && vad.threshold < 0.02);
    assert.equal(vad.heardSpeech, false);
    feed(0.1, 1); // a single click is not speech
    assert.equal(vad.heardSpeech, false);
    feed(0.004, 3);
    feed(0.1, 5); // half a second of voice
    assert.equal(vad.heardSpeech, true);
    assert.equal(vad.speaking(t - 100), true);
    feed(0.004, 15);
    assert.equal(vad.speaking(t), false);
    assert.ok(vad.silentFor(t) >= 1400);
  });

  it("raises the threshold in a noisy room so background noise is not speech", () => {
    const vad = new VoiceActivity(0);
    for (let t = 0; t < 500; t += 100) vad.update(0.015, t);
    assert.ok(vad.threshold >= 0.025);
    for (let t = 500; t < 1500; t += 100) vad.update(0.015, t);
    assert.equal(vad.heardSpeech, false);
  });
});

describe("VoiceActivity in a noisy room", () => {
  it("does not treat fluctuating room noise (0.02–0.035) as speech", () => {
    const vad = new VoiceActivity(0);
    const noise = (i: number) => 0.02 + ((i * 7) % 16) / 1000;
    for (let i = 0; i < 40; i++) vad.update(noise(i), i * 100);
    assert.equal(vad.heardSpeech, false);
    assert.ok(vad.threshold > 0.035);
  });
});

describe("keytermsFor", () => {
  it("lists yes/no words in both languages when confirming", async () => {
    const { keytermsFor } = await import("@/lib/speechHints");
    const terms = keytermsFor({ kind: "yesno" });
    for (const w of ["yes", "no", "हाँ", "नहीं"]) assert.ok(terms.includes(w));
  });

  it("uses the options of a choice field, cleaned to the allowed format", async () => {
    const { keytermsFor } = await import("@/lib/speechHints");
    const terms = keytermsFor({ kind: "choice", options: ["Male", "Female", "Other [specify]", "x".repeat(60), "one two three four five six"] });
    assert.deepEqual(terms, ["Male", "Female", "Other specify"]);
  });

  it("adds nothing for free-text answers or without a hint", async () => {
    const { keytermsFor } = await import("@/lib/speechHints");
    assert.deepEqual(keytermsFor({ kind: "text" }), []);
    assert.deepEqual(keytermsFor(undefined), []);
  });
});

describe("compactHint", () => {
  it("sends options only for choice fields, trimmed to keyterm-sized entries", async () => {
    const { compactHint } = await import("@/lib/speechHints");
    assert.deepEqual(compactHint("yesno"), { kind: "yesno" });
    assert.deepEqual(compactHint("text", ["a", "b"]), { kind: "text" });
    const many = Array.from({ length: 36 }, (_, i) => `State ${i}`);
    const hint = compactHint("choice", [...many, "y".repeat(80)]);
    assert.equal(hint.options?.length, 20);
    assert.ok(hint.options?.every((o) => o.length <= 50));
  });
});
