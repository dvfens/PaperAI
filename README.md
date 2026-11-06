# Saathi — a voice-first paperwork helper

**Saathi** ("companion" in Hindi) helps elderly people, and anyone who cannot comfortably read or write, deal with paperwork by talking. Point the phone at a form; Saathi explains it in simple Hindi or English, asks the questions one at a time by voice, fills in the form, reads everything back for approval, produces a completed PDF, and explains what to do next. A tamper-evident fingerprint of the approved document, with the consent event, is recorded on **Arkiv** so the person — or the bank clerk they hand it to — can check that it has not been changed.

> Built from scratch at ETHGlobal Mumbai 2026 for the **Arkiv — "Build on Arkiv (from scratch)"** track.

| | |
|---|---|
| Frontend | Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui-style components (Radix) · Lucide icons |
| Backend | Next.js route handlers (Node runtime) · PostgreSQL via Drizzle (embedded PGlite when `DATABASE_URL` is unset) |
| AI | Anthropic Claude (`claude-opus-5-5`) — understanding, classification, field extraction, conversation interpretation, Q&A, guidance |
| Voice | ElevenLabs TTS (`eleven_multilingual_v2`) + Scribe STT (`scribe_v2`); browser speech APIs as fallback; typing always available |
| OCR | Tesseract.js (English + Hindi), server-side |
| PDF | pdf-lib + fontkit (AcroForm filling, Devanagari shaping), pdf.js for previews |
| Trust layer | **Arkiv** Rabdi testnet (chain id `7794095`) via `@arkiv-network/sdk` 1.0.1 |

---

## What the person experiences

1. **Camera first** — the app opens on the camera (big shutter button, upload, light toggle, language switch). No dashboard.
2. **"This appears to be a library membership form…"** — spoken within ~8 s (a quick first-impression call), while the full field analysis continues in the background.
3. **Explain** — 3–6 simple sentences, the instructions printed on the form, the papers to bring; ask questions by voice.
4. **Fill by voice** — one question at a time; big microphone; listens again automatically after each question; "repeat", "pause", "skip", "change my name…" all work; important answers are read back ("Let me confirm. Date of birth: 12 March 1960. Is that correct?"). Nothing is ever written that the person did not say.
5. **Check answers** — every answer with its status (confirmed / missing / please check / you sign this); tap to correct by voice or typing.
6. **Final check** — completed PDF next to the original, missing items, the important details read aloud, explicit "Yes, everything is correct".
7. **Consent** — "Keep a protected copy?" with a retention choice (1 week / 1 month / 6 months) — or just download.
8. **What to do next** — step by step, read aloud: where to sign (highlighted on the page), what to attach, where to hand it in. Saathi always says it has **not** submitted the form anywhere.
9. **Share & verify** — a short-lived link + QR for the bank; anyone can check the PDF at `/verify` (hashed on their device, checked against Arkiv from their browser).

---

## Quick start

```bash
npm install
```

```bash
npm run setup
```

`setup` creates `.env.local` with fresh encryption/HMAC secrets and a **new Arkiv testnet wallet**, and prints its address. Then add your keys to `.env.local`:

| Variable | Needed for | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude understanding & conversation | "Basic mode": deterministic field detection + keyword interpreter, clearly labelled in the UI |
| `ELEVENLABS_API_KEY` | Natural Hindi/English voice + Scribe recognition | Browser speech synthesis / recognition |
| `ARKIV_PRIVATE_KEY` (funded) | Recording commitments on Arkiv | Documents are still stored; the UI says the fingerprint could not be recorded |
| `ARKIV_ACCESS_KEY`, `NEXT_PUBLIC_ARKIV_ACCESS_KEY` | Higher Arkiv RPC rate limits | Public, rate-limited endpoint |
| `DATABASE_URL` | External PostgreSQL | Embedded PGlite under `.data/` |

Fund the writer wallet at <https://hub.arkiv.network/faucet> (connect a wallet that holds the generated key, or send tGLM to its address) and get a free access key at <https://hub.arkiv.network/access-keys>.

```bash
npm run dev
```

Open <http://localhost:3000> on a phone-sized window. Tap **"Try a sample form"** (or open `/?sample=flat` for the scanned-paper version). Full variable list: [`.env.example`](.env.example).

Camera and microphone need a secure context: `localhost` works; to use a real phone on your network, put the dev server behind an HTTPS tunnel. Retention is enforced by `npm run cleanup` (run it from cron; with the embedded PGlite database run it while the server is stopped, since PGlite is single-process — with `DATABASE_URL` any time).

### Tests

```bash
npm test
```

Unit tests for the conversation engine and the offline interpreter (dates, Indian mobile numbers, Hindi/Hinglish yes/no, corrections, pause/skip, "never stores an invalid value").

```bash
npm run test:e2e
```

Runs the whole demo scenario against a running dev server through the real API: analyse → conversation with a correction → generate → approve (consent required, forged PDFs refused) → verify → **tampered copy fails** → share link → revoke → secure deletion. When Arkiv is recorded it also asserts the on-chain match and consent history.

---

## Arkiv

- **Writer wallet** (creates every Saathi entity; generated for this deployment): `0x06Ca910E0B9819f11bA30d812648479192bF2909`
- **Chain:** Arkiv Rabdi testnet, chain id `7794095`, explorer <https://rabdi.explorer.arkiv.network>
- **Entities:** `saathi.commitment.v1` (read-only document fingerprint), `saathi.consent.v1` (read-only consent/audit events), `saathi.share.v1` (share-link grants whose expiry *is* the link lifetime) — see [`arkiv/schema.md`](arkiv/schema.md).

**One query you can run** (read-only, no funds needed):

```bash
npm run arkiv:query
```

Lists the latest commitments created by the writer wallet. To check one document's fingerprint and its consent history:

```bash
npm run arkiv:query -- <sha256-of-pdf>
```

The same query in code (`src/lib/arkiv/read.ts`):

```ts
await client
  .select({ $key: true, $expiresAt: true, $creationFlags: true, category: true, lang: true, approvedAt: true })
  .from(Commitment)                       // tag: arkiv.schema = "saathi.commitment.v1"
  .where(eq("docHash", str(sha256)))
  .createdBy("0x06Ca910E0B9819f11bA30d812648479192bF2909")
  .fetch();
```

Judging files: [`arkiv/schema.md`](arkiv/schema.md) · [`arkiv/friction.md`](arkiv/friction.md) · [`arkiv/reach.md`](arkiv/reach.md) · [`arkiv/why-arkiv.md`](arkiv/why-arkiv.md) · [`arkiv/how-you-use-arkiv.md`](arkiv/how-you-use-arkiv.md)

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data flow, privacy and security design
- [docs/API.md](docs/API.md) — every HTTP endpoint
- [docs/DEMO.md](docs/DEMO.md) — the end-to-end demonstration script (including the failed verification)
- [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql) — database schema

## Project layout

```
src/
  app/                    pages (/, /verify, /s/[token]) and API route handlers
  components/screens/     CameraScanner, DocumentExplanation, VoiceConversation, FormReview,
                          FinalVerification, StepByStepGuide, DoneScreen, VerificationScreen, SharedDocument
  lib/conversation/       deterministic conversation engine + offline interpreter (shared client/server)
  lib/arkiv/              Arkiv schemas + read queries (shared: server and browser verifier)
  lib/i18n/               language registry (Hindi, English; more Indian languages pre-registered)
  lib/client/             API client, camera/PDF/image helpers, speech in/out, on-device session resume
  server/services/        DocumentOCRService, ClaudeDocumentService, ConversationService, SpeechService,
                          FormMappingService, PDFGenerationService, SecureStorageService,
                          BlockchainVerificationService (Arkiv)
scripts/                  setup, sample forms, e2e, arkiv query, tamper demo, retention cleanup
public/samples/           the non-sensitive demo form (fillable + flat/"paper" versions)
arkiv/                    Arkiv track write-ups
```

## What is real and what is not

Everything in the demo path calls the real services when their keys are configured. Nothing is mocked to look like it works:

- Without `ANTHROPIC_API_KEY` the app shows **"Basic mode"** and uses deterministic code (AcroForm field names, OCR heuristics, keyword interpretation). It never presents rule-based output as AI output.
- Without a funded Arkiv wallet, saving still works and the receipt says the fingerprint **could not be recorded**; `/verify` reports "does not match" rather than inventing a record.
- **No form is submitted to any organisation.** There is no submission integration; every screen after generation says so.
- A matching fingerprint proves the file is **unchanged since approval** — not that its contents are true. The verify screen says this every time.
- Verified in this repo: unit tests, the API e2e (with live Claude), and the UI flow in a phone-sized browser. Not verified here: camera/microphone on a physical phone (the dev browser pane blocks them) and live Arkiv writes (wallet awaiting testnet funds; the write reached the node and failed only with `InsufficientFundsError`).

## How AI was used

Per ETHGlobal rules: this project was built with **Claude Code** (Anthropic) as a pair-programmer — architecture, code, tests and documentation were written with AI assistance and reviewed/run by the team. At runtime the product uses Claude (document understanding and conversation) and ElevenLabs (voice), as described above.

## License

[MIT](LICENSE)
