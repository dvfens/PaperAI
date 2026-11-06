import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decryptDocument, encryptDocument } from "@/server/crypto";
import { env } from "@/server/env";

/**
 * SecureStorageService — stores completed PDFs encrypted at rest.
 * The interface is storage-agnostic so the local-disk implementation can be swapped for S3/GCS
 * (with server-side encryption on top of this envelope encryption) without touching callers.
 */
export interface SecureStorageService {
  put(documentId: string, plaintext: Uint8Array): Promise<{ storageKey: string; wrappedKey: string }>;
  get(documentId: string, storageKey: string, wrappedKey: string): Promise<Buffer>;
  /** Crypto-shred + overwrite + unlink. Callers must also delete the wrapped key. */
  destroy(storageKey: string): Promise<void>;
}

const SAFE_KEY = /^[a-f0-9-]{36}\.bin$/;

class LocalEncryptedStorage implements SecureStorageService {
  constructor(private readonly dir: string) {}

  private path(storageKey: string) {
    if (!SAFE_KEY.test(storageKey)) throw new Error("invalid storage key");
    return join(this.dir, storageKey);
  }

  async put(documentId: string, plaintext: Uint8Array) {
    await mkdir(this.dir, { recursive: true });
    const { ciphertext, wrappedKey } = encryptDocument(documentId, plaintext);
    const storageKey = `${randomUUID()}.bin`;
    await writeFile(this.path(storageKey), ciphertext, { mode: 0o600, flag: "wx" });
    return { storageKey, wrappedKey };
  }

  async get(documentId: string, storageKey: string, wrappedKey: string) {
    const ciphertext = await readFile(this.path(storageKey));
    return decryptDocument(documentId, ciphertext, wrappedKey);
  }

  async destroy(storageKey: string) {
    const p = this.path(storageKey);
    try {
      const { size } = await stat(p);
      // Best-effort overwrite before unlinking. On SSDs/copy-on-write filesystems an overwrite is not
      // guaranteed to hit the same blocks — the real guarantee is that the wrapped data key is deleted
      // (crypto-shredding), which the caller does in the same operation.
      const fh = await open(p, "r+");
      try {
        await fh.write(randomBytes(size), 0, size, 0);
        await fh.sync();
      } finally {
        await fh.close();
      }
      await unlink(p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

let instance: SecureStorageService | null = null;
export function secureStorage(): SecureStorageService {
  instance ??= new LocalEncryptedStorage(env.storageDir);
  return instance;
}
