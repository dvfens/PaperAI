import { en, type StringKey, type Strings } from "./strings/en";
import { hi } from "./strings/hi";
import { LANGUAGES, type LanguageCode } from "./languages";

/** Languages without their own strings file fall back to English UI text (Claude still speaks their language). */
const STRINGS: Partial<Record<LanguageCode, Strings>> = { en, hi };

export function strings(lang: LanguageCode): Strings {
  return STRINGS[lang] ?? en;
}

export function t(lang: LanguageCode, key: StringKey, vars?: Record<string, string | number>): string {
  const template = strings(lang)[key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] === undefined ? `{${name}}` : String(vars[name]),
  );
}

export function formatDate(lang: LanguageCode, date: Date | number | string, withTime = false): string {
  const d = date instanceof Date ? date : new Date(date);
  const locale = LANGUAGES[lang]?.speechLocale ?? "en-IN";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(d);
}

export type { StringKey, Strings };
