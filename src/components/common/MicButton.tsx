"use client";

import { Loader2, Mic, Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type MicState = "idle" | "listening" | "processing" | "speaking" | "disabled";

/**
 * The one big control of the voice screens. Its state is always shown three ways — colour, icon and
 * a text label (visible, or announced when `showLabel` is off) — so it never relies on colour alone.
 */
export function MicButton({
  state,
  label,
  level = 0,
  onPress,
  size = "lg",
  showLabel = true,
}: {
  state: MicState;
  label: string;
  level?: number;
  onPress: () => void;
  size?: "lg" | "md";
  showLabel?: boolean;
}) {
  const listening = state === "listening";
  const big = size === "lg";
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onPress}
        disabled={state === "disabled" || state === "processing"}
        aria-label={label}
        aria-pressed={listening}
        className={cn(
          "relative flex items-center justify-center rounded-full text-white shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-8 focus-visible:ring-blue-300 disabled:opacity-60",
          big ? "size-28" : "size-[4.5rem]",
          listening ? "listening-ring bg-red-600" : state === "speaking" ? "bg-blue-500" : "bg-blue-600 hover:bg-blue-700",
        )}
        style={listening ? { boxShadow: `0 0 0 ${Math.round(level * 16)}px rgb(220 38 38 / 0.25)` } : undefined}
      >
        {state === "processing" ? (
          <Loader2 className={cn("animate-spin", big ? "size-12" : "size-8")} aria-hidden />
        ) : listening ? (
          <Square className={cn("fill-white", big ? "size-10" : "size-7")} aria-hidden />
        ) : state === "speaking" ? (
          <Volume2 className={big ? "size-12" : "size-8"} aria-hidden />
        ) : (
          <Mic className={big ? "size-12" : "size-8"} aria-hidden />
        )}
      </button>
      {showLabel && (
        <p className={cn("flex items-center gap-2 text-base font-semibold", listening ? "text-red-700" : "text-slate-700")} aria-live="polite">
          {listening && <span className="inline-block size-2.5 rounded-full bg-red-600" aria-hidden />}
          {label}
        </p>
      )}
    </div>
  );
}
