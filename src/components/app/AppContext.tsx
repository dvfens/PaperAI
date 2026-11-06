"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type DocumentPreviewInfo } from "@/lib/client/api";
import type { PreparedPage } from "@/lib/client/media";
import { clearSession, loadSession, saveSession } from "@/lib/client/persist";
import { createSpeechInput, pickProvider, type SpeechInput } from "@/lib/client/recognition";
import { createSpeechOutput, type SpeechOutput } from "@/lib/client/speech";
import { t as translate, type StringKey } from "@/lib/i18n";
import { DEFAULT_LANGUAGE, isEnabledLanguage, type LanguageCode } from "@/lib/i18n/languages";
import type {
  CommitmentReceipt,
  ConversationState,
  DocumentAnalysis,
  NextStepsGuide,
  ServiceStatus,
  SpeechProvider,
  VoiceStyle,
} from "@/lib/types";
import { VOICE_STYLES } from "@/lib/types";

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
  /** Which cloud engine listens and which speaks; switchable when both are configured. */
  voice: {
    stt: SpeechProvider;
    tts: SpeechProvider;
    setStt: (p: SpeechProvider) => void;
    setTts: (p: SpeechProvider) => void;
    /** Which ElevenLabs voice speaks (young woman by default). */
    style: VoiceStyle;
    setStyle: (s: VoiceStyle) => void;
    available: Record<SpeechProvider, boolean>;
  };
}

const AppContext = createContext<Ctx | null>(null);

const LANG_KEY = "saathi.lang";
const STT_KEY = "saathi.stt";
const TTS_KEY = "saathi.tts";
const VOICE_KEY = "saathi.voice";
const isProvider = (v: unknown): v is SpeechProvider => v === "elevenlabs" || v === "openai";

/** `persist` resumes an interrupted form-filling session from this device (main flow only). */
export function AppProvider({ children, persist = false }: { children: ReactNode; persist?: boolean }) {
  const [state, setState] = useState<AppState>(INITIAL);
  const [lang, setLangState] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [hydrated, setHydrated] = useState(!persist);
  const speakerRef = useRef<SpeechOutput>(createSpeechOutput(null));
  // Listening defaults to OpenAI (measured best for normal and distant voices), the voice to
  // ElevenLabs (about 2 s faster to start speaking). Either falls back to whichever is configured.
  const [stt, setSttState] = useState<SpeechProvider>("openai");
  const [tts, setTtsState] = useState<SpeechProvider>("elevenlabs");
  const [style, setStyleState] = useState<VoiceStyle>("young-woman");
  const [engines, setEngines] = useState(0); // bumps when the speech engines are rebuilt
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
      const savedStt = localStorage.getItem(STT_KEY);
      if (isProvider(savedStt)) setSttState(savedStt);
      const savedTts = localStorage.getItem(TTS_KEY);
      if (isProvider(savedTts)) setTtsState(savedTts);
      const savedVoice = localStorage.getItem(VOICE_KEY);
      if (VOICE_STYLES.includes(savedVoice as VoiceStyle)) setStyleState(savedVoice as VoiceStyle);
    } catch {
      // storage unavailable
    }
    api
      .health()
      .then(setStatus)
      .catch(() => {
        inputRef.current = createSpeechInput({ elevenlabs: false, openai: false });
        setEngines((n) => n + 1);
      });
  }, []);

  // (Re)build each speech engine when the service status is known or the person switches it —
  // the voice only when the voice changes, the listener only when the listener changes.
  useEffect(() => {
    if (!status) return;
    const cloud = { elevenlabs: status.elevenlabs, openai: Boolean(status.openai) };
    speakerRef.current.stop();
    speakerRef.current = createSpeechOutput(pickProvider(cloud, tts), style);
    setEngines((n) => n + 1);
  }, [status, tts, style]);
  useEffect(() => {
    if (!status) return;
    inputRef.current = createSpeechInput({ elevenlabs: status.elevenlabs, openai: Boolean(status.openai) }, stt);
    setEngines((n) => n + 1);
  }, [status, stt]);

  const setStt = useCallback((p: SpeechProvider) => {
    setSttState(p);
    try {
      localStorage.setItem(STT_KEY, p);
    } catch {
      // ignore
    }
  }, []);
  const setStyle = useCallback((s: VoiceStyle) => {
    setStyleState(s);
    try {
      localStorage.setItem(VOICE_KEY, s);
    } catch {
      // ignore
    }
  }, []);
  const setTts = useCallback((p: SpeechProvider) => {
    setTtsState(p);
    try {
      localStorage.setItem(TTS_KEY, p);
    } catch {
      // ignore
    }
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
      voice: {
        stt,
        tts,
        setStt,
        setTts,
        style,
        setStyle,
        available: { elevenlabs: Boolean(status?.elevenlabs), openai: Boolean(status?.openai) },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `engines` marks rebuilt speech engines
    [state, update, go, goFrom, reset, lang, setLang, status, speaking, speak, stopSpeaking, stt, tts, setStt, setTts, style, setStyle, engines],
  );

  return <AppContext.Provider value={value}>{hydrated ? children : null}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
