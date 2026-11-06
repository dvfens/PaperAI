"use client";

import { AnalyzingScreen } from "@/components/screens/AnalyzingScreen";
import { CameraScanner } from "@/components/screens/CameraScanner";
import { DocumentExplanation, DocumentUnderstood } from "@/components/screens/DocumentExplanation";
import { DoneScreen } from "@/components/screens/DoneScreen";
import { FinalVerification } from "@/components/screens/FinalVerification";
import { FormReview } from "@/components/screens/FormReview";
import { VoiceConversation } from "@/components/screens/VoiceConversation";
import { DesktopHome } from "@/components/screens/DesktopHome";
import { useIsComputer } from "@/lib/client/useIsComputer";
import { useEffect, useState } from "react";
import { useApp, type SourceDocument } from "./AppContext";

/** Nothing to show for this step (its data is missing): go back to the camera. */
function StartOver() {
  const { reset } = useApp();
  useEffect(() => reset(), [reset]);
  return null;
}

/**
 * First screen: the camera on a phone or tablet; on a computer, an upload page (a webcam cannot
 * scan paper well). The computer page can still open the camera if the person asks for it.
 */
function StartScreen({ onDocument }: { onDocument: (doc: SourceDocument) => void }) {
  const computer = useIsComputer();
  const [webcam, setWebcam] = useState(false);
  // Until the device is known, show nothing rather than start the camera on a computer.
  if (computer === null) return <div className="min-h-dvh bg-slate-50" />;
  if (computer && !webcam) return <DesktopHome onDocument={onDocument} onUseCamera={() => setWebcam(true)} />;
  return <CameraScanner onDocument={onDocument} onBack={computer ? () => setWebcam(false) : undefined} />;
}

/** The whole flow is one page with a simple step machine — no dashboard, no navigation to learn. */
export function SaathiFlow() {
  const { state, update, go } = useApp();
  switch (state.step) {
    case "scan":
      return (
        <StartScreen
          onDocument={(source) => {
            update({ source, preview: null, analysis: null, analysisError: null, conversation: null, generated: null, receipt: null, guide: null, intent: "fill" });
            go("analyzing");
          }}
        />
      );
    case "analyzing":
      return <AnalyzingScreen />;
    case "understood":
      return state.analysis || state.preview ? <DocumentUnderstood /> : <StartOver />;
    case "explain":
      return state.analysis || state.preview ? <DocumentExplanation /> : <StartOver />;
    case "conversation":
      return state.analysis && state.conversation ? <VoiceConversation /> : <StartOver />;
    case "review":
      return state.analysis && state.conversation ? <FormReview /> : <StartOver />;
    case "final":
      return state.analysis && state.conversation && state.source ? <FinalVerification /> : <StartOver />;
    case "done":
      return state.generated ? <DoneScreen /> : <StartOver />;
    default:
      return <StartOver />;
  }
}
