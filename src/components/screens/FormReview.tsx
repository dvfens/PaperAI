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
  PenLine,
  Signature,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { nextOpenField, setAnswerManually } from "@/lib/conversation/engine";
import { normaliseAnswer } from "@/lib/conversation/rules";
import type { FieldAnswer, FormField, PageImage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldSnippet } from "@/components/FieldSnippet";
import {
  AppBar,
  AppScreen,
  Card,
  Chip,
  Dock,
  ListGroup,
  ListRow,
  Notice,
  Page,
  ProgressBar,
  SectionTitle,
} from "@/components/common/Chrome";
import { AppMenu } from "@/components/common/AppMenu";
import { useListen } from "@/components/common/useListen";
import { useApp } from "@/components/app/AppContext";
import { compactHint } from "@/lib/speechHints";

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

/**
 * Round status dot leading each row: shape + colour. Hidden from screen readers: the row says its
 * status in words (visible for empty, by-hand and "Please check" rows; sr-only for answered ones).
 */
function StatusDot({ status }: { status: Status }) {
  return (
    <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", status.cls)}>
      <status.Icon className="size-4" />
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
  const filledCount = fillable.length - unanswered.length;

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
      if (f.required) return { label: t("statusMissing"), cls: "bg-amber-100 text-amber-800", Icon: CircleAlert };
      if (a?.status === "skipped") return { label: t("statusSkipped"), cls: "bg-slate-100 text-slate-600", Icon: CircleDashed };
      return { label: t("statusEmpty"), cls: "bg-slate-100 text-slate-600", Icon: CircleDashed };
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
      {/* When the conversation is complete, its mount bounces straight back here, so Back goes to the overview. */}
      <AppBar
        onBack={() => go(conv.phase === "complete" ? "understood" : "conversation")}
        title={t("answersTitle")}
        menu={<AppMenu />}
      />
      <Page className="pt-2">
        <Card className="flex flex-col gap-3">
          <p className="text-[17px] font-semibold text-slate-900">{t("answeredOf", { n: filledCount, total: fillable.length })}</p>
          <ProgressBar value={fillable.length ? filledCount / fillable.length : 0} />
          {missingRequired.length > 0 ? (
            <p className="flex items-start gap-2 text-sm font-semibold text-amber-800">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {missingRequired.length === 1 ? t("requiredMissingOne") : t("requiredMissing", { n: missingRequired.length })}
            </p>
          ) : unanswered.length > 0 ? (
            <p className="flex items-start gap-2 text-sm font-semibold text-slate-600">
              <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("emptyCount", { n: unanswered.length })}
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm font-semibold text-green-800">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("allAnswered")}
            </p>
          )}
          <p className="flex items-start gap-2 text-sm text-slate-700">
            <PenLine className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
            {t("reviewHint")}
          </p>
        </Card>

        {sections.map((section, i) => {
          const empty = section.fields.filter((f) => f.aiFillable && !isFilled(conv.answers[f.id]));
          const emptyRequired = empty.some((f) => f.required);
          return (
            <section key={section.group ?? `_${i}`}>
              {section.group ? (
                <SectionTitle
                  right={
                    empty.length > 0 ? <Chip tone={emptyRequired ? "amber" : "neutral"}>{t("emptyCount", { n: empty.length })}</Chip> : undefined
                  }
                >
                  {section.group}
                </SectionTitle>
              ) : (
                <div className={i === 0 ? "mt-3" : "mt-4"} />
              )}
              <ListGroup>
                {section.fields.map((f) => {
                  const a = conv.answers[f.id];
                  const value = displayValue(f, a, t);
                  const byHand = !f.aiFillable;
                  const spoken = byHand ? null : spokenValue(f, a);
                  const status = statusOf(f, a, value);
                  const lowConf = !byHand && Boolean(value) && f.mappingConfidence === "low";
                  return (
                    <ListRow
                      key={f.id}
                      lead={<StatusDot status={status} />}
                      label={f.labelLocalized}
                      value={
                        byHand ? (
                          <span className="text-[13px] font-medium text-blue-800">{status.label}</span>
                        ) : (
                          value ?? <span className={cn("text-[13px]", f.required ? "font-semibold text-amber-800" : "font-normal text-slate-500")}>{status.label}</span>
                        )
                      }
                      sub={
                        !value && f.required && !byHand ? (
                          <span className="text-amber-800">{t("neededOnForm")}</span>
                        ) : spoken || lowConf ? (
                          <>
                            {spoken && <span className="block">{spoken}</span>}
                            {lowConf && (
                              <span className="flex items-center gap-1.5 font-semibold text-amber-800">
                                <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                                {t("statusCheck")}
                              </span>
                            )}
                          </>
                        ) : undefined
                      }
                      // A filled row shows the value instead of the status word: say "Answered" / "Confirmed" to screen readers.
                      right={value && !byHand && !lowConf ? <span className="sr-only">{status.label}</span> : undefined}
                      onClick={byHand ? undefined : () => setEditing(f)}
                      quiet={byHand}
                    />
                  );
                })}
              </ListGroup>
            </section>
          );
        })}
      </Page>

      <Dock>
        {missingRequired.length > 0 ? (
          <>
            <Button block size="lg" onClick={answerMissing}>
              <MessageSquareMore aria-hidden /> {t("answerMissing")}
            </Button>
            <Button block size="md" variant="secondary" onClick={() => go("final")}>
              <FileCheck2 aria-hidden /> {t("makeDocument")}
            </Button>
          </>
        ) : (
          <>
            <Button block size="lg" onClick={() => go("final")}>
              <FileCheck2 aria-hidden /> {t("makeDocument")}
            </Button>
            {unanswered.length > 0 && (
              <Button block size="md" variant="secondary" onClick={answerMissing}>
                <MessageSquareMore aria-hidden /> {t("answerMissing")}
              </Button>
            )}
          </>
        )}
      </Dock>

      {editing && (
        <EditAnswerDialog
          key={editing.id}
          field={editing}
          answer={conv.answers[editing.id]}
          page={editing.box ? state.source?.pages[editing.box.page] : undefined}
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
  page,
  onClose,
  onSave,
  lang,
}: {
  field: FormField;
  answer: FieldAnswer | undefined;
  page?: PageImage;
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
    const text = await listen.listen(compactHint(field.type, field.options));
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
      <div className="flex flex-col gap-3">
        {showPrinted && <p className="-mt-1 break-words text-sm text-slate-600">{field.label}</p>}
        {page && field.box && (
          <FieldSnippet
            page={page}
            boxes={
              field.type === "choice" && field.optionBoxes
                ? Object.values(field.optionBoxes).filter((b) => b.page === field.box!.page)
                : [field.box]
            }
            caption={t(field.type === "choice" && field.optionBoxes ? "snippetAskChoice" : "snippetAsk")}
          />
        )}
        {uncertain && <Notice tone="warning">{t("uncertainPlacement")}</Notice>}

        {choiceButtons ? (
          <div role="group" aria-label={field.labelLocalized} className="flex flex-col gap-2">
            {choiceButtons.map((c) => (
              <button
                key={c.label}
                type="button"
                aria-pressed={c.selected}
                onClick={() => commit(c.raw)}
                className={cn(
                  "flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-2.5 text-left text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
                  c.selected ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-900 hover:border-blue-300 active:bg-slate-50",
                )}
              >
                <span className="min-w-0 break-words">{c.label}</span>
                {c.selected ? (
                  <CheckCircle2 className="size-5 shrink-0 text-blue-700" aria-hidden />
                ) : (
                  <Circle className="size-5 shrink-0 text-slate-300" aria-hidden />
                )}
              </button>
            ))}
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
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
                  className="min-w-0 flex-1 rounded-xl border-2 border-slate-300 bg-slate-50 px-3 py-2.5 text-base focus:border-blue-600 focus:bg-white focus:outline-none"
                  aria-label={field.labelLocalized}
                />
              ) : (
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode={field.type === "phone" || field.type === "number" ? "numeric" : field.type === "email" ? "email" : "text"}
                  className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-slate-300 bg-slate-50 px-3 text-base focus:border-blue-600 focus:bg-white focus:outline-none"
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
                    "flex size-12 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
                    listening ? "bg-red-600 text-white hover:bg-red-700" : "bg-blue-50 text-blue-700 hover:bg-blue-100",
                  )}
                >
                  {listen.state === "processing" ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Mic className="size-5" aria-hidden />}
                </button>
              )}
            </div>
            <p aria-live="polite" className={cn("px-1 text-sm", listening ? "font-semibold text-red-700" : "text-slate-500", !listening && !field.hint && "sr-only")}>
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
