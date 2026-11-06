# Why Arkiv

Paper AI already has a PostgreSQL database. Arkiv holds the small part of the data whose whole value is that **nobody — including Paper AI — controls it**.

## If we swapped Arkiv for Postgres, what would users lose?

1. **Independent verification.** Today a bank clerk who receives a PDF opens `/verify`; the file is hashed on their device and looked up **directly on Arkiv from their browser**, filtered to Paper AI's writer wallet. With Postgres they would have to trust whatever Paper AI's server says — and a compromised or careless operator could say "valid" for anything.
2. **Records the operator cannot rewrite.** Commitments and consent events are created with Arkiv's `readonly` flag. In Postgres the operator (or an attacker with DB access) can `UPDATE documents SET sha256 = …` after the fact; on Arkiv that history is fixed.
3. **Expiry the operator cannot quietly extend.** A share link's lifetime *is* the Arkiv grant's expiry, and the document's retention is the commitment's expiry. The person picked those dates; the network enforces them and anyone can read them. A Postgres `expires_at` column is a promise; an Arkiv expiry is observable.
4. **A consent trail people can show others.** "I approved this version on 6 Nov 2026, and shared it once" is a queryable, timestamped record that outlives any one app session — useful when an elderly person's family member or a bank asks "did they really approve this?".
5. **Portability.** Any other app (a bank's intake system, a legal-aid NGO) can query the same entities with the public SDK — no API from us required.

What users would *not* lose with Postgres — and so we keep it there: the operational data that only Paper AI needs (below).

## What we kept off Arkiv, and why

| Kept off Arkiv | Where it lives | Why |
|---|---|---|
| The PDF and everything in it (names, dates, phone numbers, addresses, ID numbers) | Encrypted at rest (AES-256-GCM envelope) on Paper AI's storage; deleted at the chosen retention or on request | Arkiv data is public and transaction history is permanent; personal data must be deletable and private |
| Conversation transcripts and answers | Only in the person's browser (memory + on-device IndexedDB for resume) | Never needed by anyone else |
| OCR text and page images | Processed in memory, never stored | Same |
| Share-link bearer tokens | Only in the link itself; the DB holds an HMAC, Arkiv holds `sha256(token)` as the grant id | Publishing the token would let anyone download the document |
| Device identity / ownership cookie | HMAC in Postgres | Linking documents to a device on a public ledger would leak behaviour |
| Wrapped encryption keys, storage paths, access counts | Postgres | Operational, private, and must be destroyable (crypto-shredding) |

The rule of thumb we followed: **Arkiv stores facts that must be checkable by strangers; Postgres stores things only Paper AI should ever see.**
