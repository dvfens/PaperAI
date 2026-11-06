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

/** How long to wait for the browser's storage before carrying on without it. */
const STORAGE_TIMEOUT_MS = 2000;

/**
 * Some phone browsers (and in-app browsers such as WhatsApp's) can leave indexedDB.open without ever
 * answering. Never wait for it for more than a moment: the app works without a saved session.
 */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("storage timeout"));
    }, STORAGE_TIMEOUT_MS);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, 1);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      clearTimeout(timer);
      if (settled) req.result.close();
      else {
        settled = true;
        resolve(req.result);
      }
    };
    req.onerror = () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(req.error);
      }
    };
  });
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("storage timeout")), STORAGE_TIMEOUT_MS))]);
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
    const rec = await withTimeout(tx<{ savedAt: number; state: T }>("readonly", (s) => s.get(KEY)));
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
