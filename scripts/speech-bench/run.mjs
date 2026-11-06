// Speech-recognition benchmark runner.
// Usage: node run.mjs <repo> <config> [<config> ...]     (results cached in results/<config>.json)
//        node run.mjs <repo> --judge <config> [...]       (Claude judges each transcript for form correctness)
//        node run.mjs <repo> --report
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = process.argv[2];
const args = process.argv.slice(3);
const envText = readFileSync(join(repo, ".env.local"), "utf8");
const env = (k) => (new RegExp(`^${k}=(.*)$`, "m").exec(envText)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const EL = env("ELEVENLABS_API_KEY");
const OA = env("OPENAI_API_KEY");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const clip = (name, kind) => readFileSync(join(here, "clips", `${name}.${kind}`));
const resultsDir = join(here, "results");
mkdirSync(resultsDir, { recursive: true });

// Hints the app could pass per question (what the field expects).
const HINTS = {
  name: { label: "Full name" },
  date: { label: "Date of birth" },
  phone: { label: "Mobile number" },
  address: { label: "Address" },
  yesno: { label: "Confirmation", keyterms: ["yes", "no", "हाँ", "नहीं", "haan", "nahin", "correct", "wrong", "सही", "गलत"] },
  choice: { label: "Gender", keyterms: ["Male", "Female", "Other", "पुरुष", "महिला", "अन्य"] },
  number: { label: "PIN code" },
};

const QUESTIONS = {
  name: { en: "What is your full name?", hi: "आपका पूरा नाम क्या है?" },
  date: { en: "What is your date of birth?", hi: "आपकी जन्मतिथि क्या है?" },
  phone: { en: "What is your mobile number?", hi: "आपका मोबाइल नंबर क्या है?" },
  address: { en: "What is your address?", hi: "आपका पता क्या है?" },
  yesno: { en: "Is that correct?", hi: "क्या यह सही है?" },
  choice: { en: "Are you male, female or other?", hi: "आप पुरुष हैं, महिला हैं या अन्य?" },
  number: { en: "What is your PIN code?", hi: "आपका पिन कोड क्या है?" },
};
/** The prompt the app would send: the question just asked, plus a no-translation instruction. */
export function contextPrompt(m) {
  const q = QUESTIONS[m.type][m.lang];
  return `An older person is answering this question on a form: "${q}" Transcribe only what they say, word for word, in the language they speak (Hindi in Devanagari, English in Latin letters). Do not translate.`;
}

// ---------------------------------------------------------------------------------------------
// ElevenLabs

async function elBatch(m, { lang = true, keyterms = false, model = "scribe_v2", audio, file = "speech.wav", noVerbatim = false } = {}) {
  const form = new FormData();
  form.append("model_id", model);
  form.append("file", new Blob([audio ?? clip(m.name, "16k.wav")], { type: "audio/wav" }), file);
  if (lang) form.append("language_code", m.lang);
  form.append("tag_audio_events", "false");
  if (noVerbatim) form.append("no_verbatim", "true");
  if (keyterms && HINTS[m.type].keyterms) for (const k of HINTS[m.type].keyterms) form.append("keyterms", k);
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": EL }, body: form });
  if (!r.ok) throw new Error(`el ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return j.text ?? "";
}

async function elIsolate(m) {
  const form = new FormData();
  // The isolator needs at least 4.6 s of audio: pad short answers with silence.
  let pcm = clip(m.name, "16k.pcm");
  const min = Math.ceil(4.8 * 16000) * 2;
  if (pcm.length < min) pcm = Buffer.concat([pcm, Buffer.alloc(min - pcm.length)]);
  form.append("audio", new Blob([pcm], { type: "application/octet-stream" }), "speech.pcm");
  form.append("file_format", "pcm_s16le_16");
  const r = await fetch("https://api.elevenlabs.io/v1/audio-isolation", { method: "POST", headers: { "xi-api-key": EL }, body: form });
  if (!r.ok) throw new Error(`isolate ${r.status} ${(await r.text()).slice(0, 300)}`);
  return { audio: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") };
}

async function elRealtime(m, { keyterms = false, vad = 1.2, filter = true, context = false } = {}) {
  const tok = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", { method: "POST", headers: { "xi-api-key": EL } });
  const { token } = await tok.json();
  const q = new URLSearchParams({
    model_id: "scribe_v2_realtime", token, audio_format: "pcm_16000", language_code: m.lang,
    commit_strategy: "vad", vad_silence_threshold_secs: String(vad), no_verbatim: "true",
  });
  if (filter) q.set("filter_background_audio", "true");
  if (keyterms && HINTS[m.type].keyterms) for (const k of HINTS[m.type].keyterms) q.append("keyterms", k);
  const pcm = clip(m.name, "16k.pcm");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${q}`);
    const committed = [];
    let partial = "";
    let sentAll = false;
    let settled = false;
    const done = () => { if (settled) return; settled = true; try { ws.close(); } catch {} resolve([...committed, partial].join(" ").trim()); };
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if (msg.message_type === "session_started") {
        for (let i = 0; i < pcm.length; i += 3200) {
          const chunk = { message_type: "input_audio_chunk", audio_base_64: pcm.subarray(i, i + 3200).toString("base64"), commit: false, sample_rate: 16000 };
          if (context && i === 0) chunk.previous_text = QUESTIONS[m.type][m.lang].slice(0, 50);
          ws.send(JSON.stringify(chunk));
          await new Promise((r) => setTimeout(r, 100));
        }
        sentAll = true;
        ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", commit: true, sample_rate: 16000 }));
        setTimeout(done, 6000);
      } else if (msg.message_type === "partial_transcript") {
        if (msg.text?.trim()) partial = msg.text.trim();
      } else if (msg.message_type === "committed_transcript") {
        if (msg.text?.trim()) { committed.push(msg.text.trim()); partial = ""; }
        if (sentAll) done();
      } else if (msg.error) reject(new Error(`${msg.message_type}: ${msg.error}`));
    };
    ws.onerror = () => reject(new Error("ws error"));
    setTimeout(() => reject(new Error("timeout")), 40000);
  });
}

// ---------------------------------------------------------------------------------------------
// OpenAI

async function oaBatch(m, { model, lang = true, prompt = false, prompt2 = false } = {}) {
  const form = new FormData();
  form.append("file", new Blob([clip(m.name, "16k.wav")], { type: "audio/wav" }), "speech.wav");
  form.append("model", model);
  if (lang) form.append("language", m.lang);
  if (prompt) {
    const h = HINTS[m.type];
    form.append("prompt", `The speaker is answering the form question "${h.label}"${h.keyterms ? ` (for example: ${h.keyterms.join(", ")})` : ""}. Hindi and English may be mixed.`);
  }
  if (prompt2) form.append("prompt", contextPrompt(m));
  form.append("response_format", "json");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${OA}` }, body: form });
  if (!r.ok) throw new Error(`oa ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return j.text ?? "";
}

async function oaTranscribe(m, { languages = [m.lang], prompt = false, keywords = false } = {}) {
  const form = new FormData();
  form.append("file", new Blob([clip(m.name, "16k.wav")], { type: "audio/wav" }), "speech.wav");
  form.append("model", "gpt-transcribe");
  for (const l of languages) form.append("languages[]", l);
  if (prompt) form.append("prompt", contextPrompt(m));
  if (keywords && HINTS[m.type].keyterms) for (const k of HINTS[m.type].keyterms) form.append("keywords[]", k);
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${OA}` }, body: form });
  if (!r.ok) throw new Error(`oa ${r.status} ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).text ?? "";
}

async function oaLive(m, { prompt = false, keywords = false, noise = "near_field", languages = ["hi", "en"], model = "gpt-live-transcribe" } = {}) {
  const transcription = { model, languages };
  if (prompt) transcription.prompt = contextPrompt(m);
  if (keywords && HINTS[m.type].keyterms) transcription.keywords = HINTS[m.type].keyterms;
  const sec = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { authorization: `Bearer ${OA}`, "content-type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 60 },
      session: { type: "transcription", audio: { input: { format: { type: "audio/pcm", rate: 24000 }, noise_reduction: noise ? { type: noise } : null, transcription, turn_detection: null } } },
    }),
  });
  if (!sec.ok) throw new Error(`secret ${sec.status} ${(await sec.text()).slice(0, 300)}`);
  const { value } = await sec.json();
  const pcm = clip(m.name, "24k.pcm");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", ["realtime", `openai-insecure-api-key.${value}`]);
    let deltas = "";
    let started = false;
    const timer = setTimeout(() => reject(new Error("timeout; deltas=" + deltas.slice(0, 80))), 45000);
    const finish = (t) => { clearTimeout(timer); try { ws.close(); } catch {} resolve(t); };
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if ((msg.type === "session.created" || msg.type === "transcription_session.created") && !started) {
        started = true;
        for (let i = 0; i < pcm.length; i += 4800) {
          ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.subarray(i, i + 4800).toString("base64") }));
          await new Promise((r) => setTimeout(r, 100));
        }
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      } else if (msg.type === "conversation.item.input_audio_transcription.delta") {
        deltas += msg.delta ?? "";
      } else if (msg.type === "conversation.item.input_audio_transcription.completed") {
        finish((msg.transcript ?? deltas).trim());
      } else if (msg.type === "conversation.item.input_audio_transcription.failed") {
        finish("");
      } else if (msg.type === "error") {
        clearTimeout(timer);
        reject(new Error(`error ${JSON.stringify(msg.error).slice(0, 300)}`));
      }
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error("ws error " + (e.message ?? ""))); };
  });
}

// ---------------------------------------------------------------------------------------------

export const CONFIGS = {
  "el-batch": (m) => elBatch(m),
  "el-batch-auto": (m) => elBatch(m, { lang: false }),
  "el-batch-keyterms": (m) => elBatch(m, { keyterms: true }),
  "el-isolate-batch": async (m) => {
    const iso = await elIsolate(m);
    return elBatch(m, { audio: iso.audio, file: /wav/.test(iso.type ?? "") ? "speech.wav" : "speech.mp3" });
  },
  "el-realtime": (m) => elRealtime(m),
  "el-realtime-nofilter": (m) => elRealtime(m, { filter: false }),
  "el-realtime-context": (m) => elRealtime(m, { keyterms: true, context: true }),
  "el-realtime-kw": (m) => elRealtime(m, { keyterms: true }),
  "el-realtime-vad15": (m) => elRealtime(m, { vad: 1.5 }),
  "oa-gt-lang": (m) => oaTranscribe(m),
  "oa-gt-hien": (m) => oaTranscribe(m, { languages: ["hi", "en"] }),
  "oa-gt-hien-prompt": (m) => oaTranscribe(m, { languages: ["hi", "en"], prompt: true }),
  "oa-gt-hien-prompt-kw": (m) => oaTranscribe(m, { languages: ["hi", "en"], prompt: true, keywords: true }),
  "oa-live": (m) => oaLive(m),
  "oa-live-ctx": (m) => oaLive(m, { prompt: true, keywords: true }),
  "oa-4o": (m) => oaBatch(m, { model: "gpt-4o-transcribe" }),
  "oa-4o-prompt2": (m) => oaBatch(m, { model: "gpt-4o-transcribe", prompt2: true }),
  "oa-mini-1215-prompt2": (m) => oaBatch(m, { model: "gpt-4o-mini-transcribe-2025-12-15", prompt2: true }),
  "oa-gpt-transcribe-prompt2": (m) => oaBatch(m, { model: "gpt-transcribe", prompt2: true }),
  "oa-4o-prompt": (m) => oaBatch(m, { model: "gpt-4o-transcribe", prompt: true }),
  "oa-mini-1215": (m) => oaBatch(m, { model: "gpt-4o-mini-transcribe-2025-12-15" }),
  "oa-gpt-transcribe": (m) => oaBatch(m, { model: "gpt-transcribe" }),
  "oa-gpt-transcribe-prompt": (m) => oaBatch(m, { model: "gpt-transcribe", prompt: true }),
};

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

async function runConfig(name) {
  const fn = CONFIGS[name];
  if (!fn) throw new Error(`unknown config ${name}`);
  const file = join(resultsDir, `${name}.json`);
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const conc = /realtime|live/.test(name) ? 3 : 6;
  await pool(manifest, conc, async (m) => {
    if (prev[m.name]?.text !== undefined && !prev[m.name].error && !(process.env.RETRY_EMPTY && !prev[m.name].text)) return;
    const t0 = Date.now();
    try {
      const text = await fn(m);
      prev[m.name] = { text, ms: Date.now() - t0 };
    } catch (err) {
      prev[m.name] = { error: String(err.message ?? err).slice(0, 300), ms: Date.now() - t0 };
    }
    process.stdout.write(prev[m.name].error ? "x" : ".");
  });
  writeFileSync(file, JSON.stringify(prev, null, 2));
  const errs = Object.values(prev).filter((r) => r.error);
  console.log(`\n${name}: ${Object.keys(prev).length - errs.length} ok, ${errs.length} errors${errs.length ? " — e.g. " + errs[0].error : ""}`);
}

async function judge(name) {
  const file = join(resultsDir, `${name}.json`);
  const res = JSON.parse(readFileSync(file, "utf8"));
  const { default: Anthropic } = await import(pathToFileURL(join(repo, "node_modules", "@anthropic-ai", "sdk", "index.mjs")).href).catch(async () =>
    import(pathToFileURL(join(repo, "node_modules", "@anthropic-ai", "sdk", "index.js")).href),
  );
  const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  const todo = manifest.filter((m) => res[m.name] && res[m.name].correct === undefined);
  if (!todo.length) return console.log(`${name}: nothing to judge`);
  for (let b = 0; b < todo.length; b += 60) await judgeBatch(name, res, client, todo.slice(b, b + 60));
  writeFileSync(file, JSON.stringify(res, null, 2));
  console.log(`${name}: judged ${todo.length}`);
}

async function judgeBatch(name, res, client, batch) {
  const items = batch.map((m) => ({ id: m.name, field_type: m.type, expected_answer: m.truth, transcript: res[m.name]?.error ? "(recognition failed)" : res[m.name]?.text ?? "" }));
  const prompt = `You grade speech recognition for a voice form-filling app used by elderly people in India. For each item, decide whether the TRANSCRIPT would let the form record the EXPECTED ANSWER correctly, without asking again.
Rules by field_type:
- name: the same name; spelling or script variants of the same sounds are fine (Sunita Devi = सुनीता देवी, Sharma = Sharmaa); a different or partly missing name is wrong.
- date: same day, month and year.
- phone / number: exactly the same digit sequence.
- address: every component present (house/flat number, area, city/district/state as given); script or spelling variants fine.
- yesno: same yes/no meaning.
- choice: clearly maps to the correct option.
An empty transcript or "(recognition failed)" is wrong.
SPECIAL CASE — expected_answer starting with "(NO ANSWER": nobody answered; the audio holds only a TV or background noise. Then the item is CORRECT if the transcript is empty or is clearly NOT an answer to the field (e.g. unrelated news sentences), and WRONG if it contains something the form could take as an answer for that field_type (a yes/no word for yesno, an option for choice, a person's name for name, a date for date, digits for phone, a place/address for address). An invented answer is the worst possible failure. Extra words that do not change the answer are fine.
Reply with ONLY a JSON array, one object per item in order: {"id": "...", "correct": true|false, "why": "<at most 8 words>"}.

ITEMS:
${JSON.stringify(items, null, 1)}`;
  const msg = await client.messages.create({ model: "claude-opus-5-5", max_tokens: 16000, messages: [{ role: "user", content: prompt }] });
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  for (const v of arr) if (res[v.id]) Object.assign(res[v.id], { correct: v.correct, why: v.why });
}

function report() {
  const rows = [];
  for (const name of Object.keys(CONFIGS)) {
    const file = join(resultsDir, `${name}.json`);
    if (!existsSync(file)) continue;
    const res = JSON.parse(readFileSync(file, "utf8"));
    const judged = manifest.filter((m) => res[m.name]?.correct !== undefined);
    if (!judged.length) continue;
    const acc = (f) => {
      const s = judged.filter(f);
      return s.length ? `${s.filter((m) => res[m.name].correct).length}/${s.length}` : "-";
    };
    const ms = judged.map((m) => res[m.name].ms).sort((a, b) => a - b);
    rows.push({
      config: name,
      answers: acc((m) => m.item !== "none"),
      clean: acc((m) => m.cond === "clean"),
      "tv far": acc((m) => m.cond === "tv" && m.item !== "none"),
      "tv near": acc((m) => m.cond === "noisy" && m.item !== "none"),
      "no invented": acc((m) => m.item === "none"),
      en: acc((m) => m.lang === "en"),
      hi: acc((m) => m.lang === "hi"),
      "median ms": ms[Math.floor(ms.length / 2)],
    });
  }
  console.table(rows);
}

if (args[0] === "--judge") for (const c of args.slice(1)) await judge(c);
else if (args[0] === "--report") report();
else for (const c of args) await runConfig(c);
