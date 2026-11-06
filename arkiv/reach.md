# Reach

## Who is it for?

- **Elderly people in India** who face paperwork alone — pension life certificates, bank KYC and account forms, ration and health-scheme applications, society and library memberships. India had about **149 million people aged 60+ in 2022 (10.5% of the population), projected to reach 347 million by 2050** ([UNFPA & IIPS, *India Ageing Report 2023*](https://www.downtoearth.org.in/health/india-will-be-greyer-by-2050-women-will-live-longer-than-men-india-ageing-report-2023-91998)).
- **Anyone who cannot comfortably read or write the language of the form** — the form is in English, they speak Hindi; Saathi asks in Hindi and writes the answer the way the form requires (e.g. BLOCK LETTERS, DD/MM/YYYY).
- **The people on the other side of the counter** — bank and office staff who receive these forms can check, from a QR code or link, that the PDF is exactly the version the applicant approved (with the time of approval), without an account.

## Would they use it?

The interface was designed around them rather than around the technology:

- Opens directly on the camera; one big button per screen; text at 20–30 px; every state shown as colour + icon + words.
- Everything is spoken (ElevenLabs Hindi/English voice) and every answer can be spoken; typing is always available.
- It never uses words like "blockchain", "hash" or "wallet" — the person sees "a tamper-proof fingerprint", "kept safely until …", "link works for 1 day".
- It never invents answers, reads important ones back, and says plainly that it has not submitted the form anywhere.

## Can they try it today?

- Run it locally in minutes: `npm install && npm run setup && npm run dev`, then "Try a sample form" (a non-sensitive library membership form included in the repo). See [README](../README.md) and [docs/DEMO.md](../docs/DEMO.md).
- `npm run test:e2e` runs the full scenario (scan → conversation with a correction → PDF → approval → verification → tampered copy fails → share → revoke → delete) against the live services.
- Arkiv data is public: `npm run arkiv:query` lists the commitments written by Saathi's wallet `0x06Ca910E0B9819f11bA30d812648479192bF2909` on Rabdi.

## Will we keep building after Mumbai?

Yes. Next steps, in order:

1. Pilot with a senior-citizens' association and a cooperative bank branch in Pune: the two highest-volume forms (account opening / KYC update, pension life certificate).
2. Marathi, Tamil and Bengali — already registered in the language system; needs strings and testing with native speakers.
3. Recipient-side verification inside partner workflows (bank intake reads the same Arkiv entities via the SDK).
4. Optional self-custody: hand a commitment's ownership to the person's (or a family member's) wallet with Arkiv's `changeOwnership`, for people who want it — without making wallets a requirement.
