// Builds the speech-recognition benchmark set: 16 form answers x 2 voices x (clean, noisy).
// Master audio is 24 kHz mono 16-bit PCM; 16 kHz copies are derived for 16 kHz recognisers.
// Usage: node gen.mjs <repo>
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = process.argv[2];
const envText = readFileSync(join(repo, ".env.local"), "utf8");
const env = (k) => /^(\w+)=(.*)$/gm.exec ? (new RegExp(`^${k}=(.*)$`, "m").exec(envText)?.[1] ?? "").trim().replace(/^["']|["']$/g, "") : "";
const EL = env("ELEVENLABS_API_KEY");
const OA = env("OPENAI_API_KEY");

export const ITEMS = [
  { id: "en-name", lang: "en", type: "name", text: "My name is Ramesh Kumar Sharma.", truth: "Ramesh Kumar Sharma" },
  { id: "en-dob", lang: "en", type: "date", text: "My date of birth is the fifth of March, nineteen fifty two.", truth: "5 March 1952" },
  { id: "en-phone", lang: "en", type: "phone", text: "My mobile number is nine eight seven six five, four three two one zero.", truth: "9876543210" },
  { id: "en-address", lang: "en", type: "address", text: "I live at flat twelve, Shanti Nagar, Andheri East, Mumbai.", truth: "Flat 12, Shanti Nagar, Andheri East, Mumbai" },
  { id: "en-yes", lang: "en", type: "yesno", text: "Yes, that is correct.", truth: "yes" },
  { id: "en-choice", lang: "en", type: "choice", text: "Female.", truth: "Female (options: Male, Female, Other)" },
  { id: "en-pin", lang: "en", type: "number", text: "My pin code is four zero zero zero six nine.", truth: "400069" },
  { id: "en-no", lang: "en", type: "yesno", text: "No, the spelling is wrong.", truth: "no (the spelling is wrong)" },
  { id: "hi-name", lang: "hi", type: "name", text: "मेरा नाम सुनीता देवी है।", truth: "Sunita Devi (सुनीता देवी)" },
  { id: "hi-dob", lang: "hi", type: "date", text: "मेरी जन्मतिथि पंद्रह अगस्त उन्नीस सौ अड़तालीस है।", truth: "15 August 1948" },
  { id: "hi-phone", lang: "hi", type: "phone", text: "मेरा मोबाइल नंबर नौ आठ दो शून्य एक दो तीन चार पाँच छह है।", truth: "9820123456" },
  { id: "hi-yes", lang: "hi", type: "yesno", text: "हाँ, सही है।", truth: "yes" },
  { id: "hi-no", lang: "hi", type: "yesno", text: "नहीं, यह गलत है।", truth: "no" },
  { id: "hi-address", lang: "hi", type: "address", text: "मैं गाँव रामपुर, ज़िला बरेली, उत्तर प्रदेश में रहती हूँ।", truth: "Village Rampur, District Bareilly, Uttar Pradesh" },
  { id: "mix-address", lang: "hi", type: "address", text: "मेरा address है flat number बारह, Shanti Nagar, Mumbai.", truth: "Flat 12, Shanti Nagar, Mumbai" },
  { id: "hi-choice", lang: "hi", type: "choice", text: "पुरुष।", truth: "Male / पुरुष (options: Male, Female, Other)" },
];

const BABBLE = [
  "आज की मुख्य खबरें। दिल्ली में बारिश के कारण कई सड़कों पर पानी भर गया है और यातायात धीमा चल रहा है।",
  "And now the weather. Heavy rain is expected across Maharashtra over the next two days, so please carry an umbrella.",
  "क्रिकेट में भारत ने शानदार जीत दर्ज की, कप्तान ने आख़िरी ओवर में छक्का लगाया।",
  "Prices of vegetables have gone up again this week, with onions and tomatoes costing more in most markets.",
];

async function elTts(text, voice) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_24000`, {
    method: "POST",
    headers: { "xi-api-key": EL, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.9 } }),
  });
  if (!r.ok) throw new Error(`el tts ${r.status} ${await r.text()}`);
  return toInt16(Buffer.from(await r.arrayBuffer()));
}

async function oaTts(text, lang) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${OA}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: text,
      response_format: "pcm",
      instructions:
        lang === "hi"
          ? "Speak as an elderly Indian woman from Uttar Pradesh, in natural Hindi, a little slowly, with an ordinary home-microphone tone."
          : "Speak as an elderly Indian woman with a natural Indian English accent, a little slowly, like answering a form question at home.",
    }),
  });
  if (!r.ok) throw new Error(`oa tts ${r.status} ${await r.text()}`);
  return toInt16(Buffer.from(await r.arrayBuffer()));
}

function toInt16(buf) {
  const out = new Int16Array(buf.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));

/** Box-average resampler (same method as the app's capture path). */
export function resample(int16, from, to) {
  const r = from / to;
  const n = Math.floor(int16.length / r);
  const out = new Int16Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.floor(k * r);
    const b = Math.max(a + 1, Math.floor((k + 1) * r));
    let s = 0;
    for (let i = a; i < b && i < int16.length; i++) s += int16[i];
    out[k] = Math.round(s / (b - a));
  }
  return out;
}

function pink(n, seed = 7) {
  // Paul Kellet's economy pink-noise filter over a seeded white source.
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  let b0 = 0, b1 = 0, b2 = 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = rnd();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = b0 + b1 + b2 + w * 0.1848;
  }
  return out;
}

function wav(int16, rate) {
  const b = Buffer.alloc(44 + int16.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + int16.length * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36);
  b.writeUInt32LE(int16.length * 2, 40);
  for (let i = 0; i < int16.length; i++) b.writeInt16LE(int16[i], 44 + i * 2);
  return b;
}

const RATE = 24000;
const out = join(here, "clips");
mkdirSync(out, { recursive: true });

async function main() {
  // Background "TV": babble sentences concatenated and looped.
  const babbleFile = join(here, "babble.pcm");
  let babble;
  if (existsSync(babbleFile)) babble = toInt16(readFileSync(babbleFile));
  else {
    const parts = [];
    for (const [i, s] of BABBLE.entries()) parts.push(await elTts(s, i % 2 ? "onwK4e9ZLuTAKqWW03F9" : "XrExE9yKIg1WjnnlVkGX"));
    const len = parts.reduce((n, p) => n + p.length, 0);
    babble = new Int16Array(len);
    let o = 0;
    for (const p of parts) (babble.set(p, o), (o += p.length));
    writeFileSync(babbleFile, Buffer.from(babble.buffer));
  }
  const revFile = join(here, "babble-rev.pcm");
  let babbleRev;
  if (existsSync(revFile)) babbleRev = toInt16(readFileSync(revFile));
  else {
    // Exponentially decaying noise impulse response (RT60 ≈ 0.5 s) plus a weak direct path.
    const L = Math.round(0.5 * RATE);
    const ir = pink(L, 99).map((v, i) => v * Math.exp((-6.9 * i) / L) * 0.05);
    ir[0] = 0.4;
    const y = new Float32Array(babble.length);
    for (let i = 0; i < babble.length; i++) {
      const x = babble[i];
      if (!x) continue;
      const lim = Math.min(L, babble.length - i);
      for (let k = 0; k < lim; k += 2) y[i + k] += x * ir[k]; // every other tap: fast and still diffuse
    }
    const g = rms(babble) / (rms(y) || 1);
    babbleRev = Int16Array.from(y, (v) => Math.max(-32768, Math.min(32767, Math.round(v * g))));
    writeFileSync(revFile, Buffer.from(babbleRev.buffer));
  }
  const manifest = [];
  const COND = {
    clean: null,
    noisy: { src: () => babble, babbleSnr: 5, pinkSnr: 15 }, // a TV right next to the phone
    tv: { src: () => babbleRev, babbleSnr: 10, pinkSnr: 22 }, // a TV across the room
  };
  const mixNoise = (mix, total, cond, seedA, seedB, speechRms) => {
    const c = COND[cond];
    if (!c) return;
    const src = c.src();
    const bOff = seedA % src.length;
    const bSeg = Float32Array.from({ length: total }, (_, i) => src[(bOff + i) % src.length]);
    const bGain = speechRms / (rms(bSeg.filter((v) => Math.abs(v) > 300)) || 1) / Math.pow(10, c.babbleSnr / 20);
    const pn = pink(total, seedB);
    const pGain = speechRms / (rms(pn) || 1) / Math.pow(10, c.pinkSnr / 20);
    for (let i = 0; i < total; i++) mix[i] += bSeg[i] * bGain + pn[i] * pGain;
  };
  const save = (name, mix, meta) => {
    let peak = 0;
    for (const v of mix) peak = Math.max(peak, Math.abs(v));
    const g = peak > 30000 ? 30000 / peak : 1;
    const pcm24 = Int16Array.from(mix, (v) => Math.round(v * g));
    const pcm16 = resample(pcm24, RATE, 16000);
    writeFileSync(join(out, `${name}.24k.pcm`), Buffer.from(pcm24.buffer));
    writeFileSync(join(out, `${name}.16k.pcm`), Buffer.from(pcm16.buffer));
    writeFileSync(join(out, `${name}.16k.wav`), wav(pcm16, 16000));
    manifest.push({ name, ...meta, secs: +(mix.length / RATE).toFixed(2) });
  };
  const voices = [
    { key: "el", tts: (it) => elTts(it.text, "pqHfZKP75CvOlQylNhV4") }, // "Bill" — older male
    { key: "oa", tts: (it) => oaTts(it.text, it.lang) }, // elderly Indian woman (instructed)
  ];
  for (const it of ITEMS) {
    for (const v of voices) {
      const base = `${it.id}.${v.key}`;
      const speechFile = join(out, `${base}.speech.pcm`);
      let speech;
      if (existsSync(speechFile)) speech = toInt16(readFileSync(speechFile));
      else {
        speech = await v.tts(it);
        writeFileSync(speechFile, Buffer.from(speech.buffer));
      }
      const lead = Math.round(0.6 * RATE);
      const tail = Math.round(2.0 * RATE);
      const total = lead + speech.length + tail;
      const speechRms = rms(speech.filter((s) => Math.abs(s) > 300)) || rms(speech);
      for (const cond of Object.keys(COND)) {
        const mix = new Float32Array(total);
        for (let i = 0; i < speech.length; i++) mix[lead + i] = speech[i];
        mixNoise(mix, total, cond, it.id.length * 7919 + v.key.charCodeAt(0) * 31, it.id.length + 3, speechRms);
        save(`${base}.${cond}`, mix, { item: it.id, voice: v.key, cond, lang: it.lang, type: it.type, text: it.text, truth: it.truth });
      }
      process.stdout.write(".");
    }
  }
  const refRms = 3000;
  for (const type of ["name", "date", "phone", "yesno", "choice", "address"]) {
    for (const lang of ["en", "hi"]) {
      for (const cond of ["noisy", "tv"]) {
        const total = Math.round(4.6 * RATE);
        const mix = new Float32Array(total);
        mixNoise(mix, total, cond, type.length * 104729 + lang.charCodeAt(0) * 977, type.length * 13 + 1, refRms);
        save(`none-${type}-${lang}.${cond}`, mix, { item: "none", voice: "none", cond, lang, type, text: "", truth: "(NO ANSWER: nobody answered; only background TV and noise)" });
      }
    }
  }
  writeFileSync(join(here, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n${manifest.length} clips`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("gen.mjs")) await main();
