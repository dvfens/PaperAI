"use client";

import { ENABLED_LANGUAGES, type LanguageCode } from "@/lib/i18n/languages";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app/AppContext";

/** Short label shown in the compact switch; the full name is announced to screen readers. */
const SHORT: Partial<Record<LanguageCode, string>> = { en: "EN", hi: "हि", mr: "म", ta: "த", bn: "বা", te: "తె", gu: "ગુ", kn: "ಕ" };

/**
 * Compact language switch — one 44px tap target per language, in a small pill. Shown on the camera
 * screen and as the AppBar fallback when a screen passes no `menu` (elsewhere Language is in the Menu).
 */
export function LanguageSelector({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { lang, setLang, t } = useApp();
  return (
    <div
      role="radiogroup"
      aria-label={t("language")}
      className={cn("flex items-center rounded-full p-0.5", tone === "dark" ? "bg-black/45 backdrop-blur" : "bg-slate-200/70")}
    >
      {ENABLED_LANGUAGES.map((l) => {
        const active = l.code === lang;
        return (
          <button
            key={l.code}
            role="radio"
            aria-checked={active}
            aria-label={l.nativeName}
            lang={l.code}
            onClick={() => setLang(l.code)}
            className={cn(
              "flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-base font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
              active
                ? tone === "dark"
                  ? "bg-white text-slate-900"
                  : "bg-white text-blue-700 shadow-sm"
                : tone === "dark"
                  ? "text-white/85"
                  : "text-slate-600",
            )}
          >
            {SHORT[l.code] ?? l.code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
