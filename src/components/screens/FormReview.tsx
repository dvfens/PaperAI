"use client";

import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleDashed,
  FileCheck2,
  Loader2,
  MessageSquareMore,
  Mic,
  Signature,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { nextOpenField, setAnswerManually } from "@/lib/conversation/engine";
import { normaliseAnswer } from "@/lib/conversation/rules";
import type { FieldAnswer, FormField } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AppBar, AppScreen, Chip, Dock, ListGroup, ListRow, Notice, Page, SectionTitle } from "@/components/common/Chrome";
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

type Status = { label: string; cls: string; Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> };

/** Round status mark on the right of each row: shape + colour + hidden text, never colour alone. */
function StatusMark({ status }: { status: Status }) {
  return (
    <span title={status.label} className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", status.cls)}>
      <status.Icon className="size-6" aria-hidden />
      <span className="sr-only">{status.label}</span>
    </span>
  );
}

/** Screen 4 — every answer, its status, and manual correction. */
export function FormReview() {
  const { state, update, go, t, lang } = useApp();
  const analysis = state.analysis!;
  const conv = state.conversation!;
  const [editing, setEditing] = useState<FormField | null>(null);

  const missingRequired = analysis.fields.filter((f) => f.aiFillable && f.required && !isFilled(conv.answers[f.id]));
  const unanswered = analysis.fields.filter((f) => f.aiFillable && !isFilled(conv.answers[f.id]));
  const fillable = analysis.fields.filter((f) => f.aiFillable);

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

  const statusOf = (f: FormField, a: FieldAnswer | undefined, value: string | null): Status => {
    if (!f.aiFillable)
      return f.type === "photo"
        ? { label: t("statusPhoto"), cls: "bg-blue-50 text-blue-800", Icon: Camera }
        : { label: t("statusByHand"), cls: "bg-blue-50 text-blue-800", Icon: Signature };
    if (!value) {
      if (a?.status === "skipped") return { label: t("statusSkipped"), cls: "bg-slate-100 text-slate-600", Icon: CircleDashed };
      return f.required
        ? { label: t("statusMissing"), cls: "bg-amber-100 text-amber-800", Icon: CircleAlert }
        : { label: t("statusMissing"), cls: "bg-slate-100 text-slate-600", Icon: CircleDashed };
    }
    if (f.mappingConfidence === "low") return { label: t("statusCheck"), cls: "bg-amber-100 text-amber-800", Icon: AlertTriangle };
    if (a?.status === "confirmed") return { label: t("statusConfirmed"), cls: "bg-green-100 text-green-800", Icon: CheckCircle2 };
    return { label: t("statusAnswered"), cls: "bg-green-100 text-green-800", Icon: CheckCircle2 };
  };

  // Keep the form's own order, but gather fields that share a group (e.g. "Family member 1").
  const sections: { group?: string; fields: FormField[] }[] = [];
  for (const f of analysis.fields) {
    const group = f.group || undefined;
    const section = sections.find((s) => s.group === group);
    if (section) section.fields.push(f);
    else sections.push({ group, fields: [f] });
  }

  return (
    <AppScreen>
      <AppBar onBack={() => go("conversation")} title={t("answersTitle")} />
      <Page>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="green" icon={CheckCircle2} className="text-base">
            {fillable.length - unanswered.length} / {fillable.length}
          </Chip>
          {unanswered.length > 0 && (
            <Chip
              tone={missingRequired.length > 0 ? "amber" : "neutral"}
              icon={missingRequired.length > 0 ? CircleAlert : CircleDashed}
              className="text-base"
            >
              {t("emptyCount", { n: unanswered.length })}
            </Chip>
          )}
        </div>
        <p className="mt-3 px-1 text-base text-slate-500">{t("reviewHint")}</p>

        {sections.map((section, i) => (
          <section key={section.group ?? `_${i}`}>
            {section.group ? <SectionTitle>{section.group}</SectionTitle> : <div className={i === 0 ? "mt-4" : "mt-6"} />}
            <ListGroup>
              {section.fields.map((f) => {
                const a = conv.answers[f.id];
                const value = displayValue(f, a, t);
                const byHand = !f.aiFillable;
                const spoken = byHand ? null : spokenValue(f, a);
                return (
                  <ListRow
                    key={f.id}
                    label={
                      <span className="whitespace-normal text-base">
                        {f.labelLocalized}
                        {f.required && <span className="text-red-700"> *</span>}
                      </span>
                    }
                    value={
                      byHand ? (
                        <span className="font-medium text-slate-700">{t(f.type === "photo" ? "statusPhoto" : "statusByHand")}</span>
                      ) : (
                        value ?? <span className="font-normal italic text-slate-500">{t("emptyValue")}</span>
                      )
                    }
                    sub={spoken ? <span className="text-base text-slate-600">{spoken}</span> : undefined}
                    right={<StatusMark status={statusOf(f, a, value)} />}
                    onClick={byHand ? undefined : () => setEditing(f)}
                  />
                );
              })}
            </ListGroup>
          </section>
        ))}
      </Page>

      <Dock>
        <Button block onClick={() => go("final")}>
          <FileCheck2 aria-hidden /> {t("makePdf")}
        </Button>
        {unanswered.length > 0 && (
          <Button block size="md" variant="ghost" onClick={answerMissing}>
            <MessageSquareMore aria-hidden /> {t("fillEmpty")}
          </Button>
        )}
      </Dock>

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
    </AppScreen>
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

  // Which option is the current answer (only used to mark it on screen).
  const current = isFilled(answer) ? answer!.value : null;
  const choiceButtons =
    field.type === "checkbox"
      ? [
          { label: t("yes"), raw: t("yes"), selected: current === "true" },
          { label: t("no"), raw: t("no"), selected: current === "false" },
        ]
      : field.type === "choice"
        ? (field.options ?? []).map((o) => ({ label: o, raw: o, selected: current === o }))
        : null;

  const listening = listen.state === "listening";
  const showPrinted = field.label !== field.labelLocalized;
  const uncertain = isFilled(answer) && field.mappingConfidence === "low";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t("changeTitle")} description={field.labelLocalized} closeLabel={t("close")}>
      <div className="flex flex-col gap-4">
        {showPrinted && (
          <div className="-mt-2">
            <Chip className="max-w-full rounded-2xl text-base">
              <span className="min-w-0 break-words">{field.label}</span>
            </Chip>
          </div>
        )}
        {uncertain && <Notice tone="warning">{t("uncertainPlacement")}</Notice>}

        {choiceButtons ? (
          <div role="group" aria-label={field.labelLocalized} className="flex flex-col gap-3">
            {choiceButtons.map((c) => (
              <button
                key={c.label}
                type="button"
                aria-pressed={c.selected}
                onClick={() => commit(c.raw)}
                className={cn(
                  "flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border-2 px-5 py-3 text-left text-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
                  c.selected ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-900 hover:border-blue-300 active:bg-slate-50",
                )}
              >
                <span className="min-w-0 break-words">{c.label}</span>
                {c.selected ? (
                  <CheckCircle2 className="size-7 shrink-0 text-blue-700" aria-hidden />
                ) : (
                  <Circle className="size-7 shrink-0 text-slate-300" aria-hidden />
                )}
              </button>
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
            <div className="flex items-end gap-2">
              {field.type === "multiline" ? (
                <textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  rows={4}
                  className="min-w-0 flex-1 rounded-2xl border-2 border-slate-300 bg-slate-50 p-4 text-lg focus:border-blue-600 focus:bg-white focus:outline-none"
                  aria-label={field.labelLocalized}
                />
              ) : (
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode={field.type === "phone" || field.type === "number" ? "numeric" : field.type === "email" ? "email" : "text"}
                  className="min-h-14 min-w-0 flex-1 rounded-2xl border-2 border-slate-300 bg-slate-50 px-4 text-lg focus:border-blue-600 focus:bg-white focus:outline-none"
                  aria-label={field.labelLocalized}
                  autoFocus
                />
              )}
              {listen.supported && (
                <button
                  type="button"
                  onClick={speakAnswer}
                  aria-label={listening ? t("listening") : t("speakAnswer")}
                  aria-pressed={listening}
                  title={listening ? t("listening") : t("speakAnswer")}
                  className={cn(
                    "flex size-14 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
                    listening ? "bg-red-600 text-white hover:bg-red-700" : "bg-blue-50 text-blue-700 hover:bg-blue-100",
                  )}
                >
                  {listen.state === "processing" ? <Loader2 className="size-7 animate-spin" aria-hidden /> : <Mic className="size-7" aria-hidden />}
                </button>
              )}
            </div>
            <p aria-live="polite" className={cn("px-1 text-base", listening ? "font-semibold text-red-700" : "text-slate-500", !listening && !field.hint && "sr-only")}>
              {listening ? (listen.partial ? `“${listen.partial}”` : t("listening")) : field.hint}
            </p>
            {problem && <Notice tone="warning">{problem}</Notice>}
            <Button type="submit" block>
              <Check aria-hidden /> {t("save")}
            </Button>
          </form>
        )}
        {choiceButtons && problem && <Notice tone="warning">{problem}</Notice>}
      </div>
    </Dialog>
  );
}
