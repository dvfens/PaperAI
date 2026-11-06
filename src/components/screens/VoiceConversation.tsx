"use client";

import { CheckCircle2, Ear, EarOff, Keyboard, ListChecks, Loader2, Pause, Play, Repeat2, Send, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { applyTurn, introFor, progress, questionFor } from "@/lib/conversation/engine";
import { interpretWithRules, plainYesNo } from "@/lib/conversation/rules";
import type { AnswerSource, ConversationState, Interpretation, SpeechHint } from "@/lib/types";
import { cn } from "@/lib/utils";
import { compactHint } from "@/lib/speechHints";
import { VoiceEngineButton } from "@/components/common/VoiceEngine";
import { AppBar, AppScreen, Chip, Dock, IconAction, IconButton, Notice, Page } from "@/components/common/Chrome";
import { MicButton, type MicState } from "@/components/common/MicButton";
import { useListen } from "@/components/common/useListen";
import { useApp } from "@/components/app/AppContext";
import { FieldSnippet } from "@/components/FieldSnippet";

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
  const sheetOpen = useRef(false);
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
      // The voice-engine sheet is open: show the reply but do not speak or listen; closing the
      // sheet asks the current question again.
      if (sheetOpen.current) return;
      await speak(text);
      if (!alive.current) return;
      // Not if the person already tapped the mic while this was being spoken: that tap started
      // listening, and a second session here would replace it and lose their first words.
      // Not while the voice-engine sheet is open either.
      if (handsFreeRef.current && listen.supported && !typingRef.current && !sheetOpen.current && !listen.active() && (c.phase === "asking" || c.phase === "confirming")) {
        void hearRef.current();
      }
    },
    [speak, listen.supported, listen.active],
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
      // A reply that is only "yes" or only "no" to "Is that correct?" needs no AI: apply it on the
      // phone, instantly. Anything with more words (a correction, "not correct") goes to the interpreter.
      const plain = convRef.current.phase === "confirming" ? plainYesNo(utterance) : null;
      try {
        next = plain
          ? applyTurn(convRef.current, fields, { intent: plain, targetFieldId: null, value: null, display: null, valid: true, problem: null, helpText: null }, utterance, source)
          : await api.turn(convRef.current, fields, utterance, analysis.documentLanguage, source);
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
    // Tell recognition what is being answered: a yes/no while confirming, else the current field.
    const c = convRef.current;
    const f = fields.find((x) => x.id === c.currentFieldId);
    const hint: SpeechHint | undefined =
      c.phase === "confirming" ? compactHint("yesno") : f ? compactHint(f.type, f.options) : undefined;
    const text = await listen.listen(hint);
    // Cancelled (Pause, Skip, Repeat, a newer listen or leaving the screen): not "heard nothing".
    if (text === undefined || !alive.current) return;
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
  }, [listen, t, sayThenListen, processUtterance, fields]);
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

  // The voice-engine sheet pauses the conversation; closing it asks the current question again
  // (with the newly chosen engines).
  const onEngineSheet = (open: boolean) => {
    sheetOpen.current = open;
    if (open) {
      listen.cancel();
      stopSpeaking();
      return;
    }
    const c = convRef.current;
    if (alive.current && (c.phase === "asking" || c.phase === "confirming")) void sayThenListen(currentPrompt(c), c);
  };

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
  const snippetPage = currentField?.box ? state.source?.pages[currentField.box.page] : undefined;
  // Where the answer goes: the field's box, or for a choice every option's box — only the chosen one
  // while confirming, so the picture never suggests an option the person did not choose.
  const optionBoxes = currentField?.type === "choice" && currentField.optionBoxes ? currentField.optionBoxes : null;
  const chosenBox = optionBoxes && conv.phase === "confirming" && conv.pending ? optionBoxes[conv.pending.value] : undefined;
  const snippetBoxes = !currentField?.box
    ? []
    : chosenBox
      ? [chosenBox]
      : optionBoxes
        ? Object.values(optionBoxes).filter((b) => b.page === currentField.box!.page)
        : [currentField.box];
  const isChoice = Boolean(optionBoxes);
  const lastAnswer = Object.values(conv.answers)
    .filter((a) => a.status === "answered" || a.status === "confirmed")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const lastAnswerField = lastAnswer ? fields.find((f) => f.id === lastAnswer.fieldId) : undefined;

  const canSpeak = listen.supported;
  const showKeyboard = typing || !canSpeak;
  const liveWords = listen.state !== "idle" && Boolean(listen.partial);
  const heard = liveWords ? listen.partial : lastHeard;

  return (
    <AppScreen>
      <AppBar
        onBack={() => go("understood")}
        right={
          <>
            <VoiceEngineButton onOpenChange={onEngineSheet} />
            {canSpeak && (
              <IconButton icon={handsFree ? Ear : EarOff} label={t("auto")} pressed={handsFree} onClick={() => setHandsFree((v) => !v)} />
            )}
            <IconButton icon={ListChecks} label={t("seeAnswers")} onClick={() => go("review")} />
          </>
        }
      />
      {/* Progress: the count sits beside the bar (the app bar is too narrow for it next to two buttons). */}
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200" aria-hidden>
          <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
        </div>
        <p className="shrink-0 text-base font-bold tabular-nums text-slate-600">
          <span aria-hidden>
            {p.currentNumber} / {p.total}
          </span>
          <span className="sr-only">{t("questionOf", { n: p.currentNumber, total: p.total })}</span>
        </p>
      </div>

      <Page className={cn("flex flex-col gap-5 pt-6", showKeyboard && "pb-64")}>
        <section aria-live="polite" className="flex flex-col items-start gap-3">
          {currentField && conv.phase !== "paused" && (
            <Chip tone="blue" className="max-w-full rounded-2xl text-base">
              <span className="min-w-0 break-words">{currentField.labelLocalized}</span>
            </Chip>
          )}
          <p className="text-2xl font-bold leading-snug text-slate-900">
            {conv.phase === "paused" ? t("pausedTitle") : prompt || currentPrompt(conv)}
          </p>
          {currentField?.hint && conv.phase === "asking" && <p className="text-lg text-slate-500">{currentField.hint}</p>}
          {/* Where on the form this answer goes: a zoomed crop of the page with the spot outlined. */}
          {snippetPage && snippetBoxes.length > 0 && (conv.phase === "asking" || conv.phase === "confirming") && (
            <FieldSnippet
              page={snippetPage}
              boxes={snippetBoxes}
              caption={
                conv.phase === "confirming" && conv.pending
                  ? t(isChoice ? "snippetConfirmChoice" : "snippetConfirm", { value: currentField?.sensitive ? "••••" : conv.pending.display })
                  : t(isChoice ? "snippetAskChoice" : "snippetAsk")
              }
            />
          )}
        </section>

        {heard && (
          <div
            className={cn(
              "ml-auto max-w-[85%] rounded-3xl rounded-br-lg px-4 py-3 text-lg shadow-sm",
              // Live words are provisional until the final transcript arrives.
              liveWords ? "bg-blue-50 italic text-blue-900" : "bg-blue-600 text-white",
            )}
            aria-label={t("youSaid")}
          >
            {heard}
          </div>
        )}

        {lastAnswer && lastAnswerField && conv.phase === "asking" && (
          <Chip tone="green" icon={CheckCircle2} className="max-w-full rounded-2xl text-base">
            <span className="min-w-0 break-words">
              {lastAnswerField.labelLocalized}: {lastAnswerField.sensitive ? "••••" : lastAnswer.display}
            </span>
          </Chip>
        )}
        {notice && <Notice tone="warning">{notice}</Notice>}
      </Page>

      <Dock className="gap-3 pt-2">
        {/* Status line with the two less-used toggles either side, so the main row fits a 375px phone. */}
        <div className="flex items-center gap-2">
          {canSpeak ? (
            <IconButton
              icon={Keyboard}
              label={t("type")}
              pressed={typing}
              className={typing ? undefined : "bg-slate-100"}
              onClick={() => {
                listen.cancel();
                setTyping((v) => !v);
              }}
            />
          ) : (
            <span className="size-12 shrink-0" aria-hidden />
          )}
          <p
            className={cn("min-w-0 flex-1 text-center text-base font-semibold", micState === "listening" ? "text-red-700" : "text-slate-500")}
            aria-live="polite"
          >
            {canSpeak ? micLabel : null}
          </p>
          {conv.phase === "paused" ? (
            <IconButton icon={Play} label={t("resume")} pressed onClick={() => void applyControl("resume")} />
          ) : (
            <IconButton icon={Pause} label={t("pause")} className="bg-slate-100" onClick={() => void applyControl("pause")} />
          )}
        </div>
        {showKeyboard && (
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
              className="min-h-14 min-w-0 flex-1 rounded-full border-2 border-slate-200 bg-slate-50 px-5 text-lg focus:border-blue-600 focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !typed.trim()}
              aria-label={t("send")}
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <Send className="size-6" aria-hidden />}
            </button>
          </form>
        )}
        <div className="grid grid-cols-3 items-center justify-items-center">
          <IconAction icon={Repeat2} label={t("repeat")} onClick={() => void sayThenListen(prompt || currentPrompt(conv), convRef.current)} />
          {canSpeak && !typing ? (
            <MicButton size="md" showLabel={false} state={micState} label={micLabel} level={listen.level} onPress={onMic} />
          ) : (
            <span className="size-16" aria-hidden />
          )}
          <IconAction icon={SkipForward} label={t("skip")} onClick={() => void applyControl("skip")} disabled={conv.phase === "paused"} />
        </div>
      </Dock>
    </AppScreen>
  );
}
