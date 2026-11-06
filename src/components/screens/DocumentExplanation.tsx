"use client";

import { BookOpen, FileText, Keyboard, Loader2, MessageCircleQuestion, PenLine, ScanLine, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { ActionBar, Notice, ReadAloudButton, Screen, Spinner, TopBar } from "@/components/common/Chrome";
import { MicButton } from "@/components/common/MicButton";
import { useListen } from "@/components/common/useListen";
import { DocumentPreview } from "@/components/DocumentPreview";
import { useApp } from "@/components/app/AppContext";

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

  return (
    <>
      <TopBar onBack={reset} />
      <Screen>
        <div className="flex gap-4">
          {state.source && <DocumentPreview pages={state.source.pages} alt={t("original")} maxPages={1} className="w-24 shrink-0" />}
          <div className="min-w-0">
            <p className="text-lg text-slate-600">{t("understoodLead")}</p>
            <h1 className="text-3xl font-bold leading-tight text-slate-900">{a.title}</h1>
          </div>
        </div>
        <p className="mt-5 text-2xl leading-relaxed text-slate-800">{a.summary}</p>
        <ReadAloudButton text={intro} className="mt-4" />

        <div className="mt-5 flex flex-col gap-3">
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
                {t("tryAgain")}
              </Button>
            </Notice>
          )}
          {analysis && analysis.ambiguities.length > 0 && (
            <Notice tone="warning">
              <ul className="list-disc pl-5">
                {analysis.ambiguities.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>

        <ActionBar>
          {pending ? (
            <Button block disabled>
              <Loader2 className="animate-spin" aria-hidden /> {t("preparingQuestions")}
            </Button>
          ) : (
            fillable &&
            analysis && (
              <Button block onClick={() => go("conversation")}>
                <PenLine aria-hidden /> {t("fillAction")}
              </Button>
            )
          )}
          <Button block variant={fillable ? "secondary" : "primary"} onClick={() => go("explain")}>
            <BookOpen aria-hidden /> {t("explainAction")}
          </Button>
          <Button block variant="ghost" size="md" onClick={reset}>
            <ScanLine aria-hidden /> {t("scanAgain")}
          </Button>
        </ActionBar>
      </Screen>
    </>
  );
}

/** Explanation in simple language, plus spoken questions about the document. */
export function DocumentExplanation() {
  const { state, go, t, lang, speak } = useApp();
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

  return (
    <>
      <TopBar onBack={() => go("understood")} />
      <Screen>
        <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-900">
          <FileText className="size-8 text-blue-700" aria-hidden /> {t("explainTitle")}
        </h1>
        <ReadAloudButton text={fullText} className="mt-4" />
        <div className="mt-5 flex flex-col gap-3 text-xl leading-relaxed text-slate-800">
          {a.explanation.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </div>

        {a.instructions.length > 0 && (
          <section className="mt-7">
            <h2 className="text-2xl font-bold text-slate-900">{t("instructionsTitle")}</h2>
            <ol className="mt-3 flex list-decimal flex-col gap-2 pl-7 text-xl text-slate-800">
              {a.instructions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </section>
        )}
        {a.requiredDocuments.length > 0 && (
          <section className="mt-7">
            <h2 className="text-2xl font-bold text-slate-900">{t("requiredDocsTitle")}</h2>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-7 text-xl text-slate-800">
              {a.requiredDocuments.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8 rounded-3xl border-2 border-slate-200 p-5">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <MessageCircleQuestion className="size-7 text-blue-700" aria-hidden /> {t("askQuestion")}
          </h2>
          <p className="mt-1 text-lg text-slate-700">{t("askPrompt")}</p>
          <div className="mt-4 flex flex-col gap-4">
            {qa.map((x, i) => (
              <div key={i} className="flex flex-col gap-2">
                <p className="self-end rounded-2xl rounded-br-sm bg-slate-100 px-4 py-2 text-lg text-slate-900">{x.q}</p>
                <p className="rounded-2xl rounded-bl-sm bg-blue-50 px-4 py-3 text-xl text-slate-900">{x.a}</p>
              </div>
            ))}
            {asking && <Spinner label={t("thinking")} />}
            {!analysis && <Spinner label={t("preparingQuestions")} />}
          </div>
          {analysis && listen.supported && !typing && (
            <div className="mt-5">
              <MicButton
                state={listen.state === "idle" ? (asking ? "processing" : "idle") : listen.state}
                level={listen.level}
                label={listen.state === "listening" ? t("listening") : listen.state === "processing" ? t("thinking") : t("tapToSpeak")}
                onPress={onMic}
              />
              {listen.partial && <p className="mt-3 text-center text-lg text-slate-700">“{listen.partial}”</p>}
            </div>
          )}
          {listen.error && <Notice tone="warning">{t("micUnavailable")}</Notice>}
          {typing || !listen.supported ? (
            <form
              className="mt-4 flex gap-2"
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
                className="min-h-14 flex-1 rounded-2xl border-2 border-slate-300 px-4 text-lg focus:border-blue-600 focus:outline-none"
              />
              <Button type="submit" size="md" aria-label={t("send")}>
                <Send aria-hidden />
              </Button>
            </form>
          ) : (
            <button onClick={() => setTyping(true)} className="mt-4 inline-flex min-h-12 items-center gap-2 text-lg font-semibold text-blue-800">
              <Keyboard className="size-5" aria-hidden /> {t("typeInstead")}
            </button>
          )}
        </section>

        {fillable && (
          <ActionBar>
            <Button block onClick={() => go("conversation")}>
              <PenLine aria-hidden /> {t("startFilling")}
            </Button>
          </ActionBar>
        )}
      </Screen>
    </>
  );
}
