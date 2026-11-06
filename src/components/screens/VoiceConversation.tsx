"use client";

import {
  Check,
  CheckCircle2,
  CircleDashed,
  Ear,
  Keyboard,
  ListChecks,
  Loader2,
  Mic,
  Pause,
  Play,
  Repeat2,
  Send,
  SkipForward,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { demoAnswer, demoEnabled, demoYes } from "@/lib/client/demo";
import { applyTurn, introFor, progress, questionFor } from "@/lib/conversation/engine";
import { interpretWithRules, plainYesNo } from "@/lib/conversation/rules";
import type { AnswerSource, ConversationState, Interpretation, SpeechHint } from "@/lib/types";
import { cn } from "@/lib/utils";
import { compactHint } from "@/lib/speechHints";
import { AppMenu, type MenuAction, type MenuSwitch } from "@/components/common/AppMenu";
import { AppBar, AppScreen, Card, Dock, IconAction, Notice, Page } from "@/components/common/Chrome";
import { MicButton, type MicState } from "@/components/common/MicButton";
import { useListen } from "@/components/common/useListen";
import { useApp } from "@/components/app/AppContext";
import { Button } from "@/components/ui/button";
import { FieldSnippet } from "@/components/FieldSnippet";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  // What the person last said, tagged with the question it answered: shown only under that question.
  const [lastHeard, setLastHeard] = useState<{ text: string; fieldId: string | null } | null>(null);
  // The part of the spoken reply that is not the question ("Sorry, I didn't understand…"), for this field only.
  const [replyNote, setReplyNote] = useState<{ text: string; fieldId: string; tone: "info" | "warning" } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  // Demo mode (?demo=1): scripted answers appear word by word instead of listening (lib/client/demo).
  const [demo] = useState(demoEnabled);
  const [demoWords, setDemoWords] = useState<string | null>(null);
  const [demoLevel, setDemoLevel] = useState(0);
  const demoRun = useRef(0);
  const demoListening = demoWords !== null;

  const convRef = useRef<ConversationState>(conv);
  // Same as `busy`, but set at once (a tap can arrive before the re-render that disables the buttons).
  const busyRef = useRef(false);
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
  const simulateRef = useRef<() => Promise<void>>(async () => {});
  const cancelDemo = useCallback(() => {
    demoRun.current += 1;
    setDemoWords(null);
  }, []);

  const sayThenListen = useCallback(
    async (text: string, c: ConversationState) => {
      setPrompt(text);
      // The menu or the voice-engine sheet is open: keep the reply but do not speak or listen;
      // closing the sheet asks the current question again.
      if (sheetOpen.current) return;
      await speak(text);
      if (!alive.current) return;
      // Not if the person already tapped the mic while this was being spoken: that tap started
      // listening, and a second session here would replace it and lose their first words.
      // Not while the voice-engine sheet is open either.
      if (typingRef.current || sheetOpen.current || !(c.phase === "asking" || c.phase === "confirming")) return;
      if (demo && handsFreeRef.current) {
        void simulateRef.current();
        return;
      }
      if (handsFreeRef.current && listen.supported && !listen.active()) {
        void hearRef.current();
      }
    },
    [speak, listen.supported, listen.active, demo],
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
    async (utterance: string, source: AnswerSource, local?: Interpretation) => {
      const before = convRef.current;
      const beforeFieldId = before.pending?.fieldId ?? before.currentFieldId;
      setLastHeard({ text: utterance, fieldId: beforeFieldId });
      setNotice(null);
      setReplyNote(null);
      busyRef.current = true;
      setBusy(true);
      let next: { state: ConversationState; reply: string };
      // A reply that is only "yes" or only "no" to "Is that correct?" needs no AI: apply it on the
      // phone, instantly. Anything with more words (a correction, "not correct") goes to the interpreter.
      const plain = convRef.current.phase === "confirming" ? plainYesNo(utterance) : null;
      try {
        next = local
          ? applyTurn(convRef.current, fields, local, utterance, source)
          : plain
          ? applyTurn(convRef.current, fields, { intent: plain, targetFieldId: null, value: null, display: null, valid: true, problem: null, helpText: null }, utterance, source)
          : await api.turn(convRef.current, fields, utterance, analysis.documentLanguage, source);
      } catch {
        // Server unreachable: keep going with the on-device interpreter.
        next = applyTurn(convRef.current, fields, interpretWithRules(utterance, convRef.current, fields), utterance, source);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      if (!alive.current) return;
      setConv(next.state);
      // Still on the same question: show only the extra part of the reply (not the question itself).
      const nextFieldId = next.state.currentFieldId;
      const f = fields.find((x) => x.id === nextFieldId);
      if (f && next.state.phase === "asking" && nextFieldId === beforeFieldId) {
        const extra = next.reply.replace(f.question, " ").replace(/\s+/g, " ").trim();
        if (extra) setReplyNote({ text: extra, fieldId: f.id, tone: next.state.misses > before.misses ? "warning" : "info" });
      }
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

  /** Demo mode: the scripted answer (or "Yes" to a read-back) appears word by word, then is applied on the device. */
  const simulate = useCallback(async () => {
    const c = convRef.current;
    let heard: string;
    let local: Interpretation;
    if (c.phase === "confirming") {
      heard = demoYes(lang);
      local = control("yes");
    } else {
      const f = fields.find((x) => x.id === c.currentFieldId);
      const a = f ? demoAnswer(f, lang) : null;
      // Not in the script: listen for a real answer.
      if (!a) {
        if (listen.supported && !listen.active()) void hearRef.current();
        return;
      }
      heard = a.heard;
      local = { ...control("answer"), value: a.value, display: a.display };
    }
    const run = ++demoRun.current;
    const still = () => alive.current && demoRun.current === run;
    const words = heard.split(/\s+/).filter(Boolean);
    setDemoWords("");
    await wait(600);
    for (let i = 1; i <= words.length; i++) {
      if (!still()) return;
      setDemoWords(words.slice(0, i).join(" "));
      await wait(280);
    }
    await wait(450);
    if (!still()) return;
    setDemoWords(null);
    await processUtterance(heard, "voice", local);
  }, [fields, lang, listen, processUtterance]);
  simulateRef.current = simulate;

  // A moving level on the mic while a demo answer is "being said".
  useEffect(() => {
    if (!demoListening) return;
    const id = setInterval(() => setDemoLevel(0.25 + Math.random() * 0.6), 120);
    return () => clearInterval(id);
  }, [demoListening]);

  // Local control actions (no network needed): pause / resume / skip / repeat / yes / no.
  const applyControl = async (intent: Interpretation["intent"]) => {
    // While a spoken answer is being understood, its result will replace the state: a yes / no / skip
    // tapped now would be applied to the old question and then overwritten. Pause and resume still work.
    if (busyRef.current && intent !== "pause" && intent !== "resume") return;
    listen.cancel();
    cancelDemo();
    stopSpeaking();
    setNotice(null);
    setReplyNote(null);
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
      cancelDemo();
      stopSpeaking();
    };
    // Run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The menu or the voice-engine sheet pauses the conversation; closing it asks the current
  // question again (with the newly chosen engines).
  const onEngineSheet = (open: boolean) => {
    sheetOpen.current = open;
    if (open) {
      listen.cancel();
      cancelDemo();
      stopSpeaking();
      return;
    }
    const c = convRef.current;
    if (alive.current && (c.phase === "asking" || c.phase === "confirming")) void sayThenListen(currentPrompt(c), c);
  };

  const onMic = () => {
    emptyStreak.current = 0;
    if (demo) {
      if (demoListening || busy) return;
      if (conv.phase === "paused") return void applyControl("resume");
      stopSpeaking();
      void simulate();
      return;
    }
    if (listen.state === "listening") return listen.stop();
    if (busy || listen.state === "processing") return;
    if (conv.phase === "paused") return void applyControl("resume");
    stopSpeaking();
    void hear();
  };

  const micState: MicState =
    demoListening || listen.state === "listening"
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

  const canSpeak = listen.supported;
  const showKeyboard = typing || !canSpeak;
  const liveWords = Boolean(demoWords) || (listen.state !== "idle" && Boolean(listen.partial));

  // Text tied to a question shows only under that question (or its pending confirmation).
  const activeFieldId = conv.pending?.fieldId ?? conv.currentFieldId;
  const heardText = liveWords ? demoWords || listen.partial : lastHeard && lastHeard.fieldId === activeFieldId ? lastHeard.text : "";
  const showHeard = conv.phase !== "paused" && Boolean(heardText);
  const reply = conv.phase === "asking" && replyNote && replyNote.fieldId === activeFieldId ? replyNote : null;
  // What just happened to the PREVIOUS question: saved, or left empty.
  const lastEvent = Object.values(conv.answers).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const lastEventField = lastEvent ? fields.find((f) => f.id === lastEvent.fieldId) : undefined;
  const showSaved = conv.phase === "asking" && lastEvent && lastEventField && lastEvent.fieldId !== currentField?.id;
  const savedOk = lastEvent?.status === "answered" || lastEvent?.status === "confirmed";
  const kicker = currentField ? [currentField.group, currentField.labelLocalized].filter(Boolean).join(" · ") : "";
  // The heading is stable: the question, "Is this right?" or "Paused" — never the last spoken reply.
  const heading = conv.phase === "confirming" ? t("confirmQ") : currentField ? questionFor(currentField, lang) : t("convAllDone");
  const mode: "paused" | "yesno" | "typing" | "voice" =
    conv.phase === "paused"
      ? "paused"
      : conv.phase === "confirming" || (conv.phase === "asking" && currentField?.type === "checkbox")
        ? "yesno"
        : showKeyboard
          ? "typing"
          : "voice";

  const menuActions: MenuAction[] = [
    ...(conv.phase === "asking" || conv.phase === "confirming"
      ? [{ id: "pause", icon: Pause, label: t("pause"), onSelect: () => void applyControl("pause") }]
      : []),
    {
      id: "answers",
      icon: ListChecks,
      label: t("seeAnswers"),
      leaves: true,
      onSelect: () => {
        // Leaving: closing the menu must not ask the question again.
        alive.current = false;
        go("review");
      },
    },
  ];
  const menuSwitches: MenuSwitch[] = canSpeak
    ? [{ id: "auto", icon: Ear, label: t("auto"), sub: t("handsFree"), checked: handsFree, onChange: setHandsFree }]
    : [];

  // Not while a spoken answer is being understood: its reply is about to be spoken (and listened for).
  const repeat = () => {
    if (busyRef.current) return;
    void sayThenListen(prompt || currentPrompt(conv), convRef.current);
  };
  const skip = () => void applyControl("skip");
  const statusCls = cn(
    "flex min-h-5 items-center justify-center gap-1.5 text-center text-sm font-medium",
    micState === "listening" ? "text-red-700" : "text-slate-700",
  );

  return (
    <AppScreen>
      <AppBar
        onBack={() => go("understood")}
        title={p.total ? t("questionOf", { n: p.currentNumber, total: p.total }) : undefined}
        progress={p.total ? p.done / p.total : 0}
        menu={<AppMenu actions={menuActions} switches={menuSwitches} onOpenChange={onEngineSheet} />}
      />

      <Page className="flex flex-col gap-3 pt-3 pb-52">
        {/* 1. What just happened to the previous question. */}
        {showSaved && (
          <p className={cn("flex items-start gap-1.5 px-1 text-sm", savedOk ? "text-green-800" : "text-slate-600")}>
            {savedOk ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden />}
            {/* Wraps (never cut off): for answers that are not read back, this is the only record of what was saved. */}
            <span className="min-w-0 break-words">
              {savedOk
                ? t("savedPrev", { label: lastEventField.labelLocalized, value: lastEventField.sensitive ? "••••" : lastEvent.display })
                : t("leftEmpty", { label: lastEventField.labelLocalized })}
            </span>
          </p>
        )}

        {/* 2. The question and where on the form its answer goes, as one card. */}
        <Card className="overflow-hidden p-0">
          <div className="p-4">
            {conv.phase === "paused" ? (
              <>
                <h2 aria-live="polite" className="flex items-center gap-2.5 text-xl font-bold text-slate-900">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                    <Pause className="size-5" aria-hidden />
                  </span>
                  {t("pausedTitle")}
                </h2>
                <p className="mt-2 text-[15px] text-slate-600">{t("convPaused")}</p>
              </>
            ) : (
              <>
                {kicker && <p className="break-words text-[13px] font-semibold text-slate-500">{kicker}</p>}
                <h2 aria-live="polite" className="mt-1 text-xl font-semibold leading-snug text-slate-900">
                  {heading}
                </h2>
                {conv.phase === "asking" && currentField?.hint && <p className="mt-1.5 text-sm text-slate-600">{currentField.hint}</p>}
                {conv.phase === "confirming" && conv.pending && (
                  <p className="mt-2.5 break-words rounded-xl bg-blue-50 px-3.5 py-2.5 text-lg font-semibold text-blue-950">
                    {currentField?.sensitive ? "••••" : conv.pending.display}
                  </p>
                )}
              </>
            )}
          </div>
          {/* Where on the form this answer goes: a zoomed crop of the page with the spot outlined. */}
          {snippetPage && snippetBoxes.length > 0 && (conv.phase === "asking" || conv.phase === "confirming") && (
            <FieldSnippet
              variant="inset"
              page={snippetPage}
              boxes={snippetBoxes}
              caption={
                conv.phase === "confirming" && conv.pending
                  ? t(isChoice ? "snippetConfirmChoice" : "snippetConfirm", { value: currentField?.sensitive ? "••••" : conv.pending.display })
                  : t(isChoice ? "snippetAskChoice" : "snippetAsk")
              }
            />
          )}
        </Card>

        {/* 3. What the person said — only for the current question. Live words are provisional. */}
        {showHeard && (
          <div className={cn("rounded-2xl border px-4 py-3", liveWords ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white")}>
            <p className="flex items-center gap-1.5 text-[13px] text-slate-500">
              <Mic className="size-4" aria-hidden />
              {t("youSaid")}
            </p>
            <p className={cn("mt-0.5 break-words text-base", liveWords ? "italic text-blue-900" : "text-slate-900")}>{heardText}</p>
          </div>
        )}
        {/* 4. The extra part of the reply ("Sorry, I didn't understand…"). */}
        {reply && <Notice tone={reply.tone}>{reply.text}</Notice>}
        {/* 5. Heard nothing / microphone unavailable. */}
        {notice && <Notice tone="warning">{notice}</Notice>}
      </Page>

      <Dock className="gap-2 pt-3">
        {mode === "voice" && (
          <>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center justify-items-center">
              <IconAction icon={Repeat2} label={t("repeat")} onClick={repeat} disabled={busy} />
              <MicButton size="lg" showLabel={false} state={micState} label={micLabel} level={demoListening ? demoLevel : listen.level} onPress={onMic} />
              <IconAction icon={SkipForward} label={t("skip")} onClick={skip} disabled={busy} />
            </div>
            <p aria-live="polite" className={statusCls}>
              {micState === "listening" && <span className="inline-block size-2 rounded-full bg-red-600" aria-hidden />}
              {micLabel}
            </p>
            <Button
              variant="ghost"
              size="md"
              className="self-center"
              onClick={() => {
                listen.cancel();
                cancelDemo();
                setTyping(true);
              }}
            >
              <Keyboard aria-hidden /> {t("typeInstead")}
            </Button>
          </>
        )}

        {mode === "yesno" && (
          <>
            {/* Disabled while a spoken reply is being understood: its result decides this question. */}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="success" size="lg" disabled={busy} onClick={() => void applyControl("yes")}>
                <Check aria-hidden /> {t("yes")}
              </Button>
              <Button variant="secondary" size="lg" disabled={busy} onClick={() => void applyControl("no")}>
                <X aria-hidden /> {t("no")}
              </Button>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center justify-items-center">
              <IconAction icon={Repeat2} label={t("repeat")} onClick={repeat} disabled={busy} />
              {canSpeak ? (
                <MicButton size="md" showLabel={false} state={micState} label={micLabel} level={demoListening ? demoLevel : listen.level} onPress={onMic} />
              ) : (
                <span aria-hidden />
              )}
              {/* No Skip while confirming: the engine only answers "Please say yes or no" there. */}
              {conv.phase === "asking" ? <IconAction icon={SkipForward} label={t("skip")} onClick={skip} disabled={busy} /> : <span aria-hidden />}
            </div>
            {canSpeak && (
              <p aria-live="polite" className={statusCls}>
                {micState === "listening" && <span className="inline-block size-2 rounded-full bg-red-600" aria-hidden />}
                {micState === "idle" ? t("orSayYesNo") : micLabel}
              </p>
            )}
          </>
        )}

        {mode === "typing" && (
          <>
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
                inputMode={
                  currentField?.type === "phone" || currentField?.type === "number" ? "numeric" : currentField?.type === "email" ? "email" : "text"
                }
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-base focus:border-blue-600 focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !typed.trim()}
                aria-label={t("send")}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:opacity-40"
              >
                {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Send className="size-5" aria-hidden />}
              </button>
            </form>
            <div className={cn("grid items-start justify-items-center", canSpeak ? "grid-cols-3" : "grid-cols-2")}>
              <IconAction icon={Repeat2} label={t("repeat")} onClick={repeat} disabled={busy} />
              {canSpeak && (
                <IconAction
                  icon={Mic}
                  label={t("speakInstead")}
                  onClick={() => {
                    setTyping(false);
                    if (!busy) {
                      stopSpeaking();
                      void hear();
                    }
                  }}
                />
              )}
              <IconAction icon={SkipForward} label={t("skip")} onClick={skip} disabled={busy} />
            </div>
          </>
        )}

        {mode === "paused" && (
          <Button block size="lg" onClick={() => void applyControl("resume")}>
            <Play aria-hidden /> {t("resume")}
          </Button>
        )}
      </Dock>
    </AppScreen>
  );
}
