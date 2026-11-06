"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorKey } from "@/lib/client/api";
import { initialState } from "@/lib/conversation/engine";
import { Button } from "@/components/ui/button";
import { Notice, Screen, TopBar } from "@/components/common/Chrome";
import { DocumentPreview } from "@/components/DocumentPreview";
import { useApp } from "@/components/app/AppContext";
import type { StringKey } from "@/lib/i18n";

/** Screen 2a — OCR + understanding in progress. */
export function AnalyzingScreen() {
  const { state, update, goFrom, reset, lang, t } = useApp();
  const [phase, setPhase] = useState<"read" | "understand">("read");
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);
  const source = state.source;

  useEffect(() => {
    if (!source || started.current === attempt) return;
    started.current = attempt;
    setError(null);
    setPhase("read");
    const toUnderstand = setTimeout(() => setPhase("understand"), 4000);
    const toSlow = setTimeout(() => setSlow(true), 15000);
    const blobs = source.pages.map((p) => p.blob);
    let previewShown = false;

    // Stage 1: a quick "what is this" so the person hears an explanation within seconds.
    api
      .summary(lang, blobs)
      .then((s) => {
        if (!s.available) return;
        const { available: _a, ...preview } = s;
        previewShown = true;
        update({ preview });
        goFrom("analyzing", "understood");
      })
      .catch(() => undefined);

    // Stage 2: full understanding — fields, placement, instructions. Continues in the background.
    api
      .analyze(lang, blobs, source.pdf)
      .then((analysis) => {
        update({ analysis, analysisError: null, conversation: initialState(lang, analysis.fields) });
        goFrom("analyzing", "understood");
      })
      .catch((err) => {
        if (previewShown) update({ analysisError: errorKey(err) });
        else setError(errorKey(err));
      })
      .finally(() => {
        clearTimeout(toUnderstand);
        clearTimeout(toSlow);
      });
    // Timers only update display state; they are cleared when the requests settle.
  }, [source, attempt, lang, update, goFrom]);

  const steps: { key: "read" | "understand"; label: StringKey }[] = [
    { key: "read", label: "analyzingStepRead" },
    { key: "understand", label: "analyzingStepUnderstand" },
  ];

  return (
    <>
      <TopBar onBack={reset} />
      <Screen>
        <h1 className="text-3xl font-bold text-slate-900">{t("analyzingTitle")}</h1>
        {source && <DocumentPreview pages={source.pages} alt={t("original")} maxPages={1} className="mx-auto mt-5 max-w-56" />}
        <ol className="mt-6 flex flex-col gap-4" aria-live="polite">
          {steps.map((s) => {
            const done = phase === "understand" && s.key === "read";
            const active = phase === s.key && !error;
            return (
              <li key={s.key} className="flex items-center gap-3 text-xl">
                {done ? (
                  <CheckCircle2 className="size-8 text-green-700" aria-hidden />
                ) : active ? (
                  <Loader2 className="size-8 animate-spin text-blue-700" aria-hidden />
                ) : (
                  <span className="size-8 rounded-full border-2 border-slate-300" aria-hidden />
                )}
                <span className={active ? "font-semibold text-slate-900" : "text-slate-600"}>{t(s.label)}</span>
              </li>
            );
          })}
        </ol>
        {slow && !error && <p className="mt-6 text-lg text-slate-700">{t("analyzingSlow")}</p>}
        {error && (
          <div className="mt-6 flex flex-col gap-3">
            <Notice tone="error">{t(error)}</Notice>
            <Button block onClick={() => setAttempt((a) => a + 1)}>
              {t("tryAgain")}
            </Button>
            <Button block variant="secondary" onClick={reset}>
              {t("scanAgain")}
            </Button>
          </div>
        )}
      </Screen>
    </>
  );
}
