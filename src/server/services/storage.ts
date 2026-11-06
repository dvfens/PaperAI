import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { decryptDocument, encryptDocument } from "@/server/crypto";
import { db } from "@/server/db/client";
import { env } from "@/server/env";

/**
 * SecureStorageService — stores completed PDFs encrypted at rest.
 * Two implementations behind one interface:
 *  - LocalEncryptedStorage: files on disk (local development, single servers);
 *  - DatabaseEncryptedStorage: rows in Postgres (serverless hosts such as Vercel, which have no
 *    persistent disk). Either way the bytes are AES-256-GCM ciphertext under a per-document key.
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

class DatabaseEncryptedStorage implements SecureStorageService {
  async put(documentId: string, plaintext: Uint8Array) {
    const { ciphertext, wrappedKey } = encryptDocument(documentId, plaintext);
    const storageKey = `${randomUUID()}.bin`;
    const d = await db();
    await d.execute(sql`INSERT INTO vault_objects (storage_key, ciphertext) VALUES (${storageKey}, ${ciphertext})`);
    return { storageKey, wrappedKey };
  }

  async get(documentId: string, storageKey: string, wrappedKey: string) {
    if (!SAFE_KEY.test(storageKey)) throw new Error("invalid storage key");
    const d = await db();
    const res = (await d.execute(sql`SELECT ciphertext FROM vault_objects WHERE storage_key = ${storageKey}`)) as unknown as {
      rows: { ciphertext: Uint8Array }[];
    };
    const row = res.rows[0];
    if (!row) throw new Error("document not found in vault");
    return decryptDocument(documentId, Buffer.from(row.ciphertext), wrappedKey);
  }

  async destroy(storageKey: string) {
    // Removes the ciphertext from the live database (the caller has already deleted the wrapped key).
    // Postgres MVCC and the provider's restore history can keep old copies of both for a while — see
    // db/migrations/0002_vault_objects.sql; overwriting in place would not change that.
    const d = await db();
    await d.execute(sql`DELETE FROM vault_objects WHERE storage_key = ${storageKey}`);
  }
}

let instance: SecureStorageService | null = null;
export function secureStorage(): SecureStorageService {
  instance ??= env.storageDriver === "database" ? new DatabaseEncryptedStorage() : new LocalEncryptedStorage(env.storageDir);
  return instance;
}
