# Arkiv schema

Source of truth: [`src/lib/arkiv/schemas.ts`](../src/lib/arkiv/schemas.ts) (defined with `defineSchema` from `@arkiv-network/sdk/schema` 1.0.1). Network: **Rabdi testnet**, chain id `7794095`.

**Writer / owner wallet:** `0x06Ca910E0B9819f11bA30d812648479192bF2909` (Saathi's server wallet — our users are elderly people without crypto wallets, so Saathi writes on their behalf and the UI never mentions crypto).

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
- **Flags:** `readonly: true` — the fingerprint can never be patched, not even by Saathi.
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

## Fields we query

| Query | Where | Filter |
|---|---|---|
| Verify a PDF | `/verify` (browser, direct to Arkiv) and `POST /api/verify` | `Commitment`: `docHash = <sha256>`, `createdBy(writer)` |
| Consent history | `/verify` result | `Consent`: `docHash = <sha256>`, `createdBy(writer)`, `orderBy asc(occurredAt)` |
| Is this share link alive? | `GET /api/share/<token>`, `/file` | `ShareGrant`: `grantId = sha256(token)`, `createdBy(writer)` |
| "Kept safely until …" | Done screen | `getEntity(commitmentKey)` → `$expiresAt` → wall-clock via `getBlockTiming()` |
| Erase everything for a document | `DELETE /api/documents/<id>` | all three schemas: `docHash = <sha256>`, `createdBy(writer)` |
| Recent commitments | `npm run arkiv:query` | `Commitment`, `createdBy(writer)`, `orderBy desc(approvedAt)` |
