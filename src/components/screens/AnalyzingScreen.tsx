"use client";

import { AlertTriangle, CheckCircle2, Circle, Loader2, RotateCcw, ScanLine, ScanText, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorKey } from "@/lib/client/api";
import { MAX_REQUEST_BYTES, pagesWithinBudget } from "@/lib/client/media";
import { initialState } from "@/lib/conversation/engine";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AppBar, AppScreen, Card, Dock, ListGroup, ListRow, Notice, Page } from "@/components/common/Chrome";
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
    // Stay under the host request-size limit (~4.5 MB). The summary sends page images only. The full
    // analysis sends the original PDF with its page images — but if they do not all fit, it sends the
    // PDF alone rather than dropping pages: the server then reads every page from the PDF itself.
    const pdfBytes = source.pdf?.size ?? 0;
    const summaryBlobs = pagesWithinBudget(source.pages).map((p) => p.blob);
    const withPdf = pagesWithinBudget(source.pages, pdfBytes);
    const allFit =
      withPdf.length === source.pages.length && pdfBytes + withPdf.reduce((n, p) => n + p.blob.size, 0) <= MAX_REQUEST_BYTES;
    const analyzeBlobs = source.pdf && !allFit ? [] : withPdf.map((p) => p.blob);
    let previewShown = false;

    // Stage 1: a quick "what is this" so the person hears an explanation within seconds.
    api
      .summary(lang, summaryBlobs)
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
      .analyze(lang, analyzeBlobs, source.pdf)
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

  const steps: { key: "read" | "understand"; label: StringKey; icon: typeof ScanText }[] = [
    { key: "read", label: "analyzingStepRead", icon: ScanText },
    { key: "understand", label: "analyzingStepUnderstand", icon: Sparkles },
  ];

  return (
    <AppScreen>
      <AppBar onBack={reset} back="close" />
      <Page dock={Boolean(error)} className="flex flex-col items-center pt-4">
        {/* Page thumbnail with a live status badge */}
        <Card className="relative w-fit p-3">
          {source ? (
            <DocumentPreview pages={source.pages} alt={t("original")} maxPages={1} className="w-36 sm:w-44" />
          ) : (
            <span className="flex h-48 w-36 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <ScanText className="size-12" aria-hidden />
            </span>
          )}
          <span
            className={cn(
              "absolute -bottom-3 -right-3 flex size-12 items-center justify-center rounded-full text-white shadow-md ring-4 ring-slate-50",
              error ? "bg-red-600" : "bg-blue-600",
            )}
            aria-hidden
          >
            {error ? <AlertTriangle className="size-6" /> : <Loader2 className="size-6 animate-spin" />}
          </span>
        </Card>

        <h1 className="mt-8 text-center text-xl font-bold text-slate-900">{t("reading")}</h1>

        {error ? (
          <div className="mt-6 w-full">
            <Notice tone="error">{t(error)}</Notice>
          </div>
        ) : (
          <div className="mt-6 w-full" aria-live="polite">
            <ListGroup>
              {steps.map((s) => {
                const done = phase === "understand" && s.key === "read";
                const active = phase === s.key;
                return (
                  <ListRow
                    key={s.key}
                    icon={s.icon}
                    value={<span className={done || active ? undefined : "font-normal text-slate-500"}>{t(s.label)}</span>}
                    right={
                      done ? (
                        <CheckCircle2 className="size-7 shrink-0 text-green-700" aria-hidden />
                      ) : active ? (
                        <Loader2 className="size-7 shrink-0 animate-spin text-blue-700" aria-hidden />
                      ) : (
                        <Circle className="size-7 shrink-0 text-slate-300" aria-hidden />
                      )
                    }
                  />
                );
              })}
            </ListGroup>
            {slow && <p className="mt-4 text-center text-base text-slate-500">{t("analyzingSlow")}</p>}
          </div>
        )}
      </Page>

      {error && (
        <Dock>
          <Button block size="lg" onClick={() => setAttempt((a) => a + 1)}>
            <RotateCcw aria-hidden /> {t("tryAgain")}
          </Button>
          <Button block size="md" variant="ghost" onClick={reset}>
            <ScanLine aria-hidden /> {t("scanAgain")}
          </Button>
        </Dock>
      )}
    </AppScreen>
  );
}
