"use client";

import { Languages } from "lucide-react";
import { ENABLED_LANGUAGES } from "@/lib/i18n/languages";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app/AppContext";

/** Simple, always-visible language switch: one large tap target per language, written in that language. */
export function LanguageSelector({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { lang, setLang, t } = useApp();
  return (
    <div
      role="radiogroup"
      aria-label={t("language")}
      className={cn(
        "flex items-center gap-1 rounded-full p-1",
        tone === "dark" ? "bg-black/55 text-white" : "border border-slate-200 bg-white",
      )}
    >
      <Languages className={cn("ml-2 size-5", tone === "dark" ? "text-white/80" : "text-slate-500")} aria-hidden />
      {ENABLED_LANGUAGES.map((l) => {
        const active = l.code === lang;
        return (
          <button
            key={l.code}
            role="radio"
            aria-checked={active}
            lang={l.code}
            onClick={() => setLang(l.code)}
            className={cn(
              "min-h-11 min-w-14 rounded-full px-4 text-lg font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
              active
                ? tone === "dark"
                  ? "bg-white text-slate-900"
                  : "bg-blue-700 text-white"
                : tone === "dark"
                  ? "text-white"
                  : "text-slate-800 hover:bg-slate-100",
            )}
          >
            {l.nativeName}
          </button>
        );
      })}
    </div>
  );
}
