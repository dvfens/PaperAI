# Demonstration script

The demo uses the fictional, non-sensitive **Sunrise Community Library membership form** in `public/samples/`:

- `library-membership-form.pdf` — fillable (AcroForm) version
- `library-membership-form-flat.pdf` — "paper" version with printed blanks (print it, or show it on a second screen, to scan with the camera)

Prerequisites: `npm run setup`, keys in `.env.local` (Claude, ElevenLabs, funded Arkiv wallet), `npm run dev`, open the app on a phone (HTTPS or `localhost` — camera and microphone need a secure context; for a phone on the LAN use a tunnel such as `cloudflared` or `ngrok`).

| # | Step | What to show / say |
|---|---|---|
| 1 | Open the app | It opens straight on the camera. Language switch top-right (हिन्दी / English). |
| 2 | Camera appears | Big shutter button, "Choose photo or PDF", light toggle on Android. |
| 3 | Scan the printed sample | A blue outline finds the page; hold still and the photo is taken by itself (or tap the shutter). It comes back cut out, straight and white → "Use photo". (Or tap "Try a sample form".) |
| 4 | AI identifies and explains | Within ~8 s Saathi says: "This appears to be: Library membership form. This is the form to become a member of the library…". Tap **Explain this document** to hear the instructions and papers to bring; ask "फ़ीस कितनी है?" by voice. |
| 5 | AI asks for the name | Tap **Help me fill this document**. "I will ask you 8 questions… What is your full name?" |
| 6 | Answer by voice | Say "मेरा नाम राम कुमार शर्मा है". Saathi confirms the name (written as RAM KUMAR SHARMA — the form asks for BLOCK LETTERS). Say "हाँ". |
| 7 | Remaining fields | Date of birth "बारह मार्च उन्नीस सौ साठ", gender "पुरुष", mobile "नौ आठ सात छह पाँच…", address (with PIN), language, "60+?" → "हाँ". Show **Repeat**, **Pause/Continue**, **Skip** (email). |
| 8 | Correct one answer | While it confirms "12 March 1960", say "नहीं, तेरह मार्च" → it re-confirms "13 March 1960". Or later: "मेरा नाम बदलना है, राम किशोर शर्मा" → it jumps back, confirms, and returns to where it was. |
| 9 | Completed PDF | **See all answers** → statuses (confirmed, missing, "you sign this", "stick your photo here") → **Make my document**. Completed vs Original tabs; signature place highlighted. |
| 10 | Read-back | Saathi reads the important details (sensitive numbers masked) and asks "Is everything correct?". |
| 11 | Approve and sign | Say "हाँ" (or tap **All correct**). **Sign the form** opens and Saathi says what to do: sign with a finger (any mark is fine), **Done** → the signature appears in "Signature of applicant", tagged **Signed**, and a "Signature record" page is added. Consent sheet: keep for 1 month, tick "I agree", **Save & protect**. |
| 12 | Arkiv records the commitment | "Your form is ready" with **Tamper-proof** and **Safe until …** (date read back from Arkiv). **Technical details** → Arkiv entity key + transaction link on the Rabdi explorer. Next steps play: where to sign, papers to attach, where to hand it in, "Saathi has not sent this form anywhere". |
| 12b | Sign a form that is already filled | Scan or upload a filled form → **Already filled? Sign it** → the document with only its signature box marked → **Sign now** → **Save & protect**. Same Arkiv record and signature, no questions asked. |
| 12c | Co-sign (the witness's side) | **Send to family or bank** → 1 hour → open the link on a second phone. It shows the document → **Co-sign** → **Witness** → **Co-sign this document** → "You co-signed as Witness" with the Arkiv transaction. Back on the first phone, the Done screen lists **Signatures: You, Witness**. |
| 13 | Verify successfully (the clerk's side) | The person sees only **Save the form** and **Send to family or bank** — checking is the recipient's job. Tap **Save the form**, then switch to the clerk's view: open "Check a document" on the start screen (or **Verify** on a share link) and choose the PDF → green **"Not changed"**, approved on …, **Signatures: Signature checked** (signer key, re-checked in the browser), with the history (signed → approved). Point out it was hashed on the device and checked against Arkiv directly from the browser. |
| ✗ | Failed verification | On the same page tap **"Demo: change one word in this file and check again"** (or `npm run demo:tamper -- completed-form.pdf` and choose the `.edited.pdf`) → red "This document does not match". |

Extras worth showing:

- **Share link:** "Make a link" for 1 hour → QR code. Open it on another device: valid until …, download, check. Tap **Stop this link** → the recipient page now says the link has expired (the Arkiv grant entity was deleted).
- **Delete my document:** crypto-shreds the stored copy and deletes the Arkiv entities.
- **Offline honesty:** remove `ANTHROPIC_API_KEY` → "Basic mode" banner; remove `ELEVENLABS_API_KEY` → browser voice. Nothing pretends.

Automated version of the same scenario (API level, typed answers):

```bash
npm run test:e2e
```
