/**
 * Deterministic conversation state machine.
 *
 * The language model (or the rule-based fallback) only *interprets* what the person said.
 * Every state transition — which question comes next, when to confirm, what gets stored — happens
 * here, in plain code. That makes the behaviour predictable and guarantees nothing is written to
 * the form that the person did not say and (for important fields) did not confirm.
 */
import { t } from "@/lib/i18n";
import type { LanguageCode } from "@/lib/i18n/languages";
import type {
  AnswerSource,
  ConversationState,
  FieldAnswer,
  FormField,
  Interpretation,
} from "@/lib/types";

const MAX_HISTORY = 12;

export function askableFields(fields: FormField[]): FormField[] {
  return fields.filter((f) => f.aiFillable);
}

export function initialState(language: LanguageCode, fields: FormField[]): ConversationState {
  const first = askableFields(fields)[0];
  return {
    language,
    phase: first ? "asking" : "complete",
    currentFieldId: first?.id ?? null,
    returnToFieldId: null,
    pending: null,
    answers: {},
    misses: 0,
    history: [],
  };
}

export function questionFor(field: FormField, lang: LanguageCode, withOptions = false): string {
  const parts = [field.question];
  if (withOptions && field.type === "choice" && field.options?.length) {
    parts.push(t(lang, "convChoiceOptions", { options: field.options.join(", ") }));
  } else if (withOptions && field.hint) {
    parts.push(field.hint);
  }
  return parts.join(" ");
}

export function introFor(fields: FormField[], lang: LanguageCode): string {
  return t(lang, "convIntro", { n: askableFields(fields).length });
}

/** First askable field the person has not dealt with yet (answered, skipped or "don't know"). */
export function nextOpenField(state: ConversationState, fields: FormField[]): FormField | null {
  return askableFields(fields).find((f) => !state.answers[f.id]) ?? null;
}

export function progress(state: ConversationState, fields: FormField[]) {
  const askable = askableFields(fields);
  const done = askable.filter((f) => state.answers[f.id]).length;
  const currentIndex = Math.max(0, askable.findIndex((f) => f.id === state.currentFieldId));
  return { done, total: askable.length, currentNumber: Math.min(askable.length, currentIndex + 1) };
}

function withHistory(state: ConversationState, role: "assistant" | "user", text: string): ConversationState {
  if (!text) return state;
  const history = [...state.history, { role, text, at: Date.now() }].slice(-MAX_HISTORY);
  return { ...state, history };
}

function commit(
  state: ConversationState,
  fieldId: string,
  value: string,
  display: string,
  heard: string,
  status: FieldAnswer["status"],
  source: AnswerSource,
): ConversationState {
  return {
    ...state,
    answers: {
      ...state.answers,
      [fieldId]: { fieldId, value, display, heard, status, source, updatedAt: Date.now() },
    },
  };
}

function confirmText(field: FormField, display: string, lang: LanguageCode): string {
  return t(lang, "convConfirm", { label: field.labelLocalized || field.label, display });
}

/** Move to the next open question (or back to where a correction detour started). */
function advance(state: ConversationState, fields: FormField[], lead: string): { state: ConversationState; reply: string } {
  const lang = state.language;
  const byId = new Map(fields.map((f) => [f.id, f]));
  let next: FormField | null = null;
  if (state.returnToFieldId) {
    const back = byId.get(state.returnToFieldId);
    if (back && !state.answers[back.id]) next = back;
  }
  next ??= nextOpenField(state, fields);
  const base = { ...state, pending: null, returnToFieldId: null, misses: 0 };
  if (!next) {
    return { state: { ...base, phase: "complete", currentFieldId: null }, reply: [lead, t(lang, "convAllDone")].filter(Boolean).join(" ") };
  }
  return {
    state: { ...base, phase: "asking", currentFieldId: next.id },
    reply: [lead, questionFor(next, lang)].filter(Boolean).join(" "),
  };
}

function storeOrConfirm(
  state: ConversationState,
  fields: FormField[],
  field: FormField,
  interp: Interpretation,
  heard: string,
  source: AnswerSource,
): { state: ConversationState; reply: string } {
  const lang = state.language;
  const value = (interp.value ?? "").trim();
  const display = (interp.display ?? value).trim();
  if (field.confirm) {
    return {
      state: {
        ...state,
        phase: "confirming",
        currentFieldId: field.id,
        pending: { fieldId: field.id, value, display, heard },
        misses: 0,
      },
      reply: confirmText(field, display, lang),
    };
  }
  const stored = commit(state, field.id, value, display, heard, "answered", source);
  return advance(stored, fields, t(lang, "convThanks"));
}

/**
 * Apply one interpreted utterance to the conversation.
 * Returns the new state and what Saathi should say next.
 */
export function applyTurn(
  prev: ConversationState,
  fields: FormField[],
  interp: Interpretation,
  heard: string,
  source: AnswerSource = "voice",
): { state: ConversationState; reply: string } {
  const lang = prev.language;
  const byId = new Map(fields.map((f) => [f.id, f]));
  let state = withHistory(prev, "user", heard);
  const current = state.currentFieldId ? byId.get(state.currentFieldId) ?? null : null;
  const target =
    interp.targetFieldId && byId.get(interp.targetFieldId)?.aiFillable ? byId.get(interp.targetFieldId)! : null;

  const finish = (r: { state: ConversationState; reply: string }) => ({
    state: withHistory(r.state, "assistant", r.reply),
    reply: r.reply,
  });

  const reAsk = (lead: string, field: FormField | null, withOptions = false) => {
    if (!field) return finish(advance(state, fields, lead));
    return finish({
      state: { ...state, phase: "asking", currentFieldId: field.id },
      reply: [lead, questionFor(field, lang, withOptions)].filter(Boolean).join(" "),
    });
  };

  // Paused: anything brings the conversation back.
  if (state.phase === "paused") {
    state = { ...state, phase: state.pending ? "confirming" : "asking" };
    if (state.pending) {
      const f = byId.get(state.pending.fieldId);
      if (f) return finish({ state, reply: `${t(lang, "convResumed")} ${confirmText(f, state.pending.display, lang)}` });
    }
    return reAsk(t(lang, "convResumed"), current);
  }

  if (interp.intent === "pause") {
    return finish({ state: { ...state, phase: "paused" }, reply: t(lang, "convPaused") });
  }

  if (interp.intent === "finish") {
    return finish({ state: { ...state, phase: "complete", pending: null, currentFieldId: null }, reply: t(lang, "convAllDone") });
  }

  // Confirming a pending answer.
  if (state.phase === "confirming" && state.pending) {
    const pendingField = byId.get(state.pending.fieldId);
    if (!pendingField) return finish(advance({ ...state, pending: null }, fields, ""));
    switch (interp.intent) {
      case "yes": {
        const p = state.pending;
        const stored = commit(state, p.fieldId, p.value, p.display, p.heard, "confirmed", source);
        return finish(advance(stored, fields, t(lang, "convThanks")));
      }
      case "no":
        if (interp.value && interp.valid) {
          return finish(storeOrConfirm({ ...state, pending: null }, fields, pendingField, interp, heard, source));
        }
        return reAsk(t(lang, "convRetry"), pendingField);
      case "answer": {
        const f = target ?? pendingField;
        if (!interp.valid || !interp.value) return reAsk(interp.problem ?? t(lang, "convRetry"), f, true);
        return finish(storeOrConfirm({ ...state, pending: null }, fields, f, interp, heard, source));
      }
      case "repeat":
        return finish({ state, reply: confirmText(pendingField, state.pending.display, lang) });
      case "correct":
        break; // handled below like any other correction
      default:
        return finish({
          state,
          reply: `${t(lang, "convSaidYesNo")} ${confirmText(pendingField, state.pending.display, lang)}`,
        });
    }
  }

  switch (interp.intent) {
    case "answer": {
      const f = target ?? current;
      if (!f) return finish(advance(state, fields, ""));
      if (!interp.valid || !interp.value) {
        const misses = state.misses + 1;
        state = { ...state, misses };
        return reAsk(interp.problem ?? t(lang, "convNotUnderstood"), f, true);
      }
      return finish(storeOrConfirm(state, fields, f, interp, heard, source));
    }
    case "yes":
    case "no": {
      // A plain yes/no answers a tick-box question; anywhere else it is not an answer.
      if (current?.type === "checkbox") {
        const value = interp.intent === "yes" ? "true" : "false";
        const display = interp.intent === "yes" ? t(lang, "yes") : t(lang, "no");
        return finish(
          storeOrConfirm(state, fields, current, { ...interp, intent: "answer", value, display, valid: true }, heard, source),
        );
      }
      state = { ...state, misses: state.misses + 1 };
      return reAsk(t(lang, "convNotUnderstood"), current, true);
    }
    case "repeat":
      return reAsk("", current, true);
    case "resume":
      return reAsk(t(lang, "convResumed"), current);
    case "skip": {
      if (!current) return finish(advance(state, fields, ""));
      const skipped = commit(state, current.id, "", "", heard, "skipped", source);
      return finish(advance(skipped, fields, t(lang, current.required ? "convRequiredSkipped" : "convSkipped")));
    }
    case "dont_know": {
      if (!current) return finish(advance(state, fields, ""));
      const unknown = commit(state, current.id, "", "", heard, "unknown", source);
      return finish(advance(unknown, fields, t(lang, "convDontKnow")));
    }
    case "correct": {
      if (!target) {
        return finish({ state: { ...state, pending: null, phase: "asking" }, reply: t(lang, "convNothingToChange") });
      }
      const returnTo = current && current.id !== target.id ? current.id : state.returnToFieldId;
      const answers = { ...state.answers };
      delete answers[target.id];
      const detour: ConversationState = { ...state, answers, pending: null, returnToFieldId: returnTo, currentFieldId: target.id };
      if (interp.value && interp.valid) {
        return finish(storeOrConfirm(detour, fields, target, interp, heard, source));
      }
      return finish({ state: { ...detour, phase: "asking" }, reply: questionFor(target, lang, true) });
    }
    case "help":
      return reAsk(interp.helpText ?? current?.hint ?? "", current, false);
    case "unclear":
    default: {
      const misses = state.misses + 1;
      state = { ...state, misses };
      return reAsk(t(lang, "convNotUnderstood"), current, true);
    }
  }
}

/** Manual correction from the review screen: always treated as confirmed by the person. */
export function setAnswerManually(
  state: ConversationState,
  field: FormField,
  value: string,
  display: string,
): ConversationState {
  return commit(state, field.id, value, display || value, value, value ? "confirmed" : "unknown", "edited");
}
