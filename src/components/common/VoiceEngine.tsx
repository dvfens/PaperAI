"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, Volume2 } from "lucide-react";
import { useApp } from "@/components/app/AppContext";
import { IconButton, Notice, Segmented, Spinner } from "@/components/common/Chrome";
import { api } from "@/lib/client/api";
import { MicError, type ListenSession } from "@/lib/client/recognition";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { SpeechProvider } from "@/lib/types";

const ENGINES: { value: SpeechProvider; label: string }[] = [
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "openai", label: "OpenAI" },
];
const NAME: Record<string, string> = { elevenlabs: "ElevenLabs", openai: "OpenAI", browser: "Browser" };

/**
 * Say one sentence; see exactly what the live engine heard, and what both engines make of the same
 * recording. Shows whether a problem is the engine or the microphone/room. Nothing is stored.
 */
function MicCheck() {
  const { t, input, lang, voice, stopSpeaking } = useApp();
  const [phase, setPhase] = useState<"idle" | "listening" | "checking" | "done">("idle");
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState("");
  const [heard, setHeard] = useState<{ label: string; text: string }[]>([]);
  const session = useRef<ListenSession | null>(null);
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false; // (re)mounted — React may mount twice in development
    return () => {
      closed.current = true; // the sheet was closed: no more uploads or updates
      session.current?.cancel();
    };
  }, []);

  const start = async () => {
    if (!input) return;
    stopSpeaking(); // never record the app's own voice
    setPhase("listening");
    setLive("");
    setHeard([]);
    const rec: { audio: Blob | null } = { audio: null };
    const s = input.listen({ lang, onPartial: setLive, onLevel: setLevel, onAudio: (a) => (rec.audio = a), via: "mic-check" });
    session.current = s;
    let text = "";
    try {
      text = await s.result;
    } catch (err) {
      // Say what went wrong instead of "nothing heard": a blocked microphone is not a quiet room.
      text = err instanceof MicError ? t("micUnavailable") : t("micCheckFailed");
    }
    session.current = null;
    if (closed.current) return;
    setLevel(0);
    const rows = [{ label: t("micCheckLive", { engine: NAME[input.kind] ?? input.kind }), text }];
    setHeard(rows);
    if (!rec.audio) return setPhase("done");
    setPhase("checking");
    const engines = (["elevenlabs", "openai"] as const).filter((p) => voice.available[p]);
    const texts = await Promise.all(
      engines.map((p) => api.stt(rec.audio!, lang, undefined, "mic-check", p).then((r) => r.text, () => t("micCheckFailed"))),
    );
    if (closed.current) return;
    setHeard([...rows, ...engines.map((p, i) => ({ label: t("micCheckFile", { engine: NAME[p] }), text: texts[i] }))]);
    setPhase("done");
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4">
      <p className="text-base font-bold text-slate-600">{t("micCheck")}</p>
      <p className="text-base text-slate-600">{t("micCheckHint")}</p>
      {phase === "listening" ? (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden>
            <div className="h-2 rounded-full bg-green-600 transition-[width]" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <p className="min-h-6 text-base italic text-blue-900" aria-live="polite">{live || t("micCheckListening")}</p>
          <Button size="md" block onClick={() => session.current?.stop()}>
            {t("micCheckDone")}
          </Button>
        </>
      ) : (
        <Button size="md" variant="secondary" block disabled={phase === "checking" || !input} onClick={() => void start()}>
          <Mic aria-hidden />
          {t("micCheckStart")}
        </Button>
      )}
      {heard.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {heard.map((h) => (
            <li key={h.label} className="rounded-xl bg-white px-3 py-2">
              <p className="text-base font-semibold text-slate-600">{h.label}</p>
              <p className="text-base text-slate-900">{h.text || t("micCheckNothing")}</p>
            </li>
          ))}
        </ul>
      )}
      {phase === "checking" && <Spinner label={t("micCheckChecking")} />}
    </div>
  );
}

/**
 * The voice-engine sheet: switch between the ElevenLabs and OpenAI speech engines (separately for
 * listening and for the speaking voice, when both are configured) and run the microphone check.
 * Used by the Menu (AppMenu) and by VoiceEngineButton on the camera screen.
 */
export function VoiceEngineSheet({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { t, voice, speak, stopSpeaking } = useApp();
  const both = voice.available.elevenlabs && voice.available.openai;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) stopSpeaking();
        onOpenChange(o);
      }}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t("voiceEngine")}
      description={t("voiceEngineSub")}
      closeLabel={t("close")}
    >
      <div className="flex flex-col gap-5">
        {both && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-base font-bold text-slate-600">{t("engineListen")}</p>
              <Segmented options={ENGINES} value={voice.stt} onChange={voice.setStt} label={t("engineListen")} />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-base font-bold text-slate-600">{t("engineVoice")}</p>
              <Segmented options={ENGINES} value={voice.tts} onChange={voice.setTts} label={t("engineVoice")} />
              {voice.tts === "openai" && <Notice tone="info">{t("engineSlowNote")}</Notice>}
            </div>
          </>
        )}
        {voice.available.elevenlabs && (voice.tts === "elevenlabs" || !voice.available.openai) && (
          <div className="flex flex-col gap-2">
            <p className="text-base font-bold text-slate-600">{t("voiceChoice")}</p>
            <Segmented
              options={[
                { value: "young-woman", label: t("voiceYoungWoman") },
                { value: "young-man", label: t("voiceYoungMan") },
                { value: "calm", label: t("voiceCalm") },
              ]}
              value={voice.style}
              onChange={voice.setStyle}
              label={t("voiceChoice")}
            />
          </div>
        )}
        {(both || voice.available.elevenlabs) && (
          <Button size="md" variant="secondary" block onClick={() => void speak(t("voiceSample"))}>
            <Volume2 aria-hidden />
            {t("hearSample")}
          </Button>
        )}
        <MicCheck />
      </div>
    </Dialog>
  );
}

/**
 * Icon button that opens the voice-engine sheet (camera screen). Only shown when at least one
 * server engine is configured. onOpenChange(true) fires on open, onOpenChange(false) on close.
 */
export function VoiceEngineButton({ tone = "plain", onOpenChange }: { tone?: "plain" | "dark"; onOpenChange?: (open: boolean) => void }) {
  const { t, voice } = useApp();
  const [open, setOpen] = useState(false);
  if (!voice.available.elevenlabs && !voice.available.openai) return null;

  return (
    <>
      <IconButton
        icon={AudioLines}
        label={t("voiceEngine")}
        tone={tone === "dark" ? "dark" : "plain"}
        onClick={() => {
          onOpenChange?.(true);
          setOpen(true);
        }}
      />
      <VoiceEngineSheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) onOpenChange?.(false);
        }}
      />
    </>
  );
}
