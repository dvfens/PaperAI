import "server-only";
import { LANGUAGES, type LanguageCode } from "@/lib/i18n/languages";
import { keytermsFor } from "@/lib/speechHints";
import type { SpeechHint, SpeechProvider, VoiceStyle } from "@/lib/types";
import { env, features } from "@/server/env";
import { HttpError } from "@/server/http";
import { log } from "@/server/log";

/**
 * SpeechService — text-to-speech and speech-to-text from ElevenLabs (default) or OpenAI; the person
 * can switch engines in the app. The browser falls back to the Web Speech API when neither is
 * configured; that decision is made client-side from /api/health. API keys never leave the server:
 * live recognition uses short-lived, single-connection tokens.
 */
const API = "https://api.elevenlabs.io/v1";
const OPENAI = "https://api.openai.com/v1";

export interface RealtimeToken {
  token: string;
  model: string;
  /** Unix seconds; null when the provider does not say (ElevenLabs tokens last 15 minutes). */
  expiresAt: number | null;
}

export interface SpeechService {
  synthesize(text: string, lang: LanguageCode, voice?: VoiceStyle): Promise<ArrayBuffer>;
  transcribe(audio: Blob, lang: LanguageCode, hint?: SpeechHint): Promise<{ text: string; languageCode: string | null }>;
  /** A short-lived token that lets the browser open ONE realtime transcription socket. */
  realtimeToken(lang: LanguageCode): Promise<RealtimeToken>;
}

/** Name the upload by its real container: Chrome/Android record WebM/Opus, iPhones MP4/AAC. */
const audioFileName = (audio: Blob) =>
  `speech.${/mp4|aac|m4a/.test(audio.type) ? "m4a" : /ogg/.test(audio.type) ? "ogg" : /wav/.test(audio.type) ? "wav" : "webm"}`;

/**
 * ElevenLabs voices on offer. All were measured intelligible in Hindi and English (Scribe transcribed
 * their speech back with ≤2% character errors). "Anjali" is a native Hindi voice from the ElevenLabs
 * voice library, added to this project's ElevenLabs account; the other two are premade voices.
 * Another deployment's ElevenLabs account can use Anjali too: library voices work by id.
 */
const ELEVENLABS_VOICES: Record<VoiceStyle, string> = {
  "young-woman": "Kfn3fYy8XcPyUvbTxn1H", // "Anjali — Friendly EdTech Teacher": warm, patient, young Indian woman
  "young-man": "bIHbv24MWmeRgasZH58o", // "Will" — relaxed, optimistic
  calm: "JBFqnCBsd6RMkjVDRZzb", // "George" — calm, mature
};

class ElevenLabsSpeech implements SpeechService {
  async synthesize(text: string, lang: LanguageCode, voice?: VoiceStyle) {
    const voiceId = voice ? ELEVENLABS_VOICES[voice] : env.elevenLabsVoiceId;
    const body: Record<string, unknown> = {
      text,
      model_id: env.elevenLabsTtsModel,
      // A little more expression ("style") sounds friendlier; slightly slow for older listeners.
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, speed: 0.95 },
    };
    // multilingual_v2 detects the language itself and rejects language_code; newer models accept it.
    if (!env.elevenLabsTtsModel.includes("multilingual_v2")) body.language_code = LANGUAGES[lang].isoCode;
    const res = await fetch(
      `${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": env.elevenLabsApiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      log.warn("tts.failed", { provider: "elevenlabs", status: res.status });
      throw new HttpError(502, "tts_failed", "Voice service failed.");
    }
    return res.arrayBuffer();
  }

  async transcribe(audio: Blob, lang: LanguageCode, hint?: SpeechHint) {
    const form = new FormData();
    form.append("model_id", env.elevenLabsSttModel);
    form.append("file", audio, audioFileName(audio));
    form.append("language_code", LANGUAGES[lang].isoCode);
    form.append("tag_audio_events", "false");
    // Keyterms only where the expected words are known (yes/no, options). Measured on noisy Hindi and
    // English answers they improved accuracy without making the model invent answers from noise.
    for (const term of keytermsFor(hint)) form.append("keyterms", term);
    const res = await fetch(`${API}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": env.elevenLabsApiKey },
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      log.warn("stt.failed", { provider: "elevenlabs", status: res.status });
      throw new HttpError(502, "stt_failed", "Speech recognition failed.");
    }
    const json = (await res.json()) as { text?: string; language_code?: string };
    return { text: (json.text ?? "").trim(), languageCode: json.language_code ?? null };
  }

  async realtimeToken() {
    const res = await fetch(`${API}/single-use-token/realtime_scribe`, {
      method: "POST",
      headers: { "xi-api-key": env.elevenLabsApiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn("stt.token_failed", { provider: "elevenlabs", status: res.status });
      throw new HttpError(502, "stt_token_failed", "Speech recognition is unavailable.");
    }
    const json = (await res.json()) as { token?: string };
    if (!json.token) throw new HttpError(502, "stt_token_failed", "Speech recognition is unavailable.");
    return { token: json.token, model: "scribe_v2_realtime", expiresAt: null };
  }
}

/** Voice style for gpt-4o-mini-tts (it takes free-form speaking instructions). */
const OPENAI_VOICE_STYLE: Record<string, string> = {
  hi: "You are a friendly, cheerful young woman helping an elderly person. Speak natural Hindi, warmly and with a smile, a little slowly and very clearly.",
  en: "You are a friendly, cheerful young woman helping an elderly person. Speak warmly and with a smile, with a gentle Indian English accent, a little slowly and very clearly.",
};

class OpenAISpeech implements SpeechService {
  private headers(json = false): Record<string, string> {
    return { authorization: `Bearer ${env.openaiApiKey}`, ...(json ? { "content-type": "application/json" } : {}) };
  }

  async synthesize(text: string, lang: LanguageCode) {
    // One OpenAI voice (coral, a young woman) with friendly speaking instructions.
    const res = await fetch(`${OPENAI}/audio/speech`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        model: env.openaiTtsModel,
        voice: env.openaiTtsVoice,
        input: text,
        response_format: "mp3",
        speed: 0.95,
        instructions: OPENAI_VOICE_STYLE[LANGUAGES[lang].isoCode] ?? OPENAI_VOICE_STYLE.en,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      log.warn("tts.failed", { provider: "openai", status: res.status });
      throw new HttpError(502, "tts_failed", "Voice service failed.");
    }
    return res.arrayBuffer();
  }

  async transcribe(audio: Blob, lang: LanguageCode, hint?: SpeechHint) {
    const form = new FormData();
    form.append("file", audio, audioFileName(audio));
    form.append("model", env.openaiSttModel);
    // gpt-transcribe takes languages[] and keywords[]; the older gpt-4o-* models take language.
    if (env.openaiSttModel.startsWith("gpt-transcribe")) {
      form.append("languages[]", LANGUAGES[lang].isoCode);
      for (const term of keytermsFor(hint)) form.append("keywords[]", term);
    } else {
      form.append("language", LANGUAGES[lang].isoCode);
    }
    const res = await fetch(`${OPENAI}/audio/transcriptions`, {
      method: "POST",
      headers: this.headers(),
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      log.warn("stt.failed", { provider: "openai", status: res.status });
      throw new HttpError(502, "stt_failed", "Speech recognition failed.");
    }
    const json = (await res.json()) as { text?: string; languages?: { code?: string }[] };
    return { text: (json.text ?? "").trim(), languageCode: json.languages?.[0]?.code ?? null };
  }

  /**
   * Client secret for one transcription-only realtime session. The session (model, language, audio
   * format, noise reduction) is fixed here on the server; the browser only streams audio. This model
   * has no server-side turn detection, so the browser commits the answer when it ends.
   */
  async realtimeToken(lang: LanguageCode) {
    const res = await fetch(`${OPENAI}/realtime/client_secrets`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              // Off: "near_field" cut distant and normal voices (5/32 correct vs 30/32 without it).
              noise_reduction: null,
              transcription: { model: env.openaiLiveSttModel, languages: [LANGUAGES[lang].isoCode] },
              turn_detection: null,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn("stt.token_failed", { provider: "openai", status: res.status });
      throw new HttpError(502, "stt_token_failed", "Speech recognition is unavailable.");
    }
    const json = (await res.json()) as { value?: string; expires_at?: number };
    if (!json.value) throw new HttpError(502, "stt_token_failed", "Speech recognition is unavailable.");
    return { token: json.value, model: env.openaiLiveSttModel, expiresAt: json.expires_at ?? null };
  }
}

const instances: Partial<Record<SpeechProvider, SpeechService>> = {};
export function speechService(provider: SpeechProvider = "elevenlabs"): SpeechService {
  if (provider === "openai") {
    if (!features.openai()) throw new HttpError(503, "speech_not_configured", "OpenAI is not configured.");
    return (instances.openai ??= new OpenAISpeech());
  }
  if (!features.elevenLabs()) throw new HttpError(503, "speech_not_configured", "ElevenLabs is not configured.");
  return (instances.elevenlabs ??= new ElevenLabsSpeech());
}
