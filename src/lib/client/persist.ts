"use client";

/**
 * On-device session persistence (IndexedDB) so an interrupted session — a phone call, the browser
 * discarding a background tab, an accidental reload — resumes where it left off. Data never leaves
 * the device; it expires after a few hours and is cleared when a new document is started.
 */
const DB = "saathi";
const STORE = "session";
const KEY = "current";
const TTL_MS = 6 * 60 * 60 * 1000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSession<T>(state: T): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put({ savedAt: Date.now(), state }, KEY));
  } catch {
    // storage unavailable (private mode, quota) — the app still works, just without resume
  }
}

export async function loadSession<T>(): Promise<T | null> {
  try {
    const rec = await tx<{ savedAt: number; state: T }>("readonly", (s) => s.get(KEY));
    if (!rec || Date.now() - rec.savedAt > TTL_MS) {
      if (rec) await clearSession();
      return null;
    }
    return rec.state;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(KEY));
  } catch {
    // ignore
  }
}
