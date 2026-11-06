"use client";

import { AlertTriangle, Camera, CheckCircle2, CircleDashed, FileCheck2, MessageSquareMore, Mic, PenLine, Signature } from "lucide-react";
import { useState } from "react";
import { nextOpenField, setAnswerManually } from "@/lib/conversation/engine";
import { normaliseAnswer } from "@/lib/conversation/rules";
import type { FieldAnswer, FormField } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionBar, Notice, Screen, TopBar } from "@/components/common/Chrome";
import { useListen } from "@/components/common/useListen";
import { useApp } from "@/components/app/AppContext";

/** What will be printed on the form (e.g. "RAM KUMAR SHARMA", "13/03/1960"). */
export function displayValue(field: FormField, answer: FieldAnswer | undefined, t: ReturnType<typeof useApp>["t"]) {
  if (!answer || answer.status === "skipped" || answer.status === "unknown" || !answer.value) return null;
  if (field.type === "checkbox") return answer.value === "true" ? t("checked") : t("notChecked");
  return answer.value;
}

/** The natural spoken form, shown under the printed value when it differs (e.g. "राम कुमार शर्मा"). */
export function spokenValue(field: FormField, answer: FieldAnswer | undefined): string | null {
  if (!answer || field.type === "checkbox" || !answer.display || !answer.value) return null;
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  return norm(answer.display) === norm(answer.value) ? null : answer.display;
}

export function isFilled(answer: FieldAnswer | undefined) {
  return Boolean(answer && (answer.status === "answered" || answer.status === "confirmed") && answer.value);
}

/** Screen 4 — every answer, its status, and manual correction. */
export function FormReview() {
  const { state, update, go, t, lang } = useApp();
  const analysis = state.analysis!;
  const conv = state.conversation!;
  const [editing, setEditing] = useState<FormField | null>(null);

  const missingRequired = analysis.fields.filter((f) => f.aiFillable && f.required && !isFilled(conv.answers[f.id]));
  const unanswered = analysis.fields.filter((f) => f.aiFillable && !isFilled(conv.answers[f.id]));

  const answerMissing = () => {
    // Forget skipped / "don't know" answers so those questions are asked again.
    const answers = Object.fromEntries(Object.entries(conv.answers).filter(([, a]) => isFilled(a)));
    const base = { ...conv, answers, pending: null, returnToFieldId: null, misses: 0 };
    const first = nextOpenField(base, analysis.fields);
    update({ conversation: { ...base, phase: first ? "asking" : "complete", currentFieldId: first?.id ?? null } });
    go("conversation");
  };

  const save = (field: FormField, value: string, display: string) => {
    update({ conversation: setAnswerManually(conv, field, value, display) });
    setEditing(null);
  };

  return (
    <>
      <TopBar onBack={() => go("conversation")} />
      <Screen>
        <h1 className="text-3xl font-bold text-slate-900">{t("reviewTitle")}</h1>
        <p className="mt-1 text-lg text-slate-700">{t("reviewHint")}</p>

        {missingRequired.length > 0 && (
          <div className="mt-4">
            <Notice tone="warning">{t("requiredMissing", { n: missingRequired.length })}</Notice>
          </div>
        )}

        <ul className="mt-5 flex flex-col gap-3">
          {analysis.fields.map((f) => {
            const a = conv.answers[f.id];
            const value = displayValue(f, a, t);
            const byHand = !f.aiFillable;
            const status = byHand
              ? { label: t(f.type === "photo" ? "statusPhoto" : "statusByHand"), cls: "bg-blue-50 text-blue-900", Icon: f.type === "photo" ? Camera : Signature }
              : !value
                ? a?.status === "skipped"
                  ? { label: t("statusSkipped"), cls: "bg-slate-100 text-slate-800", Icon: CircleDashed }
                  : { label: t("statusMissing"), cls: f.required ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-800", Icon: CircleDashed }
                : f.mappingConfidence === "low"
                  ? { label: t("statusCheck"), cls: "bg-amber-50 text-amber-900", Icon: AlertTriangle }
                  : a?.status === "confirmed"
                    ? { label: t("statusConfirmed"), cls: "bg-green-50 text-green-900", Icon: CheckCircle2 }
                    : { label: t("statusAnswered"), cls: "bg-green-50 text-green-900", Icon: CheckCircle2 };
            return (
              <li key={f.id}>
                <button
                  disabled={byHand}
                  onClick={() => setEditing(f)}
                  className="flex w-full flex-col gap-2 rounded-2xl border-2 border-slate-200 bg-white p-4 text-left hover:border-blue-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:cursor-default disabled:hover:border-slate-200"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="text-lg font-semibold text-slate-900">
                        {f.labelLocalized}
                        {f.required && <span className="text-red-700"> *</span>}
                      </p>
                      {f.labelLocalized !== f.label && <p className="text-base text-slate-500">{f.label}</p>}
                      {f.group && <p className="text-base text-slate-500">{f.group}</p>}
                    </div>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold", status.cls)}>
                      <status.Icon className="size-4" aria-hidden /> {status.label}
                    </span>
                  </div>
                  {!byHand && (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className={cn("break-words text-xl", value ? "font-semibold text-slate-900" : "italic text-slate-500")}>{value ?? t("emptyValue")}</p>
                        {spokenValue(f, a) && <p className="break-words text-lg text-slate-600">{spokenValue(f, a)}</p>}
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 text-lg font-semibold text-blue-800">
                        <PenLine className="size-5" aria-hidden /> {t("change")}
                      </span>
                    </div>
                  )}
                  {!byHand && value && f.mappingConfidence === "low" && <p className="text-base text-amber-900">{t("uncertainPlacement")}</p>}
                </button>
              </li>
            );
          })}
        </ul>

        <ActionBar>
          {unanswered.length > 0 && (
            <Button block variant="secondary" onClick={answerMissing}>
              <MessageSquareMore aria-hidden /> {t("answerMissing")}
            </Button>
          )}
          <Button block onClick={() => go("final")}>
            <FileCheck2 aria-hidden /> {t("makeDocument")}
          </Button>
        </ActionBar>
      </Screen>

      {editing && (
        <EditAnswerDialog
          key={editing.id}
          field={editing}
          answer={conv.answers[editing.id]}
          onClose={() => setEditing(null)}
          onSave={(v, d) => save(editing, v, d)}
          lang={lang}
        />
      )}
    </>
  );
}

function EditAnswerDialog({
  field,
  answer,
  onClose,
  onSave,
  lang,
}: {
  field: FormField;
  answer: FieldAnswer | undefined;
  onClose: () => void;
  onSave: (value: string, display: string) => void;
  lang: ReturnType<typeof useApp>["lang"];
}) {
  const { t } = useApp();
  const listen = useListen();
  const [value, setValue] = useState(isFilled(answer) ? (answer!.display || answer!.value) : "");
  const [problem, setProblem] = useState<string | null>(null);

  const commit = (raw: string) => {
    if (!raw.trim()) return onSave("", "");
    const n = normaliseAnswer(field, raw, lang);
    if (!n.valid || !n.value) {
      setProblem(n.problem);
      return;
    }
    onSave(n.value, n.display ?? n.value);
  };

  const speakAnswer = async () => {
    if (listen.state === "listening") return listen.stop();
    const text = await listen.listen();
    if (text) setValue(text);
  };

  const choiceButtons =
    field.type === "checkbox"
      ? [
          { label: t("yes"), raw: t("yes") },
          { label: t("no"), raw: t("no") },
        ]
      : field.type === "choice"
        ? (field.options ?? []).map((o) => ({ label: o, raw: o }))
        : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t("changeTitle")} description={field.labelLocalized} closeLabel={t("close")}>
      {choiceButtons ? (
        <div className="flex flex-col gap-3">
          {choiceButtons.map((c) => (
            <Button key={c.label} block variant="secondary" onClick={() => commit(c.raw)}>
              {c.label}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            commit(value);
          }}
        >
          {field.type === "multiline" ? (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={4}
              className="rounded-2xl border-2 border-slate-300 p-4 text-xl focus:border-blue-600 focus:outline-none"
              aria-label={field.labelLocalized}
            />
          ) : (
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode={field.type === "phone" || field.type === "number" ? "numeric" : field.type === "email" ? "email" : "text"}
              className="min-h-16 rounded-2xl border-2 border-slate-300 px-4 text-xl focus:border-blue-600 focus:outline-none"
              aria-label={field.labelLocalized}
              autoFocus
            />
          )}
          {field.hint && <p className="text-lg text-slate-700">{field.hint}</p>}
          {problem && <Notice tone="warning">{problem}</Notice>}
          {listen.supported && (
            <Button type="button" block variant="secondary" onClick={speakAnswer}>
              <Mic aria-hidden /> {listen.state === "listening" ? t("listening") : t("speakAnswer")}
            </Button>
          )}
          <Button type="submit" block>
            {t("save")}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
