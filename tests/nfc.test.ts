import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { listenForCards, NfcError, paperLink, startNfc, writeCardLink, type NdefReader } from "@/lib/client/nfc";

const ORIGIN = "https://paperai.example";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

describe("card links", () => {
  it("accepts a Paper AI form link from this site, without query or hash", () => {
    assert.equal(paperLink(`${ORIGIN}/s/${TOKEN}`, ORIGIN), `${ORIGIN}/s/${TOKEN}`);
    assert.equal(paperLink(` ${ORIGIN}/s/${TOKEN}?x=1#y `, ORIGIN), `${ORIGIN}/s/${TOKEN}`);
  });

  it("refuses links to other sites, other pages, and junk", () => {
    assert.equal(paperLink(`https://evil.example/s/${TOKEN}`, ORIGIN), null);
    assert.equal(paperLink(`${ORIGIN}/forms`, ORIGIN), null);
    assert.equal(paperLink(`${ORIGIN}/s/short`, ORIGIN), null);
    assert.equal(paperLink(`${ORIGIN}/s/${TOKEN}/file`, ORIGIN), null);
    assert.equal(paperLink("javascript:alert(1)", ORIGIN), null);
    assert.equal(paperLink("hello", ORIGIN), null);
  });
});

/** A stand-in for Chrome's NDEFReader: scan/write succeed or fail with the given DOMException name. */
function fakeReader(fail: { scan?: string; write?: string } = {}) {
  const written: string[] = [];
  class FakeReader extends EventTarget implements NdefReader {
    async scan() {
      if (fail.scan) throw Object.assign(new Error(fail.scan), { name: fail.scan });
    }
    async write(message: { records: { recordType: "url"; data: string }[] }) {
      if (fail.write) throw Object.assign(new Error(fail.write), { name: fail.write });
      written.push(message.records[0].data);
    }
  }
  (globalThis as { window?: unknown }).window = { NDEFReader: FakeReader, location: { origin: ORIGIN } };
  return written;
}

const problem = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof NfcError ? e.problem : (e as Error).name),
  );

describe("NFC card reading and writing", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("says plainly when the phone has no Web NFC", async () => {
    assert.equal(await problem(startNfc(new AbortController().signal)), "nfcNoReader");
  });

  it("writes the link as a URL record", async () => {
    const written = fakeReader();
    const signal = new AbortController().signal;
    const reader = await startNfc(signal);
    await writeCardLink(reader, `${ORIGIN}/s/${TOKEN}`, signal);
    assert.deepEqual(written, [`${ORIGIN}/s/${TOKEN}`]);
  });

  it("turns Chrome's errors into what the person can do about them", async () => {
    const signal = new AbortController().signal;
    fakeReader({ scan: "NotReadableError" });
    assert.equal(await problem(startNfc(signal)), "nfcOff");
    fakeReader({ scan: "NotAllowedError" });
    assert.equal(await problem(startNfc(signal)), "nfcBlocked");
    fakeReader({ write: "NotSupportedError" });
    assert.equal(await problem(startNfc(signal).then((r) => writeCardLink(r, "u", signal))), "nfcCardLocked");
    fakeReader({ write: "NetworkError" });
    assert.equal(await problem(startNfc(signal).then((r) => writeCardLink(r, "u", signal))), "nfcMoved");
    // Cancelling is not an error to show.
    fakeReader({ write: "AbortError" });
    assert.equal(await problem(startNfc(signal).then((r) => writeCardLink(r, "u", signal))), "AbortError");
  });

  it("opens only a Paper AI form link read from a card", async () => {
    fakeReader();
    const reader = await startNfc(new AbortController().signal);
    const links: string[] = [];
    let others = 0;
    const stop = listenForCards(reader, (u) => links.push(u), () => others++);
    const card = (...urls: string[]) =>
      reader.dispatchEvent(
        Object.assign(new Event("reading"), {
          message: { records: urls.map((u) => ({ recordType: "url", data: new DataView(new TextEncoder().encode(u).buffer) })) },
        }),
      );
    card("https://elsewhere.example/");
    card("https://elsewhere.example/", `${ORIGIN}/s/${TOKEN}`);
    reader.dispatchEvent(new Event("readingerror"));
    stop();
    card(`${ORIGIN}/s/${TOKEN}`);
    assert.deepEqual(links, [`${ORIGIN}/s/${TOKEN}`]);
    assert.equal(others, 2);
  });
});
