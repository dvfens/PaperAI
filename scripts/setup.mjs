// One-time local setup: creates/updates .env.local with
//  - DOCUMENT_ENCRYPTION_KEY and APP_SECRET (32 random bytes each)
//  - a fresh Arkiv TESTNET wallet (ARKIV_PRIVATE_KEY) — fund its address at https://hub.arkiv.network/faucet
// Existing values are never overwritten. API keys (Anthropic, ElevenLabs, Arkiv access key) are left
// for you to paste in.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const FILE = ".env.local";
const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const has = (k) => new RegExp(`^${k}=.+$`, "m").test(current);
const lines = [];
const add = (k, v, comment) => {
  if (has(k)) return;
  if (comment) lines.push(`# ${comment}`);
  lines.push(`${k}=${v}`);
};

add("DOCUMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"), "Master key for envelope encryption of stored PDFs (keep secret)");
add("APP_SECRET", randomBytes(32).toString("base64"), "HMAC secret for device cookies, share tokens and PDF generation tokens (keep secret)");

let address = null;
if (!has("ARKIV_PRIVATE_KEY")) {
  const key = generatePrivateKey();
  address = privateKeyToAccount(key).address;
  add("ARKIV_PRIVATE_KEY", key, `Arkiv Rabdi TESTNET writer wallet ${address} — testnet only, never reuse on mainnet`);
} else {
  const m = current.match(/^ARKIV_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m);
  if (m) address = privateKeyToAccount(m[1]).address;
}
for (const k of ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "ARKIV_ACCESS_KEY", "NEXT_PUBLIC_ARKIV_ACCESS_KEY"]) {
  if (!new RegExp(`^${k}=`, "m").test(current)) add(k, "");
}

if (lines.length) {
  writeFileSync(FILE, `${current.trimEnd()}${current ? "\n\n" : ""}${lines.join("\n")}\n`, { mode: 0o600 });
  console.log(`Updated ${FILE} (${lines.filter((l) => !l.startsWith("#")).length} new entries).`);
} else {
  console.log(`${FILE} already complete.`);
}
if (address) {
  console.log(`\nArkiv writer wallet: ${address}`);
  console.log("Fund it with testnet tGLM at https://hub.arkiv.network/faucet");
  console.log("Get a free RPC access key at https://hub.arkiv.network/access-keys and set ARKIV_ACCESS_KEY / NEXT_PUBLIC_ARKIV_ACCESS_KEY.");
}
