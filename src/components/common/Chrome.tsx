"use client";

import { AlertTriangle, ArrowLeft, Info, Loader2, Volume2, VolumeX } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app/AppContext";
import { LanguageSelector } from "./LanguageSelector";

export function TopBar({ onBack, right }: { onBack?: () => void; right?: ReactNode }) {
  const { t } = useApp();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2">
        {onBack ? (
          <button
            onClick={onBack}
            className="-ml-2 flex min-h-12 items-center gap-1 rounded-xl px-2 text-lg font-semibold text-blue-800 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
          >
            <ArrowLeft className="size-6" aria-hidden />
            {t("back")}
          </button>
        ) : (
          <span className="text-xl font-bold text-blue-800">{t("appName")}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {right}
          <LanguageSelector />
        </div>
      </div>
    </header>
  );
}

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn("mx-auto w-full max-w-2xl px-4 pb-10 pt-5", className)}>{children}</main>;
}

/** Bottom action area that stays reachable with one thumb on a phone. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-slate-100 bg-white/95 px-4 pt-4 pb-safe backdrop-blur">
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "border-blue-200 bg-blue-50 text-blue-950",
    warning: "border-amber-300 bg-amber-50 text-amber-950",
    error: "border-red-300 bg-red-50 text-red-900",
    success: "border-green-300 bg-green-50 text-green-950",
  }[tone];
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-2xl border-2 p-4 text-lg", styles)}>
      {tone !== "success" && <Icon className="mt-0.5 size-6 shrink-0" aria-hidden />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-lg text-slate-700" role="status">
      <Loader2 className="size-7 animate-spin text-blue-700" aria-hidden />
      {label}
    </div>
  );
}

/** Read a block of text aloud / stop. */
export function ReadAloudButton({ text, className }: { text: string; className?: string }) {
  const { speak, stopSpeaking, speaking, t } = useApp();
  return (
    <button
      onClick={() => (speaking ? stopSpeaking() : void speak(text))}
      className={cn(
        "inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-blue-200 bg-white px-4 text-lg font-semibold text-blue-800 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
        className,
      )}
    >
      {speaking ? <VolumeX className="size-6" aria-hidden /> : <Volume2 className="size-6" aria-hidden />}
      {speaking ? t("stopReading") : t("readAloud")}
    </button>
  );
}
