# Arkiv schema

Source of truth: [`src/lib/arkiv/schemas.ts`](../src/lib/arkiv/schemas.ts) (defined with `defineSchema` from `@arkiv-network/sdk/schema` 1.0.1). Network: **Rabdi testnet**, chain id `7794095`.

**Writer / owner wallet:** `0x06Ca910E0B9819f11bA30d812648479192bF2909` (Paper AI's server wallet — our users are elderly people without crypto wallets, so Paper AI writes on their behalf and the UI never mentions crypto).

**Names:** the schema tags start with `saathi.` — Paper AI's working name when the first entities were written. They stay as they are so records already on Arkiv keep matching; the same goes for the signature domain name `"Saathi"` below.

**Privacy rule for every entity:** only a SHA-256 fingerprint, coarse metadata and timestamps. Never names, numbers, answers, transcripts or document content.

## 1. `saathi.commitment.v1` — an approved document

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `docHash` | `str` | ✅ | lowercase hex SHA-256 of the approved PDF bytes (64 chars, within the 128-byte `str` limit) |
| `hashAlg` | `str` | — | `"sha-256"` (default) |
| `category` | `str` | ✅ | coarse class: `bank`, `government`, `pension`, `membership`, … `other` |
| `lang` | `str` | ✅ | conversation language, e.g. `hi` |
| `approvedAt` | `u64` | ✅ | unix seconds when the person approved the final document |
| `app` | `str` | — | `"saathi/0.1"` (default) |
| `arkiv.schema` | `str` | ✅ | `"saathi.commitment.v1"` (added by the named schema) |

- **Created** in one atomic `executeBatch` together with its first consent event, after the person taps "Yes, everything is correct" and consents to storage.
- **Owner / creator:** the writer wallet. Queries filter with `createdBy(writer)` (creator is immutable; owner can be transferred).
- **Flags:** `readonly: true` — the fingerprint can never be patched, not even by Paper AI.
- **Expiry:** `ExpirationTime.atDate(retentionUntil)` where retention is the person's choice — 7, 30 or 180 days (Arkiv's maximum lifetime is ~182.5 days). The encrypted PDF is deleted off-chain at the same moment.
- **Deleted** when the person taps "Delete my document".

## 2. `saathi.consent.v1` — consent and audit events

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `commitment` | `key` | ✅ | entity key of the commitment (predicted with `predictEntityKeys` so it can be referenced inside the same batch) |
| `docHash` | `str` | ✅ | same fingerprint — lets a verifier fetch history by hash in one query |
| `action` | `str` | ✅ | `approve`, `share`, `revoke_share` |
| `occurredAt` | `u64` | ✅ | unix seconds (sorted on for the history timeline) |
| `method` | `str` | — | how consent was given: `tap` or `voice+tap` |
| `ref` | `str` | — | optional: the share grant id for `share` / `revoke_share` |

- **Owner / creator:** writer wallet. **Flags:** `readonly: true` (an audit trail must not be editable).
- **Expiry:** same deadline as the commitment it belongs to (`atDate(retentionUntil)`, with `atLeast: 1h`).

## 3. `saathi.share.v1` — a live share link

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `commitment` | `key` | ✅ | the shared document's commitment |
| `docHash` | `str` | ✅ | fingerprint (cross-checked on access) |
| `grantId` | `str` | ✅ | SHA-256 of the link's bearer token — the token itself never goes on-chain or into the DB |
| `issuedAt` | `u64` | — | unix seconds |

- **Owner / creator:** writer wallet. **Not read-only**, so it can be deleted.
- **Expiry = the link's lifetime** (1 hour, 1 day or 7 days, capped at the document's retention). When it expires on Arkiv, `/s/<token>` stops serving the file.
- **Deleted** when the person taps "Stop this link" (a `revoke_share` consent event is written in the same batch).

## 4. `saathi.signature.v1` — a signature on an approved document (the owner's, or a co-signer's)

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `commitment` | `key` | ✅ | the signed document's commitment (predicted key, same batch) |
| `docHash` | `str` | ✅ | fingerprint of the signed PDF (its last page is the "Signature record") |
| `signer` | `addr` | ✅ | public address of the key on the signer's phone — a random per-phone key, not tied to a name |
| `signature` | `bytes` | — | 65-byte secp256k1 signature over EIP-712 typed data `DocumentSignature{document: bytes32 docHash, signedAt: uint64, method: string, role: string}`, domain `{name: "Saathi", version: "1", chainId: 7794095}` |
| `signedAt` | `u64` | ✅ | unix seconds; part of the signed message and printed on the PDF's signature page |
| `method` | `str` | — | `finger`, `finger+voice` (the owner) or `tap` (a co-signer); part of the signed message |
| `role` | `str` | ✅ | `signer` (the owner) or a co-signer's `witness`, `guarantor`, `family`, `official`; part of the signed message, so a witness signature cannot pass as a guarantor's |

- **Created** in the same atomic `executeBatch` as the commitment and its consent event, only when the person signed with a finger and then chose "Save & protect". The server first checks that the signature recovers to `signer` over exactly these bytes, and that `signer` is the key printed in the PDF (the generation token is bound to it).
- **Co-signatures** are created by `POST /api/share/<token>/cosign`: whoever received a share link signs the same `docHash` with their own phone's key. The server checks the link is alive on Arkiv (its `saathi.share.v1` grant), the signature is genuine, and — inside the serialized write queue — that this key has not signed the document yet and it has fewer than 10 signatures, then creates one entity with the commitment's expiry.
- **Paper AI cannot forge it:** the key lives only on the phone; the writer wallet merely carries the signature onto Arkiv. Anyone re-checks it: `/verify` recovers the signer from `signature` in the browser.
- **Never stored:** the drawn signature image (it exists only inside the encrypted PDF), names, or anything else about the person.
- **Owner / creator:** writer wallet. **Flags:** `readonly: true`. **Expiry:** the document's retention. **Deleted** with everything else by "Delete my document".

## Fields we query

| Query | Where | Filter |
|---|---|---|
| Verify a PDF | `/verify` (browser, direct to Arkiv) and `POST /api/verify` | `Commitment`: `docHash = <sha256>`, `createdBy(writer)` |
| Consent history | `/verify` result | `Consent`: `docHash = <sha256>`, `createdBy(writer)`, `orderBy asc(occurredAt)` |
| Who signed, and is it genuine? | `/verify` result ("Signatures") | `Signature`: `docHash = <sha256>`, `createdBy(writer)`, `orderBy asc(signedAt)`; each signature re-checked with EIP-712 recovery |
| Is this share link alive? | `GET /api/share/<token>`, `/file` | `ShareGrant`: `grantId = sha256(token)`, `createdBy(writer)` |
| "Kept safely until …" | Done screen | `getEntity(commitmentKey)` → `$expiresAt` → wall-clock via `getBlockTiming()` |
| Erase everything for a document | `DELETE /api/documents/<id>` | all four schemas: `docHash = <sha256>`, `createdBy(writer)` |
| Recent commitments | `npm run arkiv:query` | `Commitment`, `createdBy(writer)`, `orderBy desc(approvedAt)` |
