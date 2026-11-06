# Architecture

## Overview

```
 Phone browser (Next.js client)                         Next.js server (Node runtime)                     External
 ───────────────────────────────                        ─────────────────────────────                     ────────
 CameraScanner ── page images (JPEG) + original PDF ──► /api/documents/summary  ── ClaudeDocumentService ──► Claude
                                                         /api/documents/analyze  ── DocumentOCRService (Tesseract eng+hin)
                                                                                 ── pdfForm (AcroForm inspection)
                                                                                 ── ClaudeDocumentService ──► Claude (vision)
                                                                                 ── FormMappingService (placement)
 DocumentExplanation ── question ─────────────────────► /api/documents/ask      ── ClaudeDocumentService ──► Claude
 VoiceConversation ── utterance + state ──────────────► /api/conversation/turn  ── ConversationService
                                                                                     interpret ─────────────► Claude
                                                                                     applyTurn (deterministic engine)
 speech in/out ───────────────────────────────────────► /api/speech/tts, /stt   ── SpeechService ───────────► ElevenLabs
 live speech ── single-use token ─────────────────────► /api/speech/token        ── SpeechService ───────────► ElevenLabs
       └─ 16 kHz PCM over WebSocket (token, no key) ──────────────────────────────────────────────► Scribe realtime
 FinalVerification ── fields + answers + original ────► /api/documents/generate ── PDFGenerationService (pdf-lib)
       ◄── completed PDF + sha256 + generation token ──
 ConsentDialog ── PDF + token + explicit consent ─────► /api/documents          ── SecureStorageService (AES-256-GCM)
                                                                                 ── Postgres/PGlite (metadata)
                                                                                 ── BlockchainVerificationService ─► Arkiv
 DoneScreen / StepByStepGuide ────────────────────────► /api/documents/guide, /[id], /[id]/shares
 VerificationScreen ── sha256 (computed on device) ─────────────────────── direct read ─────────────────────► Arkiv
                                                         /api/verify (fallback mirror) ───────────────────────► Arkiv
```

## Design principles

1. **The AI interprets; code decides.** Claude turns an utterance into a typed `Interpretation` (intent + normalised value). Every state transition — next question, confirm, store, return after a correction — happens in `src/lib/conversation/engine.ts`, plain deterministic code shared by browser and server. That guarantees one question at a time, confirmation of important answers, and that nothing is stored that the person did not say.
2. **Never pretend.** Each optional service has an honest fallback: basic mode (no Claude), browser speech (no ElevenLabs), typing (no microphone), "fingerprint could not be recorded" (no Arkiv funds).
3. **Personal data stays with the person.** Answers live in the browser (and in on-device IndexedDB for resume). The server is stateless during the conversation. Only after explicit consent is the final PDF stored — encrypted. Nothing personal goes on-chain.
4. **Two-stage understanding** for responsiveness: a small Claude call returns *what the document is* (~8 s) and is spoken immediately; field extraction (~35 s) continues in the background.

## Modules

### Frontend (`src/components`)

| Module | Role |
|---|---|
| `CameraScanner` | Opens straight into the rear camera; capture, upload (image/PDF), torch where supported, sample forms, language switch |
| `DocumentPreview` | Page images with highlighted regions (sign here, uncertain placement, missing) |
| `DocumentExplanation` | "This appears to be…", simple explanation, instructions, required papers, voice Q&A |
| `VoiceConversation` | One question at a time; big mic with listening/processing/speaking states; hands-free re-listen; repeat/pause/skip; type instead |
| `FormReview` | Every answer with status, manual correction (voice or typing) |
| `FinalVerification` (+ `PDFPreview` via pdf.js) | Completed vs original, read-back, explicit approval, consent dialog, download |
| `StepByStepGuide` | Next steps one at a time, read aloud; signature location highlighted |
| `DoneScreen` | Receipt (retention date read from Arkiv), share links + QR, technical details, secure delete |
| `VerificationScreen` | Hash on device, query Arkiv from the browser, history, tamper demo |
| `SharedDocument` | What a recipient sees for a share link |
| `MyForms` (`/forms`) | Forms this phone saved: open, send, delete. Reached from the "My forms" button on the camera screen (shown when there are saved forms) and the menu on the finished-form screen |

### Backend services (`src/server/services`)

| Service | File | Notes |
|---|---|---|
| DocumentOCRService | `ocr.ts` | Tesseract.js worker (eng+hin), lines + word boxes normalised to the page |
| ClaudeDocumentService | `claude.ts`, `claudeDocument.ts` | Structured outputs (Zod) on `claude-opus-5-5`, `fallbacks: "default"`, refusal/truncation handling; prompts treat document text as data (prompt-injection hardening) |
| ConversationService | `conversation.ts` | Claude interpretation → deterministic `applyTurn`; falls back to `interpretWithRules` |
| SpeechService | `speech.ts` | ElevenLabs `POST /v1/text-to-speech/{voice}`, `POST /v1/speech-to-text` (Scribe batch) and single-use tokens for Scribe realtime; keys never reach the browser |
| Speech input | `src/lib/client/realtimeRecognition.ts`, `audioCapture.ts`, `recognition.ts` | Streams the microphone as 16 kHz PCM to Scribe realtime (live words, server-side end-of-speech detection). The answer is kept in memory only until it is transcribed; if the socket fails the same audio goes to batch Scribe, and if the browser gives no audio the MediaRecorder recorder takes over |
| FormMappingService | `formMapping.ts` | Placement: AcroForm rects → OCR label anchors (right of / below label) → model estimate; per-option tick boxes; `mappingConfidence` for UI highlighting; basic-mode field detection |
| PDFGenerationService | `pdfGeneration.ts` | Fills real AcroForm fields (sized to the widget) or draws ink-coloured text on the original page/scan; Devanagari runs via Noto Sans Devanagari + fontkit shaping; signatures/photos left blank; generic metadata only |
| SecureStorageService | `storage.ts` | Envelope encryption (per-document AES-256-GCM data key wrapped by the master key); local-disk or Postgres (`vault_objects`) backend; destroy = key deleted first, then ciphertext removed |
| BlockchainVerificationService | `blockchain.ts` + `src/lib/arkiv/*` | Arkiv writer (atomic `executeBatch`, read-only flags, expiries) and reader (`createdBy`-filtered queries) |
| Documents (orchestration) | `documents.ts` | Approve/store, receipts, share links, revocation, erasure, retention purge |

### Data model

PostgreSQL (or embedded PGlite) — `db/migrations/0001_init.sql`:

- `documents` — id, owner hash (HMAC of an HttpOnly device cookie), status, coarse category, language, page/field counts, sha256, size, storage key, **wrapped data key**, approval/retention timestamps, Arkiv status/keys/tx.
- `share_links` — HMAC of the bearer token (token never stored), public grant id (sha256 of token), expiry, revocation, Arkiv grant key/tx, access count.
- `audit_events` — local non-personal audit trail (approved, arkiv_recorded, share_created, share_accessed, erased, …).

No names, answers, transcripts or document text are stored in the database.

## Security

| Requirement | Implementation |
|---|---|
| HTTPS | HSTS in production; deploy behind TLS (Vercel/any reverse proxy). Camera/mic APIs require a secure context anyway |
| API key management | All keys server-side (`src/server/env.ts`, `server-only` imports). Only `NEXT_PUBLIC_ARKIV_ACCESS_KEY` (not a secret per Arkiv; restrict to origins) reaches the browser |
| Encryption at rest | Envelope AES-256-GCM per document; AAD binds ciphertext to the document id. Ciphertext lives on disk (local) or in the `vault_objects` Postgres table (serverless/Vercel) |
| Access control | No accounts: an HttpOnly, SameSite=Lax random device cookie; DB stores only its HMAC. Owner routes require it. Recipients use short-lived bearer links |
| Explicit consent | Storage requires `consent=yes` sent only from the consent dialog (checkbox + button); "download only" stores nothing |
| No sensitive logs | `src/server/log.ts` allow-lists metadata keys; bodies, transcripts, OCR text are never logged; errors are logged by class name only |
| No PII on-chain | Arkiv entities hold a SHA-256, coarse category, language, timestamps, consent action, grant id |
| Secure deletion | Wrapped key deleted first (crypto-shredding) and links revoked in one transaction, then the ciphertext is removed (filesystem: overwritten + unlinked; database: row deleted); Arkiv entities deleted. In database mode, the provider's backups / point-in-time-restore history (e.g. Neon) can retain old copies until that window passes — keep it short, or rotate `DOCUMENT_ENCRYPTION_KEY` for a hard guarantee |
| Short-lived links | 1 h / 1 day / 7 days; enforced in the DB **and** by the Arkiv grant entity's expiry; revocable |
| Integrity of approvals | `/api/documents/generate` returns an HMAC "generation token" over the PDF hash; storage refuses PDFs Saathi did not produce |
| CSRF / abuse | Origin check on state-changing routes, per-IP rate limits, bounded upload sizes, magic-byte checks for PDF/JPEG/PNG |
| Browser hardening | CSP (Arkiv RPC is the only external `connect-src`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (share tokens never leak), Permissions-Policy for camera/mic |
| Prompt injection | Document text and transcripts are passed as data; prompts instruct Claude to ignore instructions inside them; Claude output is schema-validated and cannot trigger actions |

### Privacy caveats (stated honestly)

- Page images go to Anthropic for analysis; spoken audio and read-back text go to ElevenLabs (live recognition streams the microphone from the browser straight to ElevenLabs while the person is answering). Both are disclosed; production use needs appropriate data-processing agreements (and zero-retention options where available).
- Browser speech recognition (fallback) is processed by the browser vendor's service on most platforms.
- On-chain transactions are permanent: deleting Arkiv entities removes them from queries, but the transaction history still contains the hash. That is why only a hash — never personal data — is written.

## Language support

`src/lib/i18n/languages.ts` registers en, hi (enabled) and mr, ta, bn, te, gu, kn (pre-registered). Enabling a language = a strings file + keyword list for the offline interpreter; Claude, ElevenLabs `eleven_multilingual_v2` and Scribe already handle these languages.
