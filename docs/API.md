# HTTP API

All endpoints are Next.js route handlers under `/api`, Node runtime, JSON unless noted. Errors use

```json
{ "error": { "code": "rate_limited", "message": "Too many requests." } }
```

State-changing requests must be same-origin (Origin header checked). Every endpoint is rate-limited per IP. Owner endpoints are authorised by the HttpOnly `saathi_device` cookie (set on first save).

## Service status

### `GET /api/health`
Which optional services are configured. Never returns secrets.
```json
{ "claude": true, "elevenlabs": true,
  "arkiv": { "configured": true, "writerAddress": "0x06Ca…2909", "chainId": 7794095, "explorerUrl": "https://rabdi.explorer.arkiv.network" },
  "database": "pglite", "demoTools": true }
```

## Understanding

### `POST /api/documents/summary` — multipart
Stage 1 ("what is this?"). Fields: `lang` (`en`|`hi`), `page0..page3` (JPEG/PNG). Returns `{ "available": false }` without Claude, else
`{ available: true, title, summary, explanation[], category, kind }`.

### `POST /api/documents/analyze` — multipart
Stage 2. Fields: `lang`, `page0..page3` and/or `pdf`. Runs OCR, AcroForm inspection, Claude (or basic mode) and placement. Returns a `DocumentAnalysis` (`src/lib/types.ts`):
`analysisId, source ("claude"|"basic"), category, kind, documentLanguage, title, summary, explanation[], fields[], instructions[], requiredDocuments[], submission?, ambiguities[], pageCount, fillable, ocrText, warnings[]`.
Each field: `id, label, labelLocalized, type, required, question, hint?, options?, format?, box? {page,x,y,w,h in 0..1}, acroName?, optionBoxes?, sensitive, confirm, aiFillable, mappingConfidence, group?`.
Nothing is stored.

### `POST /api/documents/ask`
`{ lang, question, analysis: {title, summary, explanation, instructions, requiredDocuments, submission?, category, ocrText}, fields }` → `{ answer, source }`.

## Conversation

### `POST /api/conversation/turn`
Stateless: the browser sends the whole conversation state.
```json
{ "state": ConversationState, "fields": FormField[], "utterance": "nahi, 13 March 1960", "formLang": "en", "source": "voice" }
```
→ `{ state, reply, interpretation, interpretedBy: "claude"|"basic" }`. `reply` is what Saathi says next.

## Voice

### `POST /api/speech/tts`
`{ text, lang }` → `audio/mpeg` (ElevenLabs). `503 speech_not_configured` without a key.

### `POST /api/speech/token`
→ `{ token, model }`. Mints an ElevenLabs single-use token (`POST /v1/single-use-token/realtime_scribe`) for ONE realtime
transcription socket; it expires after 15 minutes. The browser then streams 16 kHz PCM straight to
`wss://api.elevenlabs.io/v1/speech-to-text/realtime` (`commit_strategy=vad`, `filter_background_audio=true`), so the
API key never leaves the server. Same-origin only, rate-limited.

### `POST /api/speech/stt` — multipart
`audio` (webm/mp4/wav), `lang` → `{ text, languageCode }` (ElevenLabs Scribe batch). Used when realtime streaming is
unavailable or fails mid-answer; the client then sends the same recording here, so nothing said is lost.
Optional `hint` (JSON `{ kind, options? }`: the expected answer type, with options only for choice fields) adds
Scribe keyterms for yes/no and options. It is best-effort: a malformed or oversized hint is ignored, never rejected.
Optional `via` names the client path (e.g. `stream-backup:socket-closed`, `recorder:no-audio`) and is logged as metadata only.

## Documents

### `POST /api/documents/generate` — multipart
`fields` (JSON), `answers` (JSON), and the original: `pdf` or `page0..page3`. Returns `application/pdf` with headers
`X-Document-Sha256`, `X-Generation-Token` (HMAC proving Saathi produced these bytes), `X-Fields-Written`, `X-Fields-Skipped`. Nothing stored.

### `POST /api/documents/guide`
`{ lang, analysis, fields, answers }` → `NextStepsGuide { source, intro, steps[{kind: sign|attach|submit|check|info, title, detail, box?}], notSubmittedNotice }`.

### `POST /api/documents` — multipart (save & protect)
`pdf`, `token` (generation token), `meta` (`{category, language, pageCount, fieldCount}`), `retentionDays` (7|30|180), `method` (`tap`|`voice+tap`), **`consent=yes`**.
Encrypts and stores the PDF, records the commitment + consent on Arkiv, sets the device cookie. → `201 CommitmentReceipt`:
```json
{ "documentId": "…", "sha256": "…", "approvedAt": "…", "retentionUntil": "…", "stored": true,
  "arkiv": { "status": "recorded", "commitmentKey": "0x…", "consentKey": "0x…", "txHash": "0x…", "expiresAtBlock": "…", "explorerTxUrl": "…" } }
```
`arkiv.status` is `recorded`, `not_configured` or `failed` (with `reason`). Errors: `400 consent_required`, `400 unknown_document` (bad token / modified PDF).

### `GET /api/documents/{id}` (owner)
Receipt plus `arkivExpiry` (retention date read back from the Arkiv entity) and `erased`.

### `DELETE /api/documents/{id}` (owner)
Secure deletion: crypto-shred + overwrite + unlink, revoke links, delete Arkiv entities for the fingerprint. → `{ erased: true, arkivTxHash }`.

### `GET /api/documents/{id}/file` (owner)
Decrypted PDF download.

### `GET /api/documents/{id}/shares` · `POST /api/documents/{id}/shares` (owner)
`POST { hours: 1 | 24 | 168 }` → `{ shareId, url, expiresAt, arkiv: { grantKey, txHash, explorerTxUrl } | null }`. The link lifetime is recorded as the Arkiv grant's expiry. Fails closed (`502`) if the grant cannot be recorded when Arkiv is configured.

### `DELETE /api/documents/{id}/shares/{shareId}` (owner)
Revokes in the DB immediately and deletes the Arkiv grant entity (+ a `revoke_share` consent event).

## Recipients & verification

### `GET /api/share/{token}`
`{ valid: false }` or `{ valid: true, expiresAt, sha256, approvedAt, pageCount, arkivChecked }`. Valid only if the DB link is live **and** (when recorded) the Arkiv grant entity is alive.

### `GET /api/share/{token}/file`
Re-checks validity, then streams the PDF. `410 link_expired` otherwise.

### `POST /api/verify`
`{ sha256 }` → `VerificationResult { sha256, status: match|no_match|unavailable, commitment?, history[], checkedAgainst }`. Server-side mirror of the browser's direct Arkiv query; only the fingerprint is sent.
