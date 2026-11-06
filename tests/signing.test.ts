import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signatureValid, signaturePayload, signedAtOk, SIGNATURE_MAX_AGE_S } from "@/lib/signing";
import type { FormField } from "@/lib/types";
import { decodeImageBytes } from "@/server/services/image";
import { generateCompletedPdf } from "@/server/services/pdfGeneration";

/** A tiny RGBA PNG encoder, enough for test pictures. */
function png(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const DOC = "a".repeat(64);

describe("document signatures (EIP-712)", () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const signedAt = Math.floor(Date.now() / 1000);

  it("a phone key's signature checks out for exactly that document", async () => {
    const signature = await account.signTypedData(signaturePayload(DOC, signedAt, "finger", "signer"));
    const proof = { signer: account.address, signedAt, method: "finger" as const, role: "signer" as const, signature };
    assert.equal(await signatureValid(DOC, proof), true);
    // Any change to what was signed breaks it.
    assert.equal(await signatureValid("b".repeat(64), proof), false, "another document");
    assert.equal(await signatureValid(DOC, { ...proof, signedAt: signedAt + 1 }), false, "another time");
    assert.equal(await signatureValid(DOC, { ...proof, method: "finger+voice" }), false, "another method");
    const other = privateKeyToAccount(generatePrivateKey());
    assert.equal(await signatureValid(DOC, { ...proof, signer: other.address }), false, "claimed by another key");
    assert.equal(await signatureValid(DOC, { ...proof, signature: "0x1234" }), false, "malformed");
  });

  it("a co-signer's role is part of what they sign", async () => {
    const witness = privateKeyToAccount(generatePrivateKey());
    const signature = await witness.signTypedData(signaturePayload(DOC, signedAt, "tap", "witness"));
    const proof = { signer: witness.address, signedAt, method: "tap" as const, role: "witness" as const, signature };
    assert.equal(await signatureValid(DOC, proof), true);
    assert.equal(await signatureValid(DOC, { ...proof, role: "guarantor" }), false, "a witness signature cannot pass as a guarantor's");
    assert.equal(await signatureValid(DOC, { ...proof, role: "signer" }), false, "nor as the owner's");
  });

  it("accepts signature times only within the allowed window", () => {
    const now = 1_800_000_000;
    assert.equal(signedAtOk(now - 60, SIGNATURE_MAX_AGE_S, now), true);
    assert.equal(signedAtOk(now - SIGNATURE_MAX_AGE_S - 1, SIGNATURE_MAX_AGE_S, now), false);
    assert.equal(signedAtOk(now + 3600, SIGNATURE_MAX_AGE_S, now), false);
    assert.equal(signedAtOk(now + 0.5, SIGNATURE_MAX_AGE_S, now), false, "whole seconds only");
  });
});

describe("signed PDF", () => {
  it("draws the signature in the signature box and adds a signature record page", async () => {
    const page = decodeImageBytes(png(300, 420, () => [255, 255, 255, 255]));
    // A blue scribble on a transparent background.
    const ink = png(120, 40, (x, y) => (Math.abs(y - 20 - 12 * Math.sin(x / 9)) < 2 ? [15, 30, 107, 255] : [0, 0, 0, 0]));
    const fields = [
      { id: "name", label: "Name", type: "text", aiFillable: true, box: { page: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.04 } },
      { id: "sig", label: "Signature", type: "signature", aiFillable: false, box: { page: 0, x: 0.1, y: 0.8, w: 0.4, h: 0.05 } },
    ] as unknown as FormField[];
    const out = await generateCompletedPdf({
      original: { kind: "images", images: [page] },
      fields,
      answers: { name: { value: "Asha Devi", status: "confirmed" } },
      signature: {
        png: ink,
        signer: "0x" + "12".repeat(20),
        signedAt: new Date(),
        method: "finger+voice",
        verifyUrl: "https://example.org/verify",
      },
    });
    assert.equal(out.signedBoxes, 1);
    const doc = await PDFDocument.load(out.bytes);
    assert.equal(doc.getPageCount(), 2, "form page + signature record page");
  });

  it("leaves signature boxes empty without a signature", async () => {
    const page = decodeImageBytes(png(300, 420, () => [255, 255, 255, 255]));
    const fields = [{ id: "sig", label: "Signature", type: "signature", aiFillable: false, box: { page: 0, x: 0.1, y: 0.8, w: 0.4, h: 0.05 } }] as unknown as FormField[];
    const out = await generateCompletedPdf({ original: { kind: "images", images: [page] }, fields, answers: {} });
    assert.equal(out.signedBoxes, 0);
    assert.equal((await PDFDocument.load(out.bytes)).getPageCount(), 1);
  });
});
