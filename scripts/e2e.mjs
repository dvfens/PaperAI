// End-to-end API test of the demo scenario against a running server (default http://localhost:3000).
//   npm run dev   (in another terminal)
//   npm run test:e2e
// It drives the same endpoints the UI uses, with typed answers instead of speech, and prints a
// step-by-step report. Arkiv checks are asserted only when the server reports Arkiv as recorded.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let cookie = "";
let failures = 0;

const ok = (cond, msg) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) failures++;
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function call(path, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res;
}
/** A small transparent PNG with a blue scribble — a finger signature. */
function signaturePng(w = 160, h = 50) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (Math.abs(y - h / 2 - 14 * Math.sin(x / 11)) < 2.5) raw.set([15, 30, 107, 255], y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => {
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** EIP-712 signature over a PDF fingerprint, written out here independently of src/lib/signing.ts. */
const signTyped = (account, docHash, signedAt, method) =>
  account.signTypedData({
    domain: { name: "Saathi", version: "1", chainId: 7794095 },
    types: {
      DocumentSignature: [
        { name: "document", type: "bytes32" },
        { name: "signedAt", type: "uint64" },
        { name: "method", type: "string" },
        { name: "role", type: "string" },
      ],
    },
    primaryType: "DocumentSignature",
    message: { document: `0x${docHash}`, signedAt: BigInt(signedAt), method, role: "signer" },
  });

const json = async (path, body) =>
  (await call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

async function main() {
  console.log(`Saathi E2E against ${BASE}\n`);
  const health = await (await call("/api/health")).json();
  console.log("Services:", JSON.stringify(health));

  // 1–4. Scan + understand
  console.log("\n1. Analyse the sample form");
  const pdf = readFileSync(join(process.cwd(), "public", "samples", "library-membership-form.pdf"));
  const form = new FormData();
  form.set("lang", "en");
  form.set("pdf", new Blob([pdf], { type: "application/pdf" }), "form.pdf");
  const analysis = await (await call("/api/documents/analyze", { method: "POST", body: form })).json();
  ok(Array.isArray(analysis.fields) && analysis.fields.length >= 8, `found ${analysis.fields?.length} fields (source: ${analysis.source})`);
  const questions = analysis.fields.filter((f) => f.aiFillable).length;
  ok(questions <= 8, `sample form asks at most 8 questions (asks ${questions})`);
  const byLabel = (re) => analysis.fields.find((f) => re.test(f.label));
  console.log(`    category: ${analysis.category}; title: ${analysis.title}`);
  const sig = byLabel(/signature/i);
  ok(sig && !sig.aiFillable, "signature field is left for the person");

  // 5–8. Conversation (typed), including one correction
  console.log("\n2. Conversation");
  let state = {
    language: "en",
    phase: "asking",
    currentFieldId: analysis.fields.find((f) => f.aiFillable).id,
    returnToFieldId: null,
    pending: null,
    answers: {},
    misses: 0,
    history: [],
  };
  const turn = async (utterance) => {
    const r = await json("/api/conversation/turn", { state, fields: analysis.fields, utterance, formLang: analysis.documentLanguage, source: "typed" });
    state = r.state;
    return r;
  };
  const script = {
    "full name": ["Ram Kumar Sharma"],
    "date of birth": ["12 March 1960", "no, 13 March 1960"],
    gender: ["Male"],
    mobile: ["98765 43210"],
    email: ["skip"],
    address: ["Flat 4, Shanti Niwas, 18 Karve Road, Pune 411004"],
    "reading language": ["Hindi"],
    senior: ["yes"],
  };
  for (const [key, utterances] of Object.entries(script)) {
    const f = analysis.fields.find((x) => x.id === state.currentFieldId);
    if (!f || !f.label.toLowerCase().includes(key.split(" ")[0])) {
      ok(false, `expected question about "${key}", got "${f?.label}"`);
      break;
    }
    let r;
    for (const u of utterances) r = await turn(u);
    // Important answers are read back for confirmation — say yes, as the person would.
    for (let i = 0; i < 2 && state.phase === "confirming"; i++) r = await turn("yes");
    console.log(`    ${f.label} → ${state.answers[f.id]?.status ?? "-"} ${state.answers[f.id]?.value ?? ""}`);
  }
  const dob = byLabel(/date of birth/i);
  ok(state.answers[dob.id]?.value === "13/03/1960" && state.answers[dob.id]?.status === "confirmed", "corrected date of birth confirmed as 13/03/1960");
  await turn("I am done, that is all");
  ok(state.phase === "complete", "conversation complete");

  // 9. Generate
  console.log("\n3. Generate the completed PDF");
  const g = new FormData();
  g.set("fields", JSON.stringify(analysis.fields));
  g.set("answers", JSON.stringify(state.answers));
  g.set("pdf", new Blob([pdf], { type: "application/pdf" }), "form.pdf");
  const gen = await call("/api/documents/generate", { method: "POST", body: g });
  const completed = Buffer.from(await gen.arrayBuffer());
  ok(gen.ok && completed.subarray(0, 5).toString() === "%PDF-", "completed PDF generated");
  ok(gen.headers.get("x-document-sha256") === sha(completed), "server-reported SHA-256 matches the bytes");

  // 11–12. Approve + commitment
  console.log("\n4. Approve, store encrypted, record on Arkiv");
  const a = new FormData();
  a.set("pdf", new Blob([completed], { type: "application/pdf" }), "completed.pdf");
  a.set("token", gen.headers.get("x-generation-token"));
  a.set("meta", JSON.stringify({ category: analysis.category, language: "en", pageCount: 1, fieldCount: analysis.fields.length }));
  a.set("retentionDays", "7");
  a.set("method", "tap");
  a.set("consent", "yes");
  const receipt = await (await call("/api/documents", { method: "POST", body: a })).json();
  ok(receipt.documentId && receipt.sha256 === sha(completed), "stored; receipt fingerprint matches");
  const mine = await (await call("/api/documents")).json();
  ok(mine.forms?.some((f) => f.documentId === receipt.documentId), "saved form is listed in My forms");
  console.log(`    Arkiv: ${receipt.arkiv.status}${receipt.arkiv.txHash ? ` tx ${receipt.arkiv.txHash}` : receipt.arkiv.reason ? ` (${receipt.arkiv.reason})` : ""}`);

  const forged = new FormData();
  forged.set("pdf", new Blob([completed], { type: "application/pdf" }), "x.pdf");
  forged.set("token", "0".repeat(64));
  forged.set("meta", JSON.stringify({ category: "other", language: "en", pageCount: 1, fieldCount: 1 }));
  forged.set("retentionDays", "7");
  forged.set("consent", "yes");
  ok((await call("/api/documents", { method: "POST", body: forged })).status === 400, "a PDF without a valid generation token is refused");
  const noConsent = new FormData();
  noConsent.set("pdf", new Blob([completed], { type: "application/pdf" }), "x.pdf");
  ok((await call("/api/documents", { method: "POST", body: noConsent })).status === 400, "saving without explicit consent is refused");

  // 13. Verify + tamper
  console.log("\n5. Verify (and the tampered copy)");
  const recorded = receipt.arkiv.status === "recorded";
  const v = await json("/api/verify", { sha256: receipt.sha256 });
  if (recorded) {
    ok(v.status === "match", "original document verifies against Arkiv");
    ok(v.history?.some((e) => e.kind === "approved"), "consent event is in the Arkiv history");
  } else {
    console.log(`    (Arkiv not recorded on this server: verify returned "${v.status}")`);
  }
  const doc = await PDFDocument.load(completed);
  const page = doc.getPages()[0];
  page.drawText("EDITED", { x: 36, y: page.getHeight() - 30, size: 10, font: await doc.embedFont(StandardFonts.Helvetica), color: rgb(0.8, 0, 0) });
  const tampered = Buffer.from(await doc.save());
  ok(sha(tampered) !== receipt.sha256, "tampered copy has a different fingerprint");
  const vt = await json("/api/verify", { sha256: sha(tampered) });
  ok(vt.status !== "match", `tampered copy does NOT verify (status: ${vt.status})`);

  // Owner download decrypts to identical bytes
  const dl = Buffer.from(await (await call(`/api/documents/${receipt.documentId}/file`)).arrayBuffer());
  ok(sha(dl) === receipt.sha256, "owner download decrypts to the identical file");

  // Share link
  console.log("\n6. Share link");
  const share = await json(`/api/documents/${receipt.documentId}/shares`, { hours: 1 });
  if (share.url) {
    const token = share.url.split("/s/")[1];
    const savedCookie = cookie;
    cookie = ""; // recipient has no device cookie
    const meta = await (await call(`/api/share/${token}`)).json();
    ok(meta.valid === true, `recipient link valid (Arkiv grant checked: ${meta.arkivChecked})`);
    const sf = Buffer.from(await (await call(`/api/share/${token}/file`)).arrayBuffer());
    ok(sha(sf) === receipt.sha256, "recipient download matches the approved file");
    cookie = savedCookie;
    await call(`/api/documents/${receipt.documentId}/shares/${share.shareId}`, { method: "DELETE" });
    cookie = "";
    ok((await (await call(`/api/share/${token}`)).json()).valid === false, "revoked link stops working");
    cookie = savedCookie;
  } else {
    ok(false, `share link not created: ${JSON.stringify(share)}`);
  }

  // Erase
  console.log("\n7. Secure deletion");
  const er = await (await call(`/api/documents/${receipt.documentId}`, { method: "DELETE" })).json();
  ok(er.erased === true, "document erased");
  ok((await call(`/api/documents/${receipt.documentId}/file`)).status === 410, "erased document can no longer be downloaded");
  const after = await (await call("/api/documents")).json();
  ok(!after.forms?.some((f) => f.documentId === receipt.documentId), "erased form is gone from My forms");

  // Finger signature: drawn into the form, the PDF signed with a key on the phone, recorded on Arkiv.
  console.log("\n8. Sign with a finger and save");
  const phone = privateKeyToAccount(generatePrivateKey());
  const signedAt = Math.floor(Date.now() / 1000);
  const sg = new FormData();
  sg.set("fields", JSON.stringify(analysis.fields));
  sg.set("answers", JSON.stringify(state.answers));
  sg.set("pdf", new Blob([pdf], { type: "application/pdf" }), "form.pdf");
  sg.set("signature", new Blob([signaturePng()], { type: "image/png" }), "signature.png");
  sg.set("signer", phone.address);
  sg.set("signedAt", String(signedAt));
  sg.set("signMethod", "finger");
  const signedRes = await call("/api/documents/generate", { method: "POST", body: sg });
  const signedPdf = Buffer.from(await signedRes.arrayBuffer());
  ok(signedRes.ok, "signed PDF generated");
  const pagesBefore = (await PDFDocument.load(pdf)).getPageCount();
  ok(signedRes.ok && (await PDFDocument.load(signedPdf)).getPageCount() === pagesBefore + 1, "a signature record page was added");
  ok(Number(signedRes.headers.get("x-signed-boxes")) >= 1, `signature drawn in ${signedRes.headers.get("x-signed-boxes")} signature box(es)`);
  const signedSha = sha(signedPdf);
  const saveSigned = (who, signature) => {
    const f = new FormData();
    f.set("pdf", new Blob([signedPdf], { type: "application/pdf" }), "signed.pdf");
    f.set("token", signedRes.headers.get("x-generation-token"));
    f.set("meta", JSON.stringify({ category: analysis.category, language: "en", pageCount: pagesBefore + 1, fieldCount: analysis.fields.length }));
    f.set("retentionDays", "7");
    f.set("method", "tap");
    f.set("consent", "yes");
    f.set("signer", who);
    f.set("signedAt", String(signedAt));
    f.set("signMethod", "finger");
    f.set("signature", signature);
    return call("/api/documents", { method: "POST", body: f });
  };
  const thief = privateKeyToAccount(generatePrivateKey());
  ok((await saveSigned(phone.address, await signTyped(thief, signedSha, signedAt, "finger"))).status === 400, "a signature made by another key is refused");
  ok((await saveSigned(thief.address, await signTyped(thief, signedSha, signedAt, "finger"))).status === 400, "the PDF only saves with the key printed on it");
  ok((await saveSigned(phone.address, await signTyped(phone, "0".repeat(64), signedAt, "finger"))).status === 400, "a signature over other bytes is refused");
  const signedReceipt = await (await saveSigned(phone.address, await signTyped(phone, signedSha, signedAt, "finger"))).json();
  ok(signedReceipt.signature?.signer === phone.address.toLowerCase(), "saved; the receipt shows the signer key");
  console.log(`    Arkiv: ${signedReceipt.arkiv?.status}${signedReceipt.arkiv?.txHash ? ` tx ${signedReceipt.arkiv.txHash}` : ""}`);
  if (signedReceipt.arkiv?.status === "recorded") {
    const sv = await json("/api/verify", { sha256: signedSha });
    const one = sv.signatures?.[0];
    ok(sv.status === "match" && sv.signatures?.length === 1, "the signed PDF verifies, with one signature");
    ok(one?.valid === true && one.signer.toLowerCase() === phone.address.toLowerCase(), "the signature on Arkiv checks out and names the phone key");
    ok(sv.history?.some((e) => e.kind === "signed"), "signing is in the Arkiv history");
  }
  // "Already filled? Sign it": no answers are sent, so nothing may be written into the form — only the signature.
  const so = new FormData();
  so.set("fields", JSON.stringify(analysis.fields));
  so.set("answers", JSON.stringify({}));
  so.set("pdf", new Blob([pdf], { type: "application/pdf" }), "form.pdf");
  so.set("signature", new Blob([signaturePng()], { type: "image/png" }), "signature.png");
  so.set("signer", phone.address);
  so.set("signedAt", String(Math.floor(Date.now() / 1000)));
  so.set("signMethod", "finger");
  const signOnly = await call("/api/documents/generate", { method: "POST", body: so });
  ok(
    signOnly.ok && signOnly.headers.get("x-fields-written") === "0" && Number(signOnly.headers.get("x-signed-boxes")) >= 1,
    "sign-only: nothing written into an already-filled form, only the signature",
  );

  const er2 = await (await call(`/api/documents/${signedReceipt.documentId}`, { method: "DELETE" })).json();
  ok(er2.erased === true, "signed document erased (its signature entity too)");
  if (signedReceipt.arkiv?.status === "recorded") {
    const gone = await json("/api/verify", { sha256: signedSha });
    ok(gone.status !== "match" && !(gone.signatures?.length > 0), "after erasure Arkiv no longer has the signature");
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
