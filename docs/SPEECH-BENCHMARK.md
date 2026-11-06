# Speech recognition benchmark (November 2026)

Why Saathi listens with **OpenAI `gpt-live-transcribe`** by default (noise reduction off) and offers
**ElevenLabs Scribe realtime** as a switch, with batch recognition only as a backup.

## Update: voice at arm's length, and OpenAI without noise reduction

A fourth condition, **far**, has the person speaking from arm's length in a room: a reverberant voice with
quiet room noise. This is the typical case behind "I have to shout". In the first run, OpenAI's live model
had `noise_reduction: near_field` turned on, and that setting was cutting out the voice.

| Live recogniser | Clean | TV far | TV near | Far voice | No answer invented |
|---|---|---|---|---|---|
| **OpenAI `gpt-live-transcribe`, no noise reduction (default)** | 31/32 | 31/32 | 10/32 | **30/32** | 24/24 |
| ElevenLabs realtime + background filter | 32/32 | 31/32 | **22/32** | 27/32 | 24/24 |
| ElevenLabs realtime, no background filter | 32/32 | 31/32 | 23/32 | 24/32 | 23/24 |
| OpenAI `gpt-live-transcribe` + `near_field` noise reduction | 31/32 | 30/32 | 11/32 | 5/32 | 24/24 |

In ordinary conditions the two engines are equal, and OpenAI is best for a normal or distant voice.
ElevenLabs is best with a loud TV right next to the phone. Both are offered, and each phone keeps its own
choice. The ElevenLabs background filter does not cause the need to shout; it helps.

## Language setting and microphone audio

- **Wrong language setting:** someone answers in Hindi while the app is set to English, or the other way
  round. Clean speech (32 clips): ElevenLabs live 32/32 with the matching setting, 32/32 with the wrong
  one, 31/32 with auto-detect. OpenAI live 31/32, 29/32 and 30/32. The language setting does not explain
  poor recognition.
- **Resampling:** phones record at 44.1/48 kHz and the app converts to 16 kHz (ElevenLabs) or 24 kHz
  (OpenAI). The first version averaged neighbouring samples. That let hiss and the high parts of "s",
  "sh" and "ch" fold back into the 2–7 kHz speech band at only −5 to −16 dB. The synthetic voices in this
  benchmark have little energy up there, so the tests could not show it, but a real phone microphone
  does. It now uses a windowed-sinc low-pass: speech stays flat to about 6 kHz, and folding is cut by
  −40 to −98 dB (see `tests/audio.test.ts`).
- **Microphone check:** the voice panel in the app can record one sentence on the person's own phone and
  show what the live engine and both engines on the whole recording heard. Nothing is stored.

## Method (first run)

- **Answers:** 16 typical form answers (names, dates, phone numbers, PIN, addresses, yes/no, an option) in
  English, Hindi and mixed Hindi–English. Each was spoken by two synthetic voices: ElevenLabs "Bill"
  (older male) and OpenAI `gpt-4o-mini-tts` instructed to sound like an elderly Indian woman.
- **Conditions:** every answer was recorded three ways:
  - **clean**;
  - **TV far** (a reverberant TV news voice 10 dB quieter, plus room noise);
  - **TV near** (a dry TV voice only 5 dB quieter, plus noise: deliberately harsh).
- **No-answer clips:** 24 more clips contain only TV or noise. A recogniser must **not** produce
  something the form could take as an answer.
- **Streaming:** live models get the audio in real time, in 100 ms chunks, like the app sends it.
- **Scoring:** Claude judges each transcript the way the form needs it: same digits, same date, the
  same name (Devanagari or Latin spelling both count), same yes/no.

Results (correct out of total):

| Recogniser | Answers | Clean | TV far | TV near | No answer invented |
|---|---|---|---|---|---|
| **ElevenLabs realtime** (used) | **85/96** | 32/32 | 31/32 | 22/32 | **24/24** |
| ElevenLabs realtime + question as context + keyterms | 89/96 | 32/32 | 31/32 | 26/32 | 21/24 ✗ |
| ElevenLabs realtime + keyterms | 84/96 | 32/32 | 30/32 | 22/32 | 23/24 ✗ |
| ElevenLabs batch `scribe_v2` | 69/96 | 31/32 | 29/32 | 9/32 | 24/24 |
| ElevenLabs batch + keyterms (backup path) | 73/96 | 32/32 | 30/32 | 11/32 | 24/24 |
| ElevenLabs voice isolator → batch | 33/64* | 32/32 | – | 1/32 | – |
| OpenAI `gpt-live-transcribe` (live) | 71/96 | 30/32 | 30/32 | 11/32 | 24/24 |
| OpenAI `gpt-transcribe` (batch) | 78/96 | 32/32 | 31/32 | 15/32 | 24/24 |
| OpenAI `gpt-4o-mini-transcribe` + question prompt | 80/96 | 31/32 | 31/32 | 18/32 | 24/24 |
| OpenAI `gpt-4o-transcribe` + question prompt | 90/96 | 31/32 | 31/32 | 28/32 | **12/24 ✗** |

\* The voice isolator needs at least 4.6 s of audio, so answers were padded with silence. It was only
run on the first 64 clips.

## What we learned

- In clean audio or with a TV across the room, every model gets almost everything right. The difference
  is a loud voice close by: batch models then often transcribe **the TV instead of the person**.
  ElevenLabs' realtime voice detection with its background filter handles this best of the safe options.
- Telling a model the question being answered helps it ignore the TV, but it also makes it **invent
  answers from noise**. `gpt-4o-transcribe` "heard" हाँ, पुरुष, dates and names in half of the no-answer
  clips. An invented "yes" is the worst possible failure in a form app, so the app never sends the
  question to a recogniser.
- Keyterms (expected words) are used only on the batch backup, where they helped without inventing
  answers.
- OpenAI deprecates `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` (removal Feb 2027).

## Limits

- The voices are synthetic: real elderly speech, phone microphones and browser noise suppression will
  differ.
- The judge is a model, and each condition has 32 clips, so differences of 2–3 clips are within noise.

## Re-running

```bash
node scripts/speech-bench/gen.mjs .      # writes clips next to the script (git-ignored)
node scripts/speech-bench/run.mjs . el-realtime oa-gpt-transcribe
node scripts/speech-bench/run.mjs . --judge el-realtime oa-gpt-transcribe
node scripts/speech-bench/run.mjs . --report
```

The scripts read `ELEVENLABS_API_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` from `.env.local`. Running
them costs API credits.
