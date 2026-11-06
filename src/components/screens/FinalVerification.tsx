"use client";

import { Download, Lock, Mic, PenLine, ShieldCheck, ThumbsUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorKey } from "@/lib/client/api";
import { downloadBlob, pagesWithinBudget, pdfToPages } from "@/lib/client/media";
import { detectYesNo } from "@/lib/conversation/rules";
import type { StringKey } from "@/lib/i18n";
import type { FormField, RetentionChoice } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionBar, Notice, ReadAloudButton, Screen, Spinner, TopBar } from "@/components/common/Chrome";
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
    const text = await listen.listen();
    if (!text) return;
    const yn = detectYesNo(text);
    if (yn === "yes") {
      setSaidYes(true);
      setConsentOpen(true);
    } else if (yn === "no") go("review");
  };

  return (
    <>
      <TopBar onBack={() => go("review")} />
      <Screen>
        <h1 className="text-3xl font-bold text-slate-900">{t("finalTitle")}</h1>

        {!generated && !error && (
          <div className="mt-6">
            <Spinner label={t("generating")} />
          </div>
        )}
        {error && (
          <div className="mt-6 flex flex-col gap-3">
            <Notice tone="error">{t(error)}</Notice>
            <Button
              block
              onClick={() => {
                started.current = false;
                setError(null);
                update({ generated: null });
              }}
            >
              {t("tryAgain")}
            </Button>
          </div>
        )}

        {generated && (
          <>
            <div role="tablist" className="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
              {(["completed", "original"] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cn(
                    "min-h-12 rounded-xl text-lg font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
                    tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-700",
                  )}
                >
                  {t(k)}
                </button>
              ))}
            </div>
            <div className="mt-4">
              {tab === "completed" ? (
                <DocumentPreview pages={generated.pages} highlights={highlights} alt={t("completed")} />
              ) : (
                <DocumentPreview pages={source.pages} alt={t("original")} />
              )}
            </div>

            {missing.length > 0 && (
              <section className="mt-6">
                <Notice tone="warning">
                  <p className="font-semibold">{t("missingInfo")}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {missing.map((f) => (
                      <li key={f.id}>{f.labelLocalized}</li>
                    ))}
                  </ul>
                </Notice>
              </section>
            )}

            <section className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-bold text-slate-900">{t("approvedFields")}</h2>
                <ReadAloudButton text={readback} />
              </div>
              <dl className="mt-3 divide-y divide-slate-100 rounded-2xl border-2 border-slate-200">
                {filled.map((f: FormField) => (
                  <div key={f.id} className="flex flex-col gap-0.5 p-3 sm:flex-row sm:justify-between sm:gap-4">
                    <dt className="text-lg text-slate-700">{f.labelLocalized}</dt>
                    <dd className="break-words text-right text-xl font-semibold text-slate-900">
                      {displayValue(f, conv.answers[f.id], t)}
                      {spokenValue(f, conv.answers[f.id]) && (
                        <span className="block text-lg font-normal text-slate-600">{spokenValue(f, conv.answers[f.id])}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <ActionBar>
              <p className="text-center text-xl font-semibold text-slate-900">{t("readbackAsk")}</p>
              <Button block variant="success" onClick={() => setConsentOpen(true)}>
                <ThumbsUp aria-hidden /> {t("yesCorrect")}
              </Button>
              <Button block variant="secondary" onClick={() => go("review")}>
                <PenLine aria-hidden /> {t("noChange")}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                {listen.supported && (
                  <Button variant="ghost" size="sm" onClick={sayYesNo}>
                    <Mic aria-hidden /> {listen.state === "listening" ? t("listening") : `${t("yes")} / ${t("no")}`}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => downloadBlob(generated.blob, "completed-form.pdf")}>
                  <Download aria-hidden /> {t("downloadPdf")}
                </Button>
              </div>
            </ActionBar>
          </>
        )}
      </Screen>

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
    </>
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
    <Dialog open={open} onOpenChange={onOpenChange} title={t("consentTitle")} closeLabel={t("close")}>
      <div className="flex flex-col gap-4">
        <p className="text-xl text-slate-800">{t("consentBody")}</p>
        <p className="flex gap-2 rounded-2xl bg-blue-50 p-3 text-lg text-blue-950">
          <Lock className="mt-1 size-5 shrink-0" aria-hidden /> {t("consentPublic")}
        </p>
        <fieldset>
          <legend className="text-lg font-semibold text-slate-900">{t("keepFor")}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {options.map((o) => (
              <button
                key={o.days}
                type="button"
                role="radio"
                aria-checked={retention === o.days}
                onClick={() => setRetention(o.days)}
                className={cn(
                  "min-h-14 rounded-2xl border-2 text-lg font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
                  retention === o.days ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-900",
                )}
              >
                {t(o.label)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-slate-200 p-4">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 size-7 shrink-0 accent-blue-700" />
          <span className="text-lg text-slate-900">{t("consentAgree")}</span>
        </label>
        {error && <Notice tone="error">{t(error)}</Notice>}
        <Button block disabled={!agree || saving} onClick={save}>
          <ShieldCheck aria-hidden /> {saving ? t("saving") : t("saveProtect")}
        </Button>
        <Button
          block
          variant="secondary"
          disabled={saving}
          onClick={() => {
            downloadBlob(generated.blob, "completed-form.pdf");
            onDone(null);
          }}
        >
          <Download aria-hidden /> {t("downloadOnly")}
        </Button>
      </div>
    </Dialog>
  );
}
