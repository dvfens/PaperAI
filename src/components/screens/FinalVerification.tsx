"use client";

import { AlertTriangle, ChevronDown, Download, ListChecks, Mic, PenLine, RotateCcw, ShieldCheck, ThumbsUp } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, errorKey } from "@/lib/client/api";
import { downloadBlob, pagesWithinBudget, pdfToPages } from "@/lib/client/media";
import { detectYesNo } from "@/lib/conversation/rules";
import type { StringKey } from "@/lib/i18n";
import type { RetentionChoice } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AppBar, AppScreen, Card, Chip, Dock, IconAction, ListRow, Notice, Page, Segmented, SpeakButton, Spinner } from "@/components/common/Chrome";
import { useListen } from "@/components/common/useListen";
import { DocumentPreview, type Highlight } from "@/components/DocumentPreview";
import { useApp } from "@/components/app/AppContext";
import { displayValue, isFilled, spokenValue } from "./FormReview";

function masked(value: string, t: ReturnType<typeof useApp>["t"]) {
  const digits = value.replace(/\D/g, "");
  const last = (digits.length >= 4 ? digits : value.replace(/\s/g, "")).slice(-4);
  return t("masked", { last: last.split("").join(" ") });
}

/** Screen 5 — completed PDF, read-back of the important details and explicit approval. */
export function FinalVerification() {
  const { state, update, go, t, speak, lang } = useApp();
  const analysis = state.analysis!;
  const conv = state.conversation!;
  const source = state.source!;
  const listen = useListen();
  const [error, setError] = useState<StringKey | null>(null);
  const [tab, setTab] = useState<"completed" | "original">("completed");
  const [consentOpen, setConsentOpen] = useState(false);
  const [saidYes, setSaidYes] = useState(false);
  const started = useRef(false);

  const filled = analysis.fields.filter((f) => f.aiFillable && isFilled(conv.answers[f.id]));
  const important = filled.filter((f) => f.confirm || f.required);
  const missing = analysis.fields.filter((f) => f.aiFillable && f.required && !isFilled(conv.answers[f.id]));
  const generated = state.generated;

  const readback = useMemo(() => {
    const parts = [t("readbackIntro")];
    for (const f of important.length ? important : filled) {
      const v = displayValue(f, conv.answers[f.id], t) ?? "";
      parts.push(`${f.labelLocalized}: ${f.sensitive ? masked(conv.answers[f.id].value, t) : v}.`);
    }
    if (missing.length) parts.push(`${t("missingInfo")}: ${missing.map((f) => f.labelLocalized).join(", ")}.`);
    parts.push(t("readbackAsk"));
    return parts.join(" ");
  }, [important, filled, missing, conv.answers, t]);

  // Generate the completed PDF, then read the important details back.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await api.generate(analysis.fields, conv.answers, {
          pdf: source.pdf,
          pages: pagesWithinBudget(source.pages).map((p) => p.blob),
        });
        const blob = new Blob([res.bytes], { type: "application/pdf" });
        const { pages } = await pdfToPages(res.bytes);
        update({ generated: { blob, sha256: res.sha256, token: res.token, pages, skipped: res.skipped } });
        void speak(readback);
      } catch (err) {
        setError(errorKey(err));
      }
    })();
  }, [analysis.fields, conv.answers, source, update, speak, readback]);

  const highlights: Highlight[] = [
    ...analysis.fields
      .filter((f) => (f.type === "signature" || f.type === "photo") && f.box)
      .map((f) => ({ box: f.box!, tone: "sign" as const, label: t(f.type === "photo" ? "statusPhoto" : "statusByHand") })),
    ...analysis.fields
      .filter((f) => f.aiFillable && f.box && isFilled(conv.answers[f.id]) && f.mappingConfidence === "low")
      .map((f) => ({ box: f.box!, tone: "warning" as const, label: t("statusCheck") })),
    ...missing.filter((f) => f.box).map((f) => ({ box: f.box!, tone: "missing" as const })),
  ];

  const sayYesNo = async () => {
    if (listen.state === "listening") return listen.stop();
    const text = await listen.listen({ kind: "yesno" }); // no options or question needed
    if (!text) return;
    const yn = detectYesNo(text);
    if (yn === "yes") {
      setSaidYes(true);
      setConsentOpen(true);
    } else if (yn === "no") go("review");
  };

  const listening = listen.state === "listening";

  return (
    <AppScreen>
      {/* "Check & approve" is cut off in the bar at 375px (both languages); "Final check" fits. */}
      <AppBar onBack={() => go("review")} title={t("finalTitle")} />
      <Page className={generated ? "pb-64" : undefined}>
        {!generated && !error && (
          <div className="flex min-h-[50dvh] items-center justify-center">
            <Spinner label={t("generating")} />
          </div>
        )}
        {error && (
          <div className="mt-6">
            <Notice tone="error">{t(error)}</Notice>
          </div>
        )}

        {generated && (
          <>
            {missing.length > 0 && (
              <section aria-label={t("missingInfo")} className="mb-4 rounded-3xl bg-amber-50 p-3">
                <p className="flex items-center gap-2 px-1 text-base font-bold text-amber-900">
                  <AlertTriangle className="size-5 shrink-0" aria-hidden /> {t("missingInfo")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {missing.map((f) => (
                    <Chip key={f.id} tone="amber" className="max-w-full rounded-2xl bg-white text-base">
                      <span className="min-w-0 break-words">{f.labelLocalized}</span>
                    </Chip>
                  ))}
                </div>
              </section>
            )}

            <Segmented
              label={`${t("completed")} / ${t("original")}`}
              value={tab}
              onChange={setTab}
              options={[
                { value: "completed", label: t("completed") },
                { value: "original", label: t("original") },
              ]}
            />

            <Card className="mt-4 p-2">
              {tab === "completed" ? (
                <DocumentPreview pages={generated.pages} highlights={highlights} alt={t("completed")} />
              ) : (
                <DocumentPreview pages={source.pages} alt={t("original")} />
              )}
            </Card>

            {/* Answers: collapsed by default; the speaker reads the important ones aloud. */}
            <div className="relative mt-6">
              <details className="group rounded-3xl border border-slate-200/80 bg-white shadow-sm">
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-3xl py-3 pr-[4.25rem] pl-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 [&::-webkit-details-marker]:hidden">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                    <ListChecks className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 text-lg font-semibold text-slate-900">{t("approvedFields")}</span>
                  <Chip className="text-base">{filled.length}</Chip>
                  <ChevronDown className="size-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {filled.map((f) => {
                    const spoken = spokenValue(f, conv.answers[f.id]);
                    return (
                      <ListRow
                        key={f.id}
                        label={<span className="whitespace-normal text-base">{f.labelLocalized}</span>}
                        value={displayValue(f, conv.answers[f.id], t)}
                        sub={spoken ? <span className="text-base text-slate-600">{spoken}</span> : undefined}
                      />
                    );
                  })}
                </div>
              </details>
              <div className="absolute top-2 right-2">
                <SpeakButton text={readback} />
              </div>
            </div>
          </>
        )}
      </Page>

      {error && (
        <Dock>
          <Button
            block
            onClick={() => {
              started.current = false;
              setError(null);
              update({ generated: null });
            }}
          >
            <RotateCcw aria-hidden /> {t("tryAgain")}
          </Button>
        </Dock>
      )}

      {generated && (
        <Dock>
          <p aria-live="polite" className={cn("text-center text-lg font-semibold", listening ? "text-red-700" : "text-slate-900")}>
            {listening ? t("listening") : t("readbackAsk")}
          </p>
          <Button block variant="success" onClick={() => setConsentOpen(true)}>
            <ThumbsUp aria-hidden /> {t("allCorrect")}
          </Button>
          <div className="flex items-start justify-around gap-2">
            <IconAction icon={PenLine} label={t("edit")} onClick={() => go("review")} />
            {listen.supported && <IconAction icon={Mic} label={`${t("yes")} / ${t("no")}`} active={listening} onClick={sayYesNo} />}
            <IconAction icon={Download} label={t("download")} onClick={() => downloadBlob(generated.blob, "completed-form.pdf")} />
          </div>
        </Dock>
      )}

      {generated && (
        <ConsentDialog
          open={consentOpen}
          onOpenChange={setConsentOpen}
          onDone={(receipt) => {
            update({ receipt, approvalMethod: saidYes ? "voice+tap" : "tap" });
            go("done");
          }}
          method={saidYes ? "voice+tap" : "tap"}
          lang={lang}
        />
      )}
    </AppScreen>
  );
}

function ConsentDialog({
  open,
  onOpenChange,
  onDone,
  method,
  lang,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (receipt: Awaited<ReturnType<typeof api.approve>> | null) => void;
  method: "voice+tap" | "tap";
  lang: ReturnType<typeof useApp>["lang"];
}) {
  const { state, t } = useApp();
  const [retention, setRetention] = useState<RetentionChoice>(30);
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const lineId = useId();
  const generated = state.generated!;
  const analysis = state.analysis!;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const receipt = await api.approve({
        pdf: generated.blob,
        token: generated.token,
        meta: {
          category: analysis.category,
          language: lang,
          pageCount: generated.pages.length,
          fieldCount: analysis.fields.length,
        },
        retentionDays: retention,
        method,
      });
      onDone(receipt);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setSaving(false);
    }
  };

  const options: { days: RetentionChoice; label: StringKey }[] = [
    { days: 7, label: "keep7" },
    { days: 30, label: "keep30" },
    { days: 180, label: "keep180" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("consentShort")} closeLabel={t("close")}>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <p id={lineId} className="min-w-0 flex-1 pt-1 text-lg text-slate-700">
            {t("consentLine")}
          </p>
          <SpeakButton text={`${t("consentBody")} ${t("consentPublic")} ${t("consentAgree")}`} />
        </div>

        <div>
          <p className="mb-2 px-1 text-base font-semibold text-slate-600">{t("keepFor")}</p>
          <Segmented
            label={t("keepFor")}
            value={retention}
            onChange={setRetention}
            options={options.map((o) => ({ value: o.days, label: t(o.label) }))}
          />
        </div>

        <label className="flex min-h-14 cursor-pointer items-center gap-4 rounded-2xl border-2 border-slate-200 px-4 py-3 transition-colors has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-blue-300">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            aria-describedby={lineId}
            className="size-7 shrink-0 accent-blue-700 focus-visible:outline-none"
          />
          <span className="text-lg font-semibold text-slate-900">{t("agree")}</span>
        </label>

        {error && <Notice tone="error">{t(error)}</Notice>}

        <div className="flex flex-col gap-2">
          <Button block disabled={!agree || saving} onClick={save}>
            <ShieldCheck aria-hidden /> {saving ? t("saving") : t("saveShort")}
          </Button>
          <Button
            block
            size="md"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              downloadBlob(generated.blob, "completed-form.pdf");
              onDone(null);
            }}
          >
            <Download aria-hidden /> {t("downloadOnlyShort")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
