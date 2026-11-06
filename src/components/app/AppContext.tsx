"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type DocumentPreviewInfo } from "@/lib/client/api";
import type { PreparedPage } from "@/lib/client/media";
import { clearSession, loadSession, saveSession } from "@/lib/client/persist";
import { createSpeechInput, type SpeechInput } from "@/lib/client/recognition";
import { createSpeechOutput, type SpeechOutput } from "@/lib/client/speech";
import { t as translate, type StringKey } from "@/lib/i18n";
import { DEFAULT_LANGUAGE, isEnabledLanguage, type LanguageCode } from "@/lib/i18n/languages";
import type {
  CommitmentReceipt,
  ConversationState,
  DocumentAnalysis,
  NextStepsGuide,
  ServiceStatus,
} from "@/lib/types";

export type Step = "scan" | "analyzing" | "understood" | "explain" | "conversation" | "review" | "final" | "done";

export interface SourceDocument {
  kind: "pdf" | "image";
  pdf: Blob | null;
  pages: PreparedPage[];
  pageCount: number;
}

export interface GeneratedDocument {
  blob: Blob;
  sha256: string;
  token: string;
  pages: PreparedPage[];
  skipped: string[];
}

export interface AppState {
  step: Step;
  source: SourceDocument | null;
  /** Quick stage-1 understanding, shown while the full field analysis is still running. */
  preview: DocumentPreviewInfo | null;
  analysis: DocumentAnalysis | null;
  /** Set when the full analysis failed after the preview was already shown. */
  analysisError: StringKey | null;
  conversation: ConversationState | null;
  generated: GeneratedDocument | null;
  receipt: CommitmentReceipt | null;
  guide: NextStepsGuide | null;
  /** How the final approval was given ("voice+tap" when the person also said yes aloud). */
  approvalMethod: "voice+tap" | "tap";
}

const INITIAL: AppState = {
  step: "scan",
  source: null,
  preview: null,
  analysis: null,
  analysisError: null,
  conversation: null,
  generated: null,
  receipt: null,
  guide: null,
  approvalMethod: "tap",
};

interface Ctx {
  state: AppState;
  update: (patch: Partial<AppState>) => void;
  go: (step: Step) => void;
  /** Move to `to` only if the flow is still at `from` (for results that arrive late). */
  goFrom: (from: Step, to: Step) => void;
  reset: () => void;
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  status: ServiceStatus | null;
  // voice
  speaker: SpeechOutput;
  input: SpeechInput | null;
  speaking: boolean;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
}

const AppContext = createContext<Ctx | null>(null);

const LANG_KEY = "saathi.lang";

/** `persist` resumes an interrupted form-filling session from this device (main flow only). */
export function AppProvider({ children, persist = false }: { children: ReactNode; persist?: boolean }) {
  const [state, setState] = useState<AppState>(INITIAL);
  const [lang, setLangState] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [hydrated, setHydrated] = useState(!persist);
  const speakerRef = useRef<SpeechOutput>(createSpeechOutput(false));
  const inputRef = useRef<SpeechInput | null>(null);
  const speakSeq = useRef(0);

  // Resume an interrupted session (kept only on this device, see lib/client/persist.ts).
  useEffect(() => {
    if (!persist) return;
    const startingSample = new URLSearchParams(window.location.search).has("sample");
    (startingSample ? clearSession().then(() => null) : loadSession<AppState>())
      .then((saved) => {
        if (saved && saved.step !== "scan") setState({ ...INITIAL, ...saved });
      })
      .finally(() => setHydrated(true));
  }, [persist]);

  useEffect(() => {
    if (!persist || !hydrated) return;
    const id = setTimeout(() => {
      if (state.step === "scan") void clearSession();
      else void saveSession(state);
    }, 400);
    return () => clearTimeout(id);
  }, [state, persist, hydrated]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (isEnabledLanguage(saved)) setLangState(saved);
    } catch {
      // storage unavailable
    }
    api
      .health()
      .then((s) => {
        setStatus(s);
        speakerRef.current = createSpeechOutput(s.elevenlabs);
        inputRef.current = createSpeechInput(s.elevenlabs);
      })
      .catch(() => {
        inputRef.current = createSpeechInput(false);
      });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: LanguageCode) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  const update = useCallback((patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch })), []);
  const go = useCallback((step: Step) => {
    speakerRef.current.stop();
    setState((s) => ({ ...s, step }));
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);
  const goFrom = useCallback((from: Step, to: Step) => {
    setState((s) => (s.step === from ? { ...s, step: to } : s));
  }, []);
  const reset = useCallback(() => {
    speakerRef.current.stop();
    void clearSession();
    setState(INITIAL);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const seq = ++speakSeq.current;
      setSpeaking(true);
      try {
        await speakerRef.current.speak(text, lang);
      } finally {
        if (seq === speakSeq.current) setSpeaking(false);
      }
    },
    [lang],
  );
  const stopSpeaking = useCallback(() => {
    speakSeq.current++;
    speakerRef.current.stop();
    setSpeaking(false);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      state,
      update,
      go,
      goFrom,
      reset,
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      status,
      speaker: speakerRef.current,
      input: inputRef.current,
      speaking,
      speak,
      stopSpeaking,
    }),
    [state, update, go, goFrom, reset, lang, setLang, status, speaking, speak, stopSpeaking],
  );

  return <AppContext.Provider value={value}>{hydrated ? children : null}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
