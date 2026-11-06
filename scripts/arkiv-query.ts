// Query Paper AI's entities on Arkiv (Rabdi testnet) — read-only, needs no funds.
//
//   npm run arkiv:query                 # latest commitments written by the configured writer wallet
//   npm run arkiv:query -- <sha256>     # verify one document fingerprint + its consent history
//   npm run arkiv:query -- --writer 0x… # use another writer address
import { desc } from "@arkiv-network/sdk/query";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arkivReader, verifyHashOnArkiv } from "@/lib/arkiv/read";
import { Commitment } from "@/lib/arkiv/schemas";

const args = process.argv.slice(2);
const wIdx = args.indexOf("--writer");
const writer = (wIdx >= 0
  ? args[wIdx + 1]
  : process.env.ARKIV_PRIVATE_KEY
    ? privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY as Hex).address
    : null) as Hex | null;
const hash = args.find((a) => /^[0-9a-f]{64}$/.test(a));

if (!writer) {
  console.error("Set ARKIV_PRIVATE_KEY in .env.local or pass --writer 0x…");
  process.exit(1);
}

const client = arkivReader(process.env.ARKIV_ACCESS_KEY ?? "");

if (hash) {
  console.log(JSON.stringify(await verifyHashOnArkiv(client, hash, writer), null, 2));
} else {
  const page = await client
    .select({ $key: true, $expiresAt: true, docHash: true, category: true, lang: true, approvedAt: true })
    .from(Commitment) // a named schema filters on its `arkiv.schema` tag, so no extra where() is needed
    .createdBy(writer)
    .orderBy(desc("approvedAt"))
    .limit(10)
    .fetch();
  console.log(`Writer ${writer} — ${page.entities.length} recent commitment(s)`);
  for (const e of page.entities) {
    console.log(
      `${new Date(Number(e.approvedAt.value) * 1000).toISOString()}  ${e.category.value.padEnd(10)} ${e.lang.value}  sha256=${e.docHash.value}  key=${e.$key}  expiresAtBlock=${e.$expiresAt}`,
    );
  }
}
