"use client";

import {
  AlertTriangle,
  BookOpen,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronRight,
  FileText,
  Files,
  GraduationCap,
  HeartPulse,
  IdCard,
  Info,
  Keyboard,
  Landmark,
  ListChecks,
  ListOrdered,
  Loader2,
  MessageCircleQuestion,
  Mic,
  Paperclip,
  PenLine,
  PiggyBank,
  RotateCcw,
  Scale,
  ScanLine,
  Send,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { DocumentCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  AppBar,
  AppScreen,
  Card,
  Chip,
  Dock,
  ListGroup,
  ListRow,
  MetaLine,
  Notice,
  Page,
  ReadAloudButton,
  SectionTitle,
  SpeakButton,
  Spinner,
} from "@/components/common/Chrome";
import { AppMenu } from "@/components/common/AppMenu";
import { MicButton } from "@/components/common/MicButton";
import { useListen } from "@/components/common/useListen";
import { DocumentPreview } from "@/components/DocumentPreview";
import { useApp } from "@/components/app/AppContext";

const CATEGORY_ICONS: Record<DocumentCategory, LucideIcon> = {
  bank: Landmark,
  government: Building2,
  pension: PiggyBank,
  health: HeartPulse,
  education: GraduationCap,
  utility: Zap,
  insurance: ShieldCheck,
  employment: Briefcase,
  membership: IdCard,
  legal: Scale,
  other: FileText,
};

/** Compact tappable choice tile for the Dock: icon, short title, one small line. */
function ActionTile({
  icon: I,
  title,
  sub,
  onClick,
  primary,
  busy,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  onClick?: () => void;
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className={cn(
        "flex min-h-20 w-full items-center gap-3 rounded-3xl px-4 py-3 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:cursor-wait",
        primary
          ? "bg-blue-700 text-white hover:bg-blue-800 active:bg-blue-900 disabled:hover:bg-blue-700"
          : "border border-slate-200/80 bg-white text-slate-900 hover:border-blue-300 active:bg-slate-50",
      )}
    >
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-2xl",
          primary ? "bg-white/15 text-white" : "bg-blue-50 text-blue-700",
        )}
      >
        {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <I className="size-6" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-lg font-bold leading-tight">{title}</span>
        <span className={cn("mt-0.5 block break-words text-base", primary ? "text-blue-100" : "text-slate-600")}>{sub}</span>
      </span>
      {!busy && <ChevronRight className={cn("size-5 shrink-0", primary ? "text-white/80" : "text-slate-400")} aria-hidden />}
    </button>
  );
}

/** Screen 2b — "This appears to be …" with the two big choices. */
export function DocumentUnderstood() {
  const { state, go, reset, t, speak, update } = useApp();
  const analysis = state.analysis;
  // Keep showing what was already read aloud (stage 1), so the text does not change under the reader.
  const a = state.preview ?? analysis!;
  const pending = !analysis && !state.analysisError;
  const fillable = analysis ? analysis.fields.some((f) => f.aiFillable) : true;
  const spoken = useRef(false);
  const intro = `${t("understoodLead")} ${a.title}. ${a.summary}`;

  useEffect(() => {
    if (spoken.current) return;
    spoken.current = true;
    void speak(intro);
  }, [intro, speak]);

  const CategoryIcon = CATEGORY_ICONS[a.category] ?? FileText;
  const pageCount = state.source?.pageCount ?? analysis?.pageCount ?? 0;
  const questionCount = analysis ? analysis.fields.filter((f) => f.aiFillable).length : 0;

  // Back starts over (reset). With answers given, ask first: Back must not silently delete them.
  const hasAnswers = Object.values(state.conversation?.answers ?? {}).some((x) => x.status === "answered" || x.status === "confirmed");
  const [confirmNew, setConfirmNew] = useState(false);
  const backButton = useRef<HTMLElement | null>(null);
  const onBack = () => {
    if (!hasAnswers) return reset();
    backButton.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmNew(true);
  };

  return (
    <AppScreen>
      <AppBar onBack={onBack} menu={<AppMenu />} />
      <Page className="flex flex-col gap-4 pt-2">
        {/* Hero: one card answers "what is this paper" */}
        <Card className="flex flex-col gap-4">
          <div className="flex items-start gap-4">
            {state.source ? (
              <div className="relative w-20 shrink-0">
                <DocumentPreview pages={state.source.pages} alt={t("original")} maxPages={1} />
                <span
                  className="absolute -bottom-2 -right-2 flex size-9 items-center justify-center rounded-full bg-blue-600 text-white ring-4 ring-white"
                  aria-hidden
                >
                  <CategoryIcon className="size-5" />
                </span>
              </div>
            ) : (
              <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700" aria-hidden>
                <CategoryIcon className="size-8" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-base text-slate-600">{t("understoodLead")}</p>
              <h1 className="mt-0.5 break-words text-xl font-bold leading-tight text-slate-900">{a.title}</h1>
              {(questionCount > 1 || pageCount > 1) && (
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {questionCount > 1 && <MetaLine icon={ListChecks}>{t("questionsCount", { n: questionCount })}</MetaLine>}
                  {pageCount > 1 && <MetaLine icon={Files}>{t("pagesCount", { n: pageCount })}</MetaLine>}
                </p>
              )}
            </div>
          </div>
          <p className="border-t border-slate-100 pt-4 text-lg leading-relaxed text-slate-800">{a.summary}</p>
          <ReadAloudButton text={intro} className="self-start" />
        </Card>

        {analysis?.source === "basic" && <Notice tone="warning">{t("basicMode")}</Notice>}
        {analysis && !fillable && <Notice tone="info">{t("noFieldsFound")}</Notice>}
        {state.analysisError && (
          <Notice tone="error">
            <p>{t(state.analysisError)}</p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => {
                update({ analysisError: null, preview: null });
                go("analyzing");
              }}
            >
              <RotateCcw aria-hidden /> {t("tryAgain")}
            </Button>
          </Notice>
        )}

        {analysis && analysis.ambiguities.length > 0 && (
          <details className="group rounded-3xl border border-slate-200/80 bg-white shadow-sm">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-3xl px-4 py-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 [&::-webkit-details-marker]:hidden">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-800">
                <AlertTriangle className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 text-lg font-semibold text-slate-900">{t("unsureTitle")}</span>
              <Chip tone="amber" className="text-base">
                {analysis.ambiguities.length}
              </Chip>
              <ChevronDown className="size-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="flex list-disc flex-col gap-2 px-4 pb-4 pl-10 text-base text-slate-800">
              {analysis.ambiguities.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </details>
        )}

        <Button variant="ghost" size="md" className="self-center" onClick={reset}>
          <ScanLine aria-hidden /> {t("scanAgain")}
        </Button>
      </Page>

      <Dock>
        {pending ? (
          <ActionTile icon={PenLine} title={t("fillTitle")} sub={t("preparingQuestions")} primary busy />
        ) : analysis && fillable ? (
          <ActionTile icon={PenLine} title={t("fillTitle")} sub={t("fillSub")} primary onClick={() => go("conversation")} />
        ) : null}
        {pending || (analysis && fillable) ? (
          <Button block size="lg" variant="secondary" onClick={() => go("explain")}>
            <BookOpen aria-hidden /> {t("explainShort")}
          </Button>
        ) : (
          <ActionTile icon={BookOpen} title={t("explainShort")} sub={t("explainSub")} primary={Boolean(analysis)} onClick={() => go("explain")} />
        )}
      </Dock>

      <Dialog
        open={confirmNew}
        onOpenChange={setConfirmNew}
        onCloseAutoFocus={(e) => {
          // Back to the Back button (it is not a Radix trigger); after "Start new" it is gone, so nothing happens.
          e.preventDefault();
          backButton.current?.focus();
        }}
        title={t("startNewTitle")}
        description={t("startNewBody")}
        closeLabel={t("close")}
      >
        <div className="flex flex-col gap-3">
          <Button block onClick={() => setConfirmNew(false)}>
            {t("keepAnswers")}
          </Button>
          <Button block variant="secondary" onClick={reset}>
            <RotateCcw aria-hidden /> {t("startNew")}
          </Button>
        </div>
      </Dialog>
    </AppScreen>
  );
}

/** Explanation in simple language, plus spoken questions about the document. */
export function DocumentExplanation() {
  const { state, go, t, lang, speak, stopSpeaking } = useApp();
  const analysis = state.analysis;
  const preview = state.preview ?? analysis!;
  const a = {
    explanation: preview.explanation,
    instructions: analysis?.instructions ?? [],
    requiredDocuments: analysis?.requiredDocuments ?? [],
  };
  const fillable = analysis ? analysis.fields.some((f) => f.aiFillable) : false;
  const listen = useListen();
  const [qa, setQa] = useState<{ q: string; a: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const spoken = useRef(false);

  const fullText = [a.explanation.join(" "), ...a.instructions, ...a.requiredDocuments].join(" ");

  useEffect(() => {
    if (spoken.current) return;
    spoken.current = true;
    void speak(preview.explanation.join(" "));
  }, [preview.explanation, speak]);

  const ask = async (question: string) => {
    if (!question.trim() || !analysis) return;
    setAsking(true);
    try {
      const res = await api.ask(lang, question, analysis);
      setQa((prev) => [...prev, { q: question, a: res.answer }]);
      void speak(res.answer);
    } catch {
      setQa((prev) => [...prev, { q: question, a: t("errorGeneric") }]);
    } finally {
      setAsking(false);
    }
  };

  const onMic = async () => {
    if (listen.state === "listening") return listen.stop();
    const text = await listen.listen();
    if (text) await ask(text);
  };

  const micLabel = listen.state === "listening" ? t("listening") : listen.state === "processing" ? t("thinking") : t("tapToSpeak");
  const showKeyboard = typing || !listen.supported;

  return (
    <AppScreen>
      {/* Short title: "About this document" and a speaker button do not fit the bar at 375px. */}
      <AppBar
        onBack={() => go("understood")}
        title={t("explainShort")}
        menu={
          <AppMenu
            onOpenChange={(open) => {
              // The menu (and its microphone check) must not run alongside this screen's mic or voice.
              if (!open) return;
              listen.cancel();
              stopSpeaking();
            }}
          />
        }
      />
      <Page dock={fillable}>
        {/* What it is — the speaker reads the whole explanation aloud. */}
        <SectionTitle icon={Info} right={<SpeakButton text={fullText} />}>
          {t("sec_about")}
        </SectionTitle>
        <Card>
          <ul className="flex flex-col gap-3">
            {a.explanation.map((s, i) => (
              <li key={i} className="flex gap-3 text-lg leading-relaxed text-slate-800">
                <span className="mt-2.5 size-2.5 shrink-0 rounded-full bg-blue-600" aria-hidden />
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* What to do */}
        {a.instructions.length > 0 && (
          <>
            <SectionTitle icon={ListOrdered}>{t("sec_todo")}</SectionTitle>
            <Card>
              <ol className="flex flex-col gap-4">
                {a.instructions.map((s, i) => (
                  <li key={i} className="flex items-start gap-3 text-lg leading-relaxed text-slate-800">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-base font-bold text-blue-800">
                      {i + 1}
                    </span>
                    <span className="min-w-0 pt-0.5">{s}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </>
        )}

        {/* Bring along */}
        {a.requiredDocuments.length > 0 && (
          <>
            <SectionTitle icon={Paperclip}>{t("sec_bring")}</SectionTitle>
            <ListGroup>
              {a.requiredDocuments.map((s, i) => (
                <ListRow key={i} icon={FileText} value={s} />
              ))}
            </ListGroup>
          </>
        )}

        {/* Ask */}
        <SectionTitle icon={MessageCircleQuestion}>{t("ask")}</SectionTitle>
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-3" aria-live="polite">
            {qa.length === 0 && !asking && analysis && !showKeyboard && <p className="text-base text-slate-500">{t("askPrompt")}</p>}
            {qa.map((x, i) => (
              <div key={i} className="flex flex-col gap-2">
                <p className="ml-auto max-w-[85%] rounded-3xl rounded-br-lg bg-blue-600 px-4 py-3 text-lg text-white">{x.q}</p>
                <p className="mr-auto max-w-[90%] rounded-3xl rounded-bl-lg bg-slate-100 px-4 py-3 text-lg leading-relaxed text-slate-900">{x.a}</p>
              </div>
            ))}
            {listen.partial && (
              <p className="ml-auto max-w-[85%] rounded-3xl rounded-br-lg bg-blue-50 px-4 py-3 text-lg text-blue-900">“{listen.partial}”</p>
            )}
            {asking && <Spinner label={t("thinking")} />}
            {!analysis && <Spinner label={t("preparingQuestions")} />}
          </div>

          {listen.error && <Notice tone="warning">{t("micUnavailable")}</Notice>}

          {listen.supported && !typing && analysis && (
            <div className="flex flex-col items-center gap-2">
              <MicButton
                size="md"
                showLabel={false}
                state={listen.state === "idle" ? (asking ? "processing" : "idle") : listen.state}
                level={listen.level}
                label={micLabel}
                onPress={onMic}
              />
              <p
                aria-live="polite"
                className={cn(
                  "flex min-h-7 items-center justify-center gap-2 text-center text-lg font-semibold",
                  listen.state === "listening" ? "text-red-700" : "text-slate-700",
                )}
              >
                {listen.state === "listening" && <span className="inline-block size-2.5 rounded-full bg-red-600" aria-hidden />}
                {micLabel}
              </p>
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  listen.cancel();
                  setTyping(true);
                }}
              >
                <Keyboard aria-hidden /> {t("typeInstead")}
              </Button>
            </div>
          )}

          {showKeyboard && (
            <form
              className="flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(typed);
                setTyped("");
              }}
            >
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t("askPrompt")}
                aria-label={t("askPrompt")}
                className="min-h-14 min-w-0 flex-1 rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 text-lg focus:border-blue-600 focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                aria-label={t("send")}
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:opacity-40"
              >
                <Send className="size-6" aria-hidden />
              </button>
            </form>
          )}
          {listen.supported && typing && (
            <Button variant="ghost" size="md" className="self-center" onClick={() => setTyping(false)}>
              <Mic aria-hidden /> {t("speakInstead")}
            </Button>
          )}
        </Card>
      </Page>

      {fillable && (
        <Dock>
          <Button block size="lg" onClick={() => go("conversation")}>
            <PenLine aria-hidden /> {t("fillTitle")}
          </Button>
        </Dock>
      )}
    </AppScreen>
  );
}
