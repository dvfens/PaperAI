# Arkiv friction log

Things that got in our way while building Paper AI with `@arkiv-network/sdk` **1.0.1** (Node 22, Next.js 16) on the **Rabdi** testnet, in the order we hit them. Each has what we expected, what happened, and how to reproduce.

## 1. Docs, SDK and testnet names disagree

- **Expected:** the docs quickstart to match `npm install @arkiv-network/sdk` (latest = 1.0.1).
- **What happened:** search results and doc pages showed SDK v0.6.0 with the **Kaolin** testnet and an older guide with v0.4.4 and **Mendoza**; the installed 1.0.1 exports only `rabdi` and `localhost` chains and a different API (`defineSchema`, `select().from()`). `https://arkiv.dev.golem.network/docs` redirects 308 → `https://docs.arkiv.network/...` → 301 to an `http://` URL. We ended up reading `node_modules/@arkiv-network/sdk/README.md` and `src/` to get the real API.
- **Repro:** search "arkiv sdk createEntity testnet"; compare with `npm view @arkiv-network/sdk version` and `node_modules/@arkiv-network/sdk/src/chains/index.ts`.
- **Ask:** version-stamp every docs page, redirect old pages to the 1.x quickstart, and show the current testnet name on the docs home.

## 2. The faucet needs a browser wallet connection

- **Expected:** paste an address and receive tGLM (our writer key is generated server-side with `viem.generatePrivateKey()` — elderly users have no wallets, so the app writes on their behalf).
- **What happened:** `hub.arkiv.network/faucet` shows "Connect your wallet — sign in with your wallet to claim tGLM". To fund a server key we must import a private key into a browser extension, which is exactly what we tell people never to do. Our first approval failed with `EntityMutationError > … > InsufficientFundsError > TransactionRejectedRpcError (-32003)`.
- **Repro:** `npm run setup` (prints a fresh address) → open the faucet → no address field.
- **Workaround:** a team member claimed tGLM through a browser wallet and funded the server address from there (10 tGLM); writes then went through first time.
- **Ask:** allow claiming to a typed address (behind a captcha), or a CLI/HTTP faucet for CI and server wallets.

## 3. No documented local node

- **Expected:** a way to test writes without testnet funds (`chains.localhost` exists: id 1337, `http://127.0.0.1:8545`).
- **What happened:** we found no instructions or Docker image for running an Arkiv node locally, so write paths could only be exercised against Rabdi after funding.
- **Ask:** a one-line `docker run` dev node in the README, pre-funded like Anvil.

## 4. Limits and reserved words are only in the source

- **What happened:** we learned the important limits by reading `src/schema/*.ts`: `str` ≤ 128 bytes, entity bytes ≤ 128 KiB, ≤ 32 attributes, names ≤ 32 bytes and `^[A-Za-z][A-Za-z0-9._-]*$`, `MAX_LIFETIME` 7,884,000 blocks (~182.5 days), and reserved names including the type tags — so an attribute called **`key`** is rejected. We had planned exactly that name for the commitment reference.
- **Ask:** a single "limits & reserved words" table in the docs, and mention it in `SchemaDefinitionError` messages.

## 5. Maximum lifetime ~6 months

- **Expected:** to keep a document commitment as long as the person keeps the paper (often a year or more).
- **What happened:** `ExpirationTime.fromYears(1)` is refused before sending (`MAX_LIFETIME`). We capped retention at 6 months in the UI. Extending works, but needs someone (us) to keep extending with a funded wallet; `permissionlessExtension` helps a recipient keep it alive, but we couldn't find guidance on patterns for long-lived, read-only records.
- **Ask:** document the recommended pattern for long-lived immutable records (extension bots? permissionless extension by verifiers?).

## 6. Referencing an entity created in the same batch is race-prone

- **What happened:** to make the consent event reference its commitment atomically we used `predictEntityKeys({ owner, count: 2 })` + per-create `salt`. The docs note the prediction only holds "while nothing else from this owner is in flight", so a busy server must serialise all writes from its wallet (we added a mutex).
- **Ask:** a batch-local reference (e.g. `key(ref(0))` resolved by the engine) so batches can link entities without predicting keys.

## 7. Expiry is in blocks; every app re-implements "what date is that?"

- **What happened:** `$expiresAt` is a block number. To show "kept safely until 6 December 2026" we call `getBlockTiming()` and compute `currentBlockTime + (expiresAt − currentBlock) × blockDuration` (`src/lib/arkiv/read.ts`).
- **Ask:** an SDK helper (`estimateExpiryDate(entity)`) or a selectable `$expiresAtTime`.

## 8. Deeply nested write errors

- **What happened:** an unfunded write surfaces as `EntityMutationError` → `ContractFunctionExecutionError` → `TransactionExecutionError` → `InsufficientFundsError` → `TransactionRejectedRpcError`. To show a useful message we had to walk `err.cause`.
- **Ask:** a stable `code` on `EntityMutationError` (`insufficient_funds`, `expiry_too_long`, `not_owner`, …).

## 9. Small things

- `rabdi({ accessKey: "" })` prints a `console.warn` once per process at import time — fine for scripts, noisy in server logs; an option to silence it would help.
- Browser apps need the RPC host in their Content-Security-Policy `connect-src` (`https://rpc.rabdi.db-chain.testnet.arkiv.network`, plus `wss://` for watching). Worth a line in the browser guide.
- A query with no filter throws `InvalidPredicateError` — the message is excellent ("narrow by ownedBy(...) / createdBy(...)"); more errors like this, please.

## What worked really well

- `defineSchema` + typed `select().from().where()` caught our mistakes at compile time (filtering on a non-indexed column is a type error).
- `readonly` creation flags and per-entity expiry map directly onto product features (immutable consent trail, self-expiring share links).
- `executeBatch` made "approve" and "revoke" atomic with no smart contract of our own.
