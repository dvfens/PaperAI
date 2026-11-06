import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Downsampler, encodeWav, PCM_RATE, pcmToBase64, VoiceActivity } from "@/lib/client/audioCapture";

const collect = (d: Downsampler, chunks: Float32Array[]) => {
  const out: number[] = [];
  for (const c of chunks) d.push(c, (v) => out.push(v));
  return out;
};

describe("Downsampler", () => {
  it("turns 48 kHz into 16 kHz, averaging each group of three samples", () => {
    const input = Float32Array.from({ length: 4800 }, (_, i) => i % 3); // 0,1,2 → average 1
    const out = collect(new Downsampler(48_000 / PCM_RATE), [input]);
    assert.equal(out.length, 1600);
    assert.ok(out.every((v) => Math.abs(v - 1) < 1e-6));
  });

  it("gives the same output whatever size the incoming chunks are", () => {
    const signal = Float32Array.from({ length: 44_100 }, (_, i) => Math.sin(i / 20));
    const whole = collect(new Downsampler(44_100 / PCM_RATE), [signal]);
    const pieces: Float32Array[] = [];
    for (let i = 0; i < signal.length; i += 128) pieces.push(signal.subarray(i, i + 128));
    const chunked = collect(new Downsampler(44_100 / PCM_RATE), pieces);
    assert.equal(chunked.length, whole.length);
    assert.ok(Math.abs(whole.length - 16_000) <= 1);
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
    assert.ok(vad.threshold >= 0.04);
    for (let t = 500; t < 1500; t += 100) vad.update(0.015, t);
    assert.equal(vad.heardSpeech, false);
  });
});
