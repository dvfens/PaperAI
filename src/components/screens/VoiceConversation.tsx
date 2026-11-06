"use client";

import { CheckCircle2, Keyboard, ListChecks, Pause, Play, Repeat2, Send, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { applyTurn, introFor, progress, questionFor } from "@/lib/conversation/engine";
import { interpretWithRules } from "@/lib/conversation/rules";
import type { AnswerSource, ConversationState, Interpretation } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Notice, Screen, TopBar } from "@/components/common/Chrome";
import { MicButton, type MicState } from "@/components/common/MicButton";
import { useListen } from "@/components/common/useListen";
import { useApp } from "@/components/app/AppContext";

const control = (intent: Interpretation["intent"]): Interpretation => ({
  intent,
  targetFieldId: null,
  value: null,
  display: null,
  valid: true,
  problem: null,
  helpText: null,
});

/** Screen 3 — one question at a time, by voice. */
export function VoiceConversation() {
  const { state, update, go, t, lang, speak, stopSpeaking, speaking } = useApp();
  const analysis = state.analysis!;
  const fields = analysis.fields;
  const conv = state.conversation!;
  const listen = useListen();

  const [handsFree, setHandsFree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

  const convRef = useRef<ConversationState>(conv);
  const alive = useRef(true);
  const emptyStreak = useRef(0);
  const handsFreeRef = useRef(handsFree);
  const typingRef = useRef(typing);
  handsFreeRef.current = handsFree;
  typingRef.current = typing;

  const setConv = useCallback(
    (c: ConversationState) => {
      convRef.current = c;
      update({ conversation: c });
    },
    [update],
  );

  const currentPrompt = useCallback(
    (c: ConversationState) => {
      if (c.phase === "confirming" && c.pending) {
        const f = fields.find((x) => x.id === c.pending!.fieldId);
        return t("convConfirm", { label: f?.labelLocalized ?? "", display: c.pending.display });
      }
      const f = fields.find((x) => x.id === c.currentFieldId);
      return f ? questionFor(f, lang) : t("convAllDone");
    },
    [fields, lang, t],
  );

  // Declared before use by the mutually recursive helpers below.
  const hearRef = useRef<() => Promise<void>>(async () => {});

  const sayThenListen = useCallback(
    async (text: string, c: ConversationState) => {
      setPrompt(text);
      await speak(text);
      if (!alive.current) return;
      if (handsFreeRef.current && listen.supported && !typingRef.current && (c.phase === "asking" || c.phase === "confirming")) {
        void hearRef.current();
      }
    },
    [speak, listen.supported],
  );

  const finishIfComplete = useCallback(
    async (c: ConversationState, reply: string) => {
      if (c.phase !== "complete") return false;
      setPrompt(reply);
      await speak(reply);
      if (alive.current) go("review");
      return true;
    },
    [speak, go],
  );

  const processUtterance = useCallback(
    async (utterance: string, source: AnswerSource) => {
      setLastHeard(utterance);
      setNotice(null);
      setBusy(true);
      let next: { state: ConversationState; reply: string };
      try {
        next = await api.turn(convRef.current, fields, utterance, analysis.documentLanguage, source);
      } catch {
        // Server unreachable: keep going with the on-device interpreter.
        next = applyTurn(convRef.current, fields, interpretWithRules(utterance, convRef.current, fields), utterance, source);
      } finally {
        setBusy(false);
      }
      if (!alive.current) return;
      setConv(next.state);
      if (await finishIfComplete(next.state, next.reply)) return;
      await sayThenListen(next.reply, next.state);
    },
    [fields, analysis.documentLanguage, setConv, finishIfComplete, sayThenListen],
  );

  const hear = useCallback(async () => {
    const text = await listen.listen();
    if (!alive.current) return;
    if (text === null) {
      setNotice(t("micUnavailable"));
      setTyping(true);
      return;
    }
    if (!text.trim()) {
      emptyStreak.current += 1;
      setNotice(t("heardNothing"));
      if (emptyStreak.current >= 2) return; // stop the hands-free loop; the person taps when ready
      await sayThenListen(t("heardNothing"), convRef.current);
      return;
    }
    emptyStreak.current = 0;
    await processUtterance(text, "voice");
  }, [listen, t, sayThenListen, processUtterance]);
  hearRef.current = hear;

  // Local control actions (no network needed): pause / resume / skip / repeat.
  const applyControl = async (intent: Interpretation["intent"]) => {
    listen.cancel();
    stopSpeaking();
    const next = applyTurn(convRef.current, fields, control(intent), "", "voice");
    setConv(next.state);
    if (await finishIfComplete(next.state, next.reply)) return;
    if (next.state.phase === "paused") {
      setPrompt(next.reply);
      void speak(next.reply);
      return;
    }
    await sayThenListen(next.reply, next.state);
  };

  // Start (or resume) the conversation when the screen opens.
  useEffect(() => {
    alive.current = true;
    const c = convRef.current;
    if (c.phase === "complete") {
      go("review");
      return;
    }
    const text = c.history.length ? currentPrompt(c) : `${introFor(fields, lang)} ${currentPrompt(c)}`;
    const resumed: ConversationState = c.phase === "paused" ? { ...c, phase: c.pending ? "confirming" : "asking" } : c;
    if (resumed !== c) setConv(resumed);
    void sayThenListen(text, resumed);
    return () => {
      alive.current = false;
      listen.cancel();
      stopSpeaking();
    };
    // Run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMic = () => {
    emptyStreak.current = 0;
    if (listen.state === "listening") return listen.stop();
    if (busy || listen.state === "processing") return;
    if (conv.phase === "paused") return void applyControl("resume");
    stopSpeaking();
    void hear();
  };

  const micState: MicState =
    listen.state === "listening"
      ? "listening"
      : listen.state === "processing" || busy
        ? "processing"
        : speaking
          ? "speaking"
          : "idle";
  const micLabel =
    micState === "listening" ? t("listening") : micState === "processing" ? t("thinking") : micState === "speaking" ? t("speaking") : t("tapToSpeak");

  const p = progress(conv, fields);
  const currentField = fields.find((f) => f.id === (conv.pending?.fieldId ?? conv.currentFieldId));
  const lastAnswer = Object.values(conv.answers)
    .filter((a) => a.status === "answered" || a.status === "confirmed")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const lastAnswerField = lastAnswer ? fields.find((f) => f.id === lastAnswer.fieldId) : undefined;

  return (
    <>
      <TopBar onBack={() => go("understood")} />
      <Screen className="flex min-h-[calc(100dvh-4rem)] flex-col">
        <div className="flex items-center justify-between gap-3 text-lg font-semibold text-slate-700">
          <span>{t("questionOf", { n: p.currentNumber, total: p.total })}</span>
          <button onClick={() => go("review")} className="inline-flex min-h-12 items-center gap-2 text-blue-800 hover:underline">
            <ListChecks className="size-6" aria-hidden /> {t("seeAnswers")}
          </button>
        </div>
        <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <div className="h-full rounded-full bg-blue-700" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
        </div>

        <section className="mt-6 flex-1" aria-live="polite">
          {currentField && conv.phase !== "paused" && (
            <p className="text-lg font-semibold uppercase tracking-wide text-blue-800">{currentField.labelLocalized}</p>
          )}
          <p className="mt-2 text-3xl font-semibold leading-snug text-slate-900">
            {conv.phase === "paused" ? t("pausedTitle") : prompt || currentPrompt(conv)}
          </p>
          {currentField?.hint && conv.phase === "asking" && <p className="mt-3 text-xl text-slate-700">{currentField.hint}</p>}

          {(listen.partial || lastHeard) && (
            <div className="mt-6 rounded-2xl bg-slate-100 px-4 py-3">
              <p className="text-base font-semibold text-slate-600">{t("youSaid")}</p>
              <p className="text-xl text-slate-900">“{listen.state === "listening" && listen.partial ? listen.partial : lastHeard}”</p>
            </div>
          )}
          {lastAnswer && lastAnswerField && conv.phase === "asking" && (
            <p className="mt-4 flex items-center gap-2 text-lg text-green-800">
              <CheckCircle2 className="size-6 shrink-0" aria-hidden />
              <span>
                {lastAnswerField.labelLocalized}: <strong>{lastAnswerField.sensitive ? "••••" : lastAnswer.display}</strong>
              </span>
            </p>
          )}
          {notice && (
            <div className="mt-4">
              <Notice tone="warning">{notice}</Notice>
            </div>
          )}
        </section>

        <div className="mt-6 flex flex-col items-center gap-5">
          {listen.supported && !typing && <MicButton state={micState} label={micLabel} level={listen.level} onPress={onMic} />}

          {(typing || !listen.supported) && (
            <form
              className="flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = typed.trim();
                if (!v || busy) return;
                setTyped("");
                void processUtterance(v, "typed");
              }}
            >
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t("typePlaceholder")}
                aria-label={t("typePlaceholder")}
                autoFocus
                className="min-h-16 flex-1 rounded-2xl border-2 border-slate-300 px-4 text-xl focus:border-blue-600 focus:outline-none"
              />
              <Button type="submit" disabled={busy} aria-label={t("send")}>
                <Send aria-hidden />
              </Button>
            </form>
          )}

          <div className="grid w-full grid-cols-3 gap-2">
            <Button variant="secondary" size="sm" onClick={() => void sayThenListen(prompt || currentPrompt(conv), convRef.current)}>
              <Repeat2 aria-hidden /> {t("repeat")}
            </Button>
            {conv.phase === "paused" ? (
              <Button variant="secondary" size="sm" onClick={() => void applyControl("resume")}>
                <Play aria-hidden /> {t("resume")}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => void applyControl("pause")}>
                <Pause aria-hidden /> {t("pause")}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => void applyControl("skip")} disabled={conv.phase === "paused"}>
              <SkipForward aria-hidden /> {t("skip")}
            </Button>
          </div>

          <div className="flex w-full flex-wrap items-center justify-between gap-3 pb-safe">
            {listen.supported && (
              <button
                onClick={() => {
                  listen.cancel();
                  setTyping((v) => !v);
                }}
                className="inline-flex min-h-12 items-center gap-2 text-lg font-semibold text-blue-800"
              >
                <Keyboard className="size-5" aria-hidden /> {typing ? t("tapToSpeak") : t("typeInstead")}
              </button>
            )}
            {listen.supported && (
              <label className="inline-flex min-h-12 cursor-pointer items-center gap-3 text-base text-slate-700">
                <input
                  type="checkbox"
                  checked={handsFree}
                  onChange={(e) => setHandsFree(e.target.checked)}
                  className="size-6 accent-blue-700"
                />
                {t("handsFree")}
              </label>
            )}
          </div>
        </div>
      </Screen>
    </>
  );
}
