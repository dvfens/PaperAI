import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { secret } from "@/server/env";

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacHex(data: string): string {
  return createHmac("sha256", secret("APP_SECRET")).update(data).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]*$/i.test(a) || !/^[0-9a-f]*$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Token handed to the browser with a generated PDF, proving Paper AI produced exactly these bytes. */
/**
 * Proof that Paper AI produced this exact PDF. A signed PDF's token is also bound to the signer key
 * printed on its signature page, so it can only be saved together with that key's signature.
 */
export function generationToken(sha256: string, signer?: string): string {
  return hmacHex(signer ? `generated:${sha256}:signer:${signer.toLowerCase()}` : `generated:${sha256}`);
}

const IV = 12;
const TAG = 16;

function seal(key: Buffer, plaintext: Uint8Array, aad: string): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function open(key: Buffer, sealed: Uint8Array, aad: string): Buffer {
  const buf = Buffer.from(sealed);
  const iv = buf.subarray(0, IV);
  const tag = buf.subarray(IV, IV + TAG);
  const ct = buf.subarray(IV + TAG);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Envelope encryption. Each document gets its own random data key; the data key is wrapped with the
 * master key (DOCUMENT_ENCRYPTION_KEY) and stored in the database. Deleting the wrapped key makes the
 * ciphertext unrecoverable (crypto-shredding), even if a disk block survives deletion.
 */
export function encryptDocument(documentId: string, plaintext: Uint8Array) {
  const dataKey = randomBytes(32);
  const ciphertext = seal(dataKey, plaintext, `doc:${documentId}`);
  const wrappedKey = seal(secret("DOCUMENT_ENCRYPTION_KEY"), dataKey, `key:${documentId}`).toString("base64");
  dataKey.fill(0);
  return { ciphertext, wrappedKey };
}

export function decryptDocument(documentId: string, ciphertext: Uint8Array, wrappedKey: string): Buffer {
  const dataKey = open(secret("DOCUMENT_ENCRYPTION_KEY"), Buffer.from(wrappedKey, "base64"), `key:${documentId}`);
  try {
    return open(dataKey, ciphertext, `doc:${documentId}`);
  } finally {
    dataKey.fill(0);
  }
}
