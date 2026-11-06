/**
 * Language registry. Adding a new Indian language means:
 *  1. add an entry here (set `enabled: true`),
 *  2. add a strings file in ./strings and register it in ./index.ts,
 *  3. add yes/no/repeat keywords in src/lib/conversation/keywords.ts for the offline fallback.
 * Claude and ElevenLabs (eleven_multilingual_v2 / Scribe) already handle the listed languages.
 */
export type LanguageCode = "en" | "hi" | "mr" | "ta" | "bn" | "te" | "gu" | "kn";

export interface LanguageInfo {
  code: LanguageCode;
  /** Name written in the language itself. */
  nativeName: string;
  englishName: string;
  /** BCP-47 locale for browser speech recognition / synthesis. */
  speechLocale: string;
  /** ISO 639-1 code for ElevenLabs. */
  isoCode: string;
  script: "Latin" | "Devanagari" | "Tamil" | "Bengali" | "Telugu" | "Gujarati" | "Kannada";
  enabled: boolean;
}

export const LANGUAGES: Record<LanguageCode, LanguageInfo> = {
  en: { code: "en", nativeName: "English", englishName: "English", speechLocale: "en-IN", isoCode: "en", script: "Latin", enabled: true },
  hi: { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", speechLocale: "hi-IN", isoCode: "hi", script: "Devanagari", enabled: true },
  mr: { code: "mr", nativeName: "मराठी", englishName: "Marathi", speechLocale: "mr-IN", isoCode: "mr", script: "Devanagari", enabled: false },
  ta: { code: "ta", nativeName: "தமிழ்", englishName: "Tamil", speechLocale: "ta-IN", isoCode: "ta", script: "Tamil", enabled: false },
  bn: { code: "bn", nativeName: "বাংলা", englishName: "Bengali", speechLocale: "bn-IN", isoCode: "bn", script: "Bengali", enabled: false },
  te: { code: "te", nativeName: "తెలుగు", englishName: "Telugu", speechLocale: "te-IN", isoCode: "te", script: "Telugu", enabled: false },
  gu: { code: "gu", nativeName: "ગુજરાતી", englishName: "Gujarati", speechLocale: "gu-IN", isoCode: "gu", script: "Gujarati", enabled: false },
  kn: { code: "kn", nativeName: "ಕನ್ನಡ", englishName: "Kannada", speechLocale: "kn-IN", isoCode: "kn", script: "Kannada", enabled: false },
};

export const ENABLED_LANGUAGES = Object.values(LANGUAGES).filter((l) => l.enabled);

export const DEFAULT_LANGUAGE: LanguageCode = "hi";

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && value in LANGUAGES;
}

export function isEnabledLanguage(value: unknown): value is LanguageCode {
  return isLanguageCode(value) && LANGUAGES[value].enabled;
}
