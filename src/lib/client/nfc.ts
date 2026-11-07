/**
 * NFC cards, through Web NFC (Chrome on Android only; not iPhone, not computers).
 *
 * A card holds one thing: a card link to a saved form (a share link that lasts as long as the form is
 * kept). The form itself never goes on the card — a card stores well under 1 KB, and the form stays
 * encrypted with Paper AI, with its fingerprint on Arkiv. Tapping the card on any phone with NFC opens
 * the link (iPhones too: they open a link from a card on their own); Paper AI can also write the link,
 * and read it back while it is open.
 */

interface NdefRecord {
  recordType: string;
  data?: DataView;
  encoding?: string;
}
interface NdefReadingEvent extends Event {
  message: { records: NdefRecord[] };
}
export interface NdefReader extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(message: { records: { recordType: "url"; data: string }[] }, options?: { signal?: AbortSignal; overwrite?: boolean }): Promise<void>;
}
type NdefReaderClass = new () => NdefReader;

function readerClass(): NdefReaderClass | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { NDEFReader?: NdefReaderClass }).NDEFReader ?? null;
}

export const nfcAvailable = () => readerClass() !== null;

/** What went wrong, as the string key the sheet shows. */
export type NfcProblem = "nfcOff" | "nfcBlocked" | "nfcNoReader" | "nfcCardLocked" | "nfcMoved";

export class NfcError extends Error {
  constructor(readonly problem: NfcProblem) {
    super(problem);
  }
}

const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === "AbortError";

/** Chrome's errors, by step: starting NFC (permission, NFC switched off) or writing to the card. */
function problemOf(err: unknown, step: "start" | "write"): NfcProblem {
  switch ((err as { name?: string } | null)?.name) {
    case "NotReadableError":
      return "nfcOff";
    case "NotAllowedError":
      return step === "start" ? "nfcBlocked" : "nfcCardLocked";
    case "NotSupportedError":
      return step === "start" ? "nfcNoReader" : "nfcCardLocked";
    case "NetworkError":
      return "nfcMoved";
    default:
      return step === "start" ? "nfcNoReader" : "nfcMoved";
  }
}

/**
 * Turn NFC on for this page. Chrome asks for permission only during a tap, so call this straight from
 * the button's click, before anything slow. The scan keeps running until `signal` aborts: while it
 * runs, a card tapped on the phone comes to Paper AI instead of opening whatever link it holds.
 * Rejects with NfcError, or with an AbortError when cancelled.
 */
export async function startNfc(signal: AbortSignal): Promise<NdefReader> {
  const Reader = readerClass();
  if (!Reader) throw new NfcError("nfcNoReader");
  const reader = new Reader();
  try {
    await reader.scan({ signal });
  } catch (err) {
    throw isAbort(err) ? err : new NfcError(problemOf(err, "start"));
  }
  return reader;
}

/** Write `url` to the next card held to the phone (replacing what is on it). */
export async function writeCardLink(reader: NdefReader, url: string, signal: AbortSignal): Promise<void> {
  try {
    await reader.write({ records: [{ recordType: "url", data: url }] }, { signal, overwrite: true });
  } catch (err) {
    throw isAbort(err) ? err : new NfcError(problemOf(err, "write"));
  }
}

/** The Paper AI form link in `url` (same site, /s/<token>), or null for anything else. */
export function paperLink(url: string, origin: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.origin !== origin || !/^\/s\/[A-Za-z0-9_-]{16,}$/.test(u.pathname)) return null;
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

function linksOn(event: NdefReadingEvent): string[] {
  const out: string[] = [];
  for (const r of event.message.records) {
    if ((r.recordType === "url" || r.recordType === "absolute-url") && r.data) out.push(new TextDecoder().decode(r.data));
  }
  return out;
}

/**
 * Listen for cards on a started reader. `onLink` gets the Paper AI form link on a card; `onOther` fires
 * for a card without one (a bank card, an empty card, someone else's link). Returns a stop function.
 */
export function listenForCards(reader: NdefReader, onLink: (url: string) => void, onOther: () => void): () => void {
  const onReading = (e: Event) => {
    const link = linksOn(e as NdefReadingEvent)
      .map((u) => paperLink(u, window.location.origin))
      .find(Boolean);
    if (link) onLink(link);
    else onOther();
  };
  reader.addEventListener("reading", onReading);
  reader.addEventListener("readingerror", onOther);
  return () => {
    reader.removeEventListener("reading", onReading);
    reader.removeEventListener("readingerror", onOther);
  };
}

/** A short buzz when the card is written or read (where the phone supports it). */
export function buzz() {
  try {
    navigator.vibrate?.(120);
  } catch {
    // Not every browser allows vibration.
  }
}
