import "server-only";
import { LANGUAGES, type LanguageCode } from "@/lib/i18n/languages";
import { keytermsFor } from "@/lib/speechHints";
import type { SpeechHint } from "@/lib/types";
import { env, features } from "@/server/env";
import { HttpError } from "@/server/http";
import { log } from "@/server/log";

/**
 * SpeechService — ElevenLabs text-to-speech and speech-to-text (Scribe, batch and realtime).
 * The browser falls back to the Web Speech API when this service is not configured; that decision
 * is made client-side from /api/health so speech keeps working without an API key.
 */
const API = "https://api.elevenlabs.io/v1";

export interface SpeechService {
  synthesize(text: string, lang: LanguageCode): Promise<ArrayBuffer>;
  transcribe(audio: Blob, lang: LanguageCode, hint?: SpeechHint): Promise<{ text: string; languageCode: string | null }>;
  /** A single-use, 15-minute token that lets the browser open ONE realtime transcription socket. */
  realtimeToken(): Promise<string>;
}

class ElevenLabsSpeech implements SpeechService {
  async synthesize(text: string, lang: LanguageCode) {
    const body: Record<string, unknown> = {
      text,
      model_id: env.elevenLabsTtsModel,
      voice_settings: { stability: 0.6, similarity_boost: 0.75, speed: 0.9 },
    };
    // multilingual_v2 detects the language itself and rejects language_code; newer models accept it.
    if (!env.elevenLabsTtsModel.includes("multilingual_v2")) body.language_code = LANGUAGES[lang].isoCode;
    const res = await fetch(
      `${API}/text-to-speech/${encodeURIComponent(env.elevenLabsVoiceId)}?output_format=mp3_44100_128`,
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
    // Name the file by its real container: Chrome/Android record WebM/Opus, iPhones MP4/AAC.
    const ext = /mp4|aac|m4a/.test(audio.type) ? "m4a" : /ogg/.test(audio.type) ? "ogg" : /wav/.test(audio.type) ? "wav" : "webm";
    form.append("file", audio, `speech.${ext}`);
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
    return json.token;
  }
}

let instance: SpeechService | null = null;
export function speechService(): SpeechService {
  if (!features.elevenLabs()) throw new HttpError(503, "speech_not_configured", "ElevenLabs is not configured.");
  instance ??= new ElevenLabsSpeech();
  return instance;
}
