"use client";

import { useState } from "react";
import { AudioLines, Volume2 } from "lucide-react";
import { useApp } from "@/components/app/AppContext";
import { IconButton, Notice, Segmented } from "@/components/common/Chrome";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { SpeechProvider } from "@/lib/types";

const ENGINES: { value: SpeechProvider; label: string }[] = [
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "openai", label: "OpenAI" },
];

/**
 * Switch between the ElevenLabs and OpenAI speech engines, separately for listening and for the
 * speaking voice. Only shown when both are configured on the server.
 */
export function VoiceEngineButton({ tone = "plain", onOpenChange }: { tone?: "plain" | "dark"; onOpenChange?: (open: boolean) => void }) {
  const { t, voice, speak, stopSpeaking } = useApp();
  const [open, setOpen] = useState(false);
  if (!voice.available.elevenlabs || !voice.available.openai) return null;

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
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) stopSpeaking();
          setOpen(o);
          if (!o) onOpenChange?.(false);
        }}
        title={t("voiceEngine")}
        description={t("voiceEngineSub")}
        closeLabel={t("close")}
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t("engineListen")}</p>
            <Segmented options={ENGINES} value={voice.stt} onChange={voice.setStt} label={t("engineListen")} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t("engineVoice")}</p>
            <Segmented options={ENGINES} value={voice.tts} onChange={voice.setTts} label={t("engineVoice")} />
            {voice.tts === "openai" && <Notice tone="info">{t("engineSlowNote")}</Notice>}
          </div>
          <Button size="md" variant="secondary" block onClick={() => void speak(t("voiceSample"))}>
            <Volume2 aria-hidden />
            {t("hearSample")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
