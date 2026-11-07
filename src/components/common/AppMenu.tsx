"use client";

import { AudioLines, ChevronRight, EllipsisVertical, SmartphoneNfc, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useApp } from "@/components/app/AppContext";
import { useOpenFromCard } from "@/components/nfc/NfcCard";
import { Dialog } from "@/components/ui/dialog";
import { ENABLED_LANGUAGES, type LanguageCode } from "@/lib/i18n/languages";
import { cn } from "@/lib/utils";
import { ListGroup, Segmented } from "./Chrome";
import { VoiceEngineSheet } from "./VoiceEngine";

/** `leaves`: onSelect goes to another screen, so focus is not sent back to the Menu button. */
export type MenuAction = { id: string; icon: LucideIcon; label: string; onSelect: () => void; leaves?: boolean };
export type MenuSwitch = { id: string; icon: LucideIcon; label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void };

/** One tappable row in the Menu sheet: icon, label and a chevron. */
export function MenuRow({ icon: I, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 focus-visible:bg-blue-50 focus-visible:outline-none active:bg-slate-100"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
        <I className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 break-words text-[15px] font-medium text-slate-900">{label}</span>
      <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
    </button>
  );
}

/** An On/Off setting row (role="switch" with a visible On/Off word). Tapping it does not close the sheet. */
export function SwitchRow({ icon: I, label, sub, checked, onChange }: Omit<MenuSwitch, "id">) {
  const { t } = useApp();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 focus-visible:bg-blue-50 focus-visible:outline-none active:bg-slate-100"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
        <I className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-slate-900">{label}</span>
        {sub && <span className="block text-[13px] text-slate-500">{sub}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2" aria-hidden>
        <span className="text-[13px] font-medium text-slate-500">{checked ? t("on") : t("off")}</span>
        <span className={cn("relative h-7 w-12 rounded-full transition-colors", checked ? "bg-blue-600" : "bg-slate-300")}>
          <span className={cn("absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform", checked && "translate-x-5")} />
        </span>
      </span>
    </button>
  );
}

/**
 * Labelled overflow menu: the screen's actions, Language, then settings (plus Voice engine when configured).
 * onOpenChange(true) fires when the menu OR the voice-engine sheet opens; onOpenChange(false) fires only when
 * both are closed. An action's onSelect runs BEFORE the sheet closes, and going from the menu to the
 * voice-engine sheet never passes through "closed". When both are closed, focus goes back to the Menu
 * button (unless the chosen action left the screen).
 */
export function AppMenu({
  actions = [],
  switches = [],
  onOpenChange,
}: {
  actions?: MenuAction[];
  switches?: MenuSwitch[];
  onOpenChange?: (open: boolean) => void;
}) {
  const { t, lang, setLang, voice } = useApp();
  const [sheet, setSheetState] = useState<null | "menu" | "engine">(null);
  const openRef = useRef(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  // Set by an action that goes to another screen: focus must not be sent back to this screen's pill.
  const leaving = useRef(false);
  const setSheet = (next: null | "menu" | "engine") => {
    setSheetState(next);
    const open = next !== null;
    if (open !== openRef.current) {
      openRef.current = open;
      if (open) leaving.current = false;
      onOpenChange?.(open);
    }
  };
  const hasEngine = voice.available.elevenlabs || voice.available.openai;
  const openCard = useOpenFromCard((event) => {
    event.preventDefault();
    pillRef.current?.focus();
  });

  // The pill is not a Radix trigger, so Radix cannot put focus back on it: do it here, once both
  // sheets are closed (not when the menu hands over to the voice-engine sheet, and not when an
  // action has left the screen).
  const returnFocus = (event: Event) => {
    event.preventDefault();
    if (openRef.current || leaving.current) return;
    pillRef.current?.focus();
  };

  return (
    <>
      <button
        ref={pillRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={sheet === "menu"}
        onClick={() => setSheet("menu")}
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-slate-200/70 pl-2 pr-3 text-sm font-semibold text-slate-800 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
      >
        <EllipsisVertical className="size-4" aria-hidden />
        {t("menu")}
      </button>
      <Dialog
        open={sheet === "menu"}
        onOpenChange={(o) => setSheet(o ? "menu" : null)}
        onCloseAutoFocus={returnFocus}
        title={t("menu")}
        closeLabel={t("close")}
      >
        <div className="flex flex-col gap-4 pb-2">
          {(actions.length > 0 || openCard.supported) && (
            <ListGroup>
              {actions.map((a) => (
                <MenuRow
                  key={a.id}
                  icon={a.icon}
                  label={a.label}
                  onClick={() => {
                    if (a.leaves) leaving.current = true;
                    a.onSelect();
                    setSheet(null);
                  }}
                />
              ))}
              {/* Opens its own sheet, which puts focus back on the Menu button when it closes. */}
              {openCard.supported && (
                <MenuRow
                  icon={SmartphoneNfc}
                  label={t("nfcOpen")}
                  onClick={() => {
                    leaving.current = true;
                    void openCard.start();
                    setSheet(null);
                  }}
                />
              )}
            </ListGroup>
          )}
          <div className="flex flex-col gap-2">
            <p className="px-1 text-[13px] font-semibold text-slate-500">{t("language")}</p>
            <Segmented<LanguageCode>
              label={t("language")}
              value={lang}
              onChange={setLang}
              options={ENABLED_LANGUAGES.map((l) => ({ value: l.code, label: l.nativeName, lang: l.code }))}
            />
          </div>
          {(switches.length > 0 || hasEngine) && (
            <ListGroup>
              {switches.map(({ id, ...s }) => (
                <SwitchRow key={id} {...s} />
              ))}
              {hasEngine && <MenuRow icon={AudioLines} label={t("voiceEngine")} onClick={() => setSheet("engine")} />}
            </ListGroup>
          )}
        </div>
      </Dialog>
      {openCard.sheet}
      {hasEngine && (
        <VoiceEngineSheet open={sheet === "engine"} onOpenChange={(o) => setSheet(o ? "engine" : null)} onCloseAutoFocus={returnFocus} />
      )}
    </>
  );
}
