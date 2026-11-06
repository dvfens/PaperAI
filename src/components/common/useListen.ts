"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicError, type ListenSession } from "@/lib/client/recognition";
import { useApp } from "@/components/app/AppContext";
import type { SpeechHint } from "@/lib/types";

export type ListenState = "idle" | "listening" | "processing";
export type ListenError = "denied" | "unavailable" | "unsupported" | "failed" | null;

/**
 * Drives one microphone session at a time and exposes its state for the UI.
 * listen() resolves to the transcript ("" when nothing was heard), null when the microphone failed,
 * or undefined when the session was cancelled (by cancel(), a newer listen() or leaving the screen):
 * a cancelled session must not be treated as "heard nothing".
 */
export function useListen() {
  const { input, lang, stopSpeaking } = useApp();
  const [state, setState] = useState<ListenState>("idle");
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<ListenError>(null);
  const session = useRef<ListenSession | null>(null);
  const cancelled = useRef(new WeakSet<ListenSession>());
  const cancelSession = useCallback((s: ListenSession | null) => {
    if (!s) return;
    cancelled.current.add(s);
    s.cancel();
  }, []);

  const listen = useCallback(async (hint?: SpeechHint): Promise<string | null | undefined> => {
    if (!input) {
      setError("unsupported");
      return null;
    }
    cancelSession(session.current);
    stopSpeaking();
    setError(null);
    setPartial("");
    setState("listening");
    const s = input.listen({
      lang,
      hint,
      onPartial: setPartial,
      onLevel: setLevel,
      onProcessing: () => setState("processing"),
    });
    session.current = s;
    try {
      const text = await s.result;
      return cancelled.current.has(s) ? undefined : text;
    } catch (err) {
      if (cancelled.current.has(s)) return undefined;
      setError(err instanceof MicError ? err.code : "failed");
      return null;
    } finally {
      // A superseded session must not reset the state of the newer one that replaced it.
      if (session.current === s) {
        session.current = null;
        setState("idle");
        setLevel(0);
      }
    }
  }, [input, lang, stopSpeaking, cancelSession]);

  const stop = useCallback(() => session.current?.stop(), []);
  /** True while a session is open (set synchronously by listen(), unlike `state`). */
  const active = useCallback(() => session.current !== null, []);
  const cancel = useCallback(() => cancelSession(session.current), [cancelSession]);

  useEffect(() => () => cancelSession(session.current), [cancelSession]);

  return { state, partial, level, error, listen, stop, cancel, active, supported: Boolean(input) };
}
