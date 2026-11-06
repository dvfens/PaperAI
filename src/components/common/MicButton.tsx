"use client";

import { Loader2, Mic, Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type MicState = "idle" | "listening" | "processing" | "speaking" | "disabled";

/**
 * The one big control of the conversation screen. Its state is always shown three ways — colour,
 * icon and a text label — so it never relies on colour alone.
 */
export function MicButton({
  state,
  label,
  level = 0,
  onPress,
}: {
  state: MicState;
  label: string;
  level?: number;
  onPress: () => void;
}) {
  const listening = state === "listening";
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={onPress}
        disabled={state === "disabled" || state === "processing"}
        aria-label={label}
        aria-pressed={listening}
        className={cn(
          "relative flex size-36 items-center justify-center rounded-full text-white shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-8 focus-visible:ring-blue-300 disabled:opacity-60",
          listening ? "listening-ring bg-red-600" : state === "speaking" ? "bg-blue-600" : "bg-blue-700 hover:bg-blue-800",
        )}
        style={listening ? { boxShadow: `0 0 0 ${Math.round(level * 18)}px rgb(220 38 38 / 0.25)` } : undefined}
      >
        {state === "processing" ? (
          <Loader2 className="size-16 animate-spin" aria-hidden />
        ) : listening ? (
          <Square className="size-14 fill-white" aria-hidden />
        ) : state === "speaking" ? (
          <Volume2 className="size-16" aria-hidden />
        ) : (
          <Mic className="size-16" aria-hidden />
        )}
      </button>
      <p className={cn("flex items-center gap-2 text-xl font-semibold", listening ? "text-red-700" : "text-slate-800")} aria-live="polite">
        {listening && <span className="inline-block size-3 rounded-full bg-red-600" aria-hidden />}
        {label}
      </p>
    </div>
  );
}
