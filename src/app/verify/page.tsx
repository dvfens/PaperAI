import { Suspense } from "react";
import { AppProvider } from "@/components/app/AppContext";
import { VerificationScreen } from "@/components/screens/VerificationScreen";

export const metadata = { title: "Check a document — Saathi" };

export default function VerifyPage() {
  return (
    <AppProvider>
      <Suspense>
        <VerificationScreen />
      </Suspense>
    </AppProvider>
  );
}
