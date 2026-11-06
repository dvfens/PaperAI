# How Saathi uses Arkiv

Every Arkiv feature we use changes something a person sees. Code: [`src/server/services/blockchain.ts`](../src/server/services/blockchain.ts) (writes), [`src/lib/arkiv/read.ts`](../src/lib/arkiv/read.ts) (reads, shared by server and browser).

| Arkiv feature | How we use it | What the person sees |
|---|---|---|
| **Indexed attributes + `where(eq(...))`** | `docHash` is indexed on all three schemas | `/verify` (reached from a share link or "Check a document"): choose a PDF → green "Not changed" or red "Doesn't match", in ~1 s |
| **`createdBy(writer)`** | Every read is restricted to entities created by Saathi's writer wallet | A forged entity with the same schema tag and hash, written by someone else, can never turn a tampered document green |
| **Named schemas (`arkiv.schema` tag)** | Four schemas share one wallet without colliding | — (keeps queries cheap and typed) |
| **Co-signing over a live share grant** | A share link is valid only while its `saathi.share.v1` entity lives; a recipient co-signs by adding a `saathi.signature.v1` (role `witness`, `guarantor`, `family` or `official`) next to the owner's | The recipient taps **Co-sign** and sees "You co-signed as Witness" with the Arkiv transaction; the owner's screen and `/verify` list every signer, each re-checked |
| **`addr` and `bytes` attributes** | A finger signature is stored as the signer's phone-key address (`addr`, indexed) and the 65-byte EIP-712 signature (`bytes`) | `/verify` shows "Signatures: Signature checked — signed with a finger on a phone", re-checked in the viewer's browser; Saathi cannot forge it because the key never leaves the phone |
| **`readonly` creation flag** | Commitments and consent events are immutable | Technical details on `/verify` show "Read-only: yes — the record can never be changed" |
| **Expiry chosen per entity** | Commitment/consent expire at the retention the person chose (7/30/180 days); share grants at the link lifetime (1 h/1 d/7 d) | "Kept safely until 6 December 2026" (read back from `$expiresAt`); share links stop working by themselves |
| **`executeBatch` + `predictEntityKeys`** | Commitment + its consent event + the signature (both referencing the commitment's key) land in one atomic transaction; revocation deletes the grant and writes the `revoke_share` event atomically | Approval either fully records or shows "could not be recorded" — never half |
| **`deleteEntity` (in batch)** | Stopping a link deletes its grant; "Delete my document" deletes all live entities for the fingerprint | Stopped links immediately show "This link has expired or was stopped" |
| **`orderBy(asc("occurredAt"))`** | Consent history sorted on an indexed `u64` | The verify page shows a timeline: approved → shared → link stopped |
| **`getEntity` + `getBlockTiming`** | Convert `$expiresAt` (a block) to a date | The receipt's "kept until" date comes from Arkiv, not from our database |
| **Public read client in the browser** | `/verify` queries `rpc.rabdi.db-chain.testnet.arkiv.network` directly (CSP allows only that host) | A bank clerk can verify without trusting — or even reaching — Saathi's server; the server route is only a fallback |

## Do the filters, ownership and expiry fit the app?

- **Filters:** the only questions the product asks Arkiv are "is there an approval for this fingerprint?", "what happened to it?", "who signed it?" and "is this link still alive?" — exactly `docHash`, `docHash + occurredAt`, `docHash + signedAt` and `grantId`, all indexed. Category and language are indexed for aggregate reach metrics (e.g. "how many Hindi-language bank forms were approved this week") without any personal data.
- **Who can edit:** only the writer wallet owns entities; commitments and consent events are read-only so even the operator cannot rewrite history; share grants are deletable so the person can stop a link.
- **When it expires:** retention is the person's choice and is enforced in both places — the encrypted PDF is purged off-chain (`npm run cleanup` / opportunistic purge) and the Arkiv entity expires at the same deadline. Share-link lifetimes are enforced by Arkiv itself: the server refuses a link whose grant is gone, even if the database row still exists.

## A query you can run

```bash
npm run arkiv:query
```

```bash
npm run arkiv:query -- <sha256>
```

Equivalent raw query (Arkiv query language) for one fingerprint:

```
arkiv.schema = str('saathi.commitment.v1') AND docHash = str('<sha256>')   (createdBy 0x06Ca910E0B9819f11bA30d812648479192bF2909)
```
