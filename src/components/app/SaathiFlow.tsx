"use client";

import { AnalyzingScreen } from "@/components/screens/AnalyzingScreen";
import { CameraScanner } from "@/components/screens/CameraScanner";
import { DocumentExplanation, DocumentUnderstood } from "@/components/screens/DocumentExplanation";
import { DoneScreen } from "@/components/screens/DoneScreen";
import { FinalVerification } from "@/components/screens/FinalVerification";
import { FormReview } from "@/components/screens/FormReview";
import { VoiceConversation } from "@/components/screens/VoiceConversation";
import { useApp } from "./AppContext";

/** The whole flow is one page with a simple step machine — no dashboard, no navigation to learn. */
export function SaathiFlow() {
  const { state, update, go } = useApp();
  switch (state.step) {
    case "scan":
      return (
        <CameraScanner
          onDocument={(source) => {
            update({ source, preview: null, analysis: null, analysisError: null, conversation: null, generated: null, receipt: null, guide: null, intent: "fill" });
            go("analyzing");
          }}
        />
      );
    case "analyzing":
      return <AnalyzingScreen />;
    case "understood":
      return state.analysis || state.preview ? <DocumentUnderstood /> : null;
    case "explain":
      return state.analysis || state.preview ? <DocumentExplanation /> : null;
    case "conversation":
      return state.analysis && state.conversation ? <VoiceConversation /> : null;
    case "review":
      return state.analysis && state.conversation ? <FormReview /> : null;
    case "final":
      return state.analysis && state.conversation && state.source ? <FinalVerification /> : null;
    case "done":
      return state.generated ? <DoneScreen /> : null;
  }
}
