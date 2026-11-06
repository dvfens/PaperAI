"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicError, type ListenSession } from "@/lib/client/recognition";
import { useApp } from "@/components/app/AppContext";

export type ListenState = "idle" | "listening" | "processing";
export type ListenError = "denied" | "unavailable" | "unsupported" | "failed" | null;

/** Drives one microphone session at a time and exposes its state for the UI. */
export function useListen() {
  const { input, lang, stopSpeaking } = useApp();
  const [state, setState] = useState<ListenState>("idle");
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<ListenError>(null);
  const session = useRef<ListenSession | null>(null);

  const listen = useCallback(async (): Promise<string | null> => {
    if (!input) {
      setError("unsupported");
      return null;
    }
    session.current?.cancel();
    stopSpeaking();
    setError(null);
    setPartial("");
    setState("listening");
    const s = input.listen({
      lang,
      onPartial: setPartial,
      onLevel: setLevel,
      onProcessing: () => setState("processing"),
    });
    session.current = s;
    try {
      return await s.result;
    } catch (err) {
      setError(err instanceof MicError ? err.code : "failed");
      return null;
    } finally {
      if (session.current === s) session.current = null;
      setState("idle");
      setLevel(0);
    }
  }, [input, lang, stopSpeaking]);

  const stop = useCallback(() => session.current?.stop(), []);
  const cancel = useCallback(() => session.current?.cancel(), []);

  useEffect(() => () => session.current?.cancel(), []);

  return { state, partial, level, error, listen, stop, cancel, supported: Boolean(input) };
}
