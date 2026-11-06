import { Suspense } from "react";
import { AppProvider } from "@/components/app/AppContext";
import { VerificationScreen } from "@/components/screens/VerificationScreen";

export const metadata = { title: "Check a document — Paper AI" };

export default function VerifyPage() {
  return (
    // Suspense wraps the provider, not the other way round: otherwise the provider hydrates first,
    // applies the saved language, and the screen then hydrates in a different language than the
    // server rendered (hydration mismatch).
    <Suspense>
      <AppProvider>
        <VerificationScreen />
      </AppProvider>
    </Suspense>
  );
}
