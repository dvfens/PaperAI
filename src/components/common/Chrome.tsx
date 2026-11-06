"use client";

/**
 * Mobile app design system for Saathi.
 *
 * Rules:
 * - Each screen has one focus and at most ONE filled (blue or green) button.
 * - Primary actions live in the Dock.
 * - IconAction is the labelled secondary action.
 * - IconButton (icon only) is only for Back, Close and speaker buttons.
 * - Chip is for STATUS only. MetaLine is for neutral facts.
 * - Colours: blue = current item or action, green = saved or done, amber = needs attention,
 *   red = recording or error, slate = neutral, empty or skipped.
 * - Sizes follow a normal phone app: 15px body, 13px secondary text, 12px captions and labels
 *   under icons, 17px bar titles, 20px screen headings; touch targets at least 40px.
 * - ChevronLeft goes to the previous screen. X is only for closing a sheet or cancelling a
 *   running task (AnalyzingScreen).
 */
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, Volume2, VolumeX, X } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app/AppContext";
import { LanguageSelector } from "./LanguageSelector";

export type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

// --- Layout ------------------------------------------------------------------------------------

/**
 * Compact top app bar: back/close on the left, short title next to it, the screen's Menu on the
 * right (or the language switch when no `menu` is passed). `progress` (0–1) adds a thin bar below.
 * AppBar does not import AppMenu (no import cycle): screens pass `menu={<AppMenu />}`.
 */
export function AppBar({
  title,
  onBack,
  back = "back",
  right,
  menu,
  progress,
}: {
  title?: string;
  onBack?: () => void;
  back?: "back" | "close";
  right?: ReactNode;
  menu?: ReactNode;
  progress?: number;
}) {
  const { t } = useApp();
  const BackIcon = back === "close" ? X : ChevronLeft;
  return (
    <header className="sticky top-0 z-20 bg-slate-50/90 backdrop-blur">
      <div className="mx-auto grid h-12 max-w-2xl grid-cols-[2.75rem_1fr_auto] items-center gap-2 px-3">
        {onBack ? (
          <IconButton icon={BackIcon} label={t(back === "close" ? "close" : "back")} onClick={onBack} />
        ) : (
          <span className="pl-2 text-[17px] font-extrabold tracking-tight text-blue-700">{t("appName")}</span>
        )}
        {title ? <h1 className="min-w-0 truncate text-left text-[17px] font-semibold text-slate-900">{title}</h1> : <span aria-hidden />}
        <div className="flex items-center justify-end gap-1">
          {right}
          {menu ?? <LanguageSelector />}
        </div>
      </div>
      {progress !== undefined && (
        <div className="mx-auto max-w-2xl px-4 pb-2">
          <ProgressBar value={progress} />
        </div>
      )}
    </header>
  );
}

/** The app's only progress style: a thin blue bar (value 0–1). */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-slate-200", className)} aria-hidden>
      <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Scrolling page body. `dock` leaves room for a fixed bottom dock. */
export function Page({ children, className, dock = true }: { children: ReactNode; className?: string; dock?: boolean }) {
  return (
    <main className={cn("mx-auto w-full max-w-2xl px-4 pt-2", dock ? "pb-40" : "pb-10", className)}>{children}</main>
  );
}

/** Fixed bottom dock for the screen's primary actions (max two big buttons). */
export function Dock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className={cn("mx-auto flex max-w-2xl flex-col gap-2 px-4 pt-2.5 pb-safe", className)}>{children}</div>
    </div>
  );
}

/** Full-height app background used by every screen except the camera. */
export function AppScreen({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-slate-50">{children}</div>;
}

// --- Building blocks ---------------------------------------------------------------------------

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const cls = cn("block w-full rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm", className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "transition-colors hover:border-blue-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 active:bg-slate-50")}>
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function SectionTitle({ icon: I, children, right }: { icon?: Icon; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-1.5 mt-5 flex items-center justify-between gap-2 px-1">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500">
        {I && <I className="size-4 text-slate-400" aria-hidden />}
        {children}
      </h2>
      {right}
    </div>
  );
}

/** A neutral fact (no pill): small icon + text. Use Chip only for status. */
export function MetaLine({ icon: I, children }: { icon?: Icon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
      {I && <I className="size-4 shrink-0 text-slate-500" aria-hidden />}
      {children}
    </span>
  );
}

/** Round icon-only button (with an accessible label). */
export function IconButton({
  icon: I,
  label,
  onClick,
  tone = "plain",
  className,
  disabled,
  pressed,
}: {
  icon: Icon;
  label: string;
  onClick?: () => void;
  tone?: "plain" | "soft" | "dark";
  className?: string;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:opacity-40",
        tone === "plain" && "text-slate-800 hover:bg-slate-200/60 active:bg-slate-200",
        tone === "soft" && "bg-blue-50 text-blue-700 hover:bg-blue-100",
        tone === "dark" && "bg-black/45 text-white backdrop-blur hover:bg-black/60",
        pressed && "bg-blue-600 text-white hover:bg-blue-700",
        className,
      )}
    >
      <I className="size-5" aria-hidden />
    </button>
  );
}

/** Icon in a circle with a short label underneath — the app's labelled secondary action. */
export function IconAction({
  icon: I,
  label,
  onClick,
  disabled,
  active,
  tone = "light",
  className,
}: {
  icon: Icon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "group flex min-w-16 max-w-24 flex-col items-center gap-1 rounded-xl p-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:opacity-40",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-full transition-colors",
          tone === "light" && (active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800 group-hover:bg-slate-200"),
          tone === "dark" && (active ? "bg-white text-slate-900" : "bg-white/15 text-white group-hover:bg-white/25"),
        )}
      >
        <I className="size-5" aria-hidden />
      </span>
      <span className={cn("text-center text-xs font-medium leading-tight", tone === "dark" ? "text-white" : "text-slate-700")}>{label}</span>
    </button>
  );
}

const CHIP_TONES = {
  neutral: "bg-slate-100 text-slate-700",
  blue: "bg-blue-50 text-blue-800",
  green: "bg-green-50 text-green-800",
  amber: "bg-amber-50 text-amber-900",
  red: "bg-red-50 text-red-800",
};

export function Chip({ tone = "neutral", icon: I, children, className }: { tone?: keyof typeof CHIP_TONES; icon?: Icon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", CHIP_TONES[tone], className)}>
      {I && <I className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}

/** Grouped list container (iOS-style inset group). */
export function ListGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm", className)}>{children}</div>;
}

/**
 * One row: label above a bold value; optional `lead` (or `icon`) on the left and a right slot;
 * tappable when onClick is set. `quiet` tints a non-tappable row (e.g. "you do this by hand").
 */
export function ListRow({
  label,
  value,
  sub,
  icon: I,
  lead,
  right,
  onClick,
  muted,
  quiet,
}: {
  label?: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: Icon;
  lead?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  muted?: boolean;
  quiet?: boolean;
}) {
  const body = (
    <>
      {lead ??
        (I && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
            <I className="size-4" aria-hidden />
          </span>
        ))}
      <span className="min-w-0 flex-1">
        {label && <span className="block break-words text-[13px] text-slate-500">{label}</span>}
        <span className={cn("block break-words text-[15px] font-medium", muted ? "font-normal italic text-slate-500" : "text-slate-900")}>{value}</span>
        {sub && <span className="mt-0.5 block text-[13px] text-slate-500">{sub}</span>}
      </span>
      {right}
      {onClick && <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />}
    </>
  );
  const cls = "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "hover:bg-slate-50 focus-visible:bg-blue-50 focus-visible:outline-none active:bg-slate-100")}>
      {body}
    </button>
  ) : (
    <div className={cn(cls, quiet && "bg-slate-50")}>{body}</div>
  );
}

/** Segmented control (two or three options). `lang` marks an option written in another language (e.g. "हिन्दी"). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; lang?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-xl bg-slate-200/60 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          lang={o.lang}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-9 rounded-[10px] px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
            value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Round speaker button: reads `text` aloud, tap again to stop. */
export function SpeakButton({ text, className, tone = "soft" }: { text: string; className?: string; tone?: "soft" | "dark" }) {
  const { speak, stopSpeaking, speaking, t } = useApp();
  return (
    <IconButton
      icon={speaking ? VolumeX : Volume2}
      label={speaking ? t("stopReading") : t("readAloud")}
      onClick={() => (speaking ? stopSpeaking() : void speak(text))}
      tone={tone}
      className={className}
    />
  );
}

// --- Feedback ----------------------------------------------------------------------------------

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "bg-blue-50 text-blue-950",
    warning: "bg-amber-50 text-amber-950",
    error: "bg-red-50 text-red-900",
    success: "bg-green-50 text-green-950",
  }[tone];
  const I = tone === "info" ? Info : tone === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-2.5 rounded-xl p-3 text-sm", styles)}>
      <I className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-base text-slate-700" role="status">
      <Loader2 className="size-5 animate-spin text-blue-600" aria-hidden />
      {label}
    </div>
  );
}

// --- Backwards-compatible names (older screens) -------------------------------------------------

export function TopBar({ onBack, right, title }: { onBack?: () => void; right?: ReactNode; title?: string }) {
  return <AppBar onBack={onBack} right={right} title={title} />;
}

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <Page className={className}>{children}</Page>;
}

export function ActionBar({ children }: { children: ReactNode }) {
  return <Dock>{children}</Dock>;
}

/** Read a block of text aloud / stop (icon + short label). */
export function ReadAloudButton({ text, className }: { text: string; className?: string }) {
  const { speak, stopSpeaking, speaking, t } = useApp();
  return (
    <button
      onClick={() => (speaking ? stopSpeaking() : void speak(text))}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full bg-blue-50 px-3 text-sm font-semibold text-blue-800 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
        className,
      )}
    >
      {speaking ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
      {speaking ? t("stopReading") : t("readAloud")}
    </button>
  );
}
