"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { clearSession } from "@/lib/client/persist";

/**
 * Shown instead of a white page when something breaks (for example a session saved by an older
 * version, or the app updating while it was open). "Start again" drops the saved session and reloads.
 */
export default function ErrorPage({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const startAgain = async () => {
    await clearSession();
    window.location.href = window.location.pathname.startsWith("/s/") || window.location.pathname === "/verify" ? window.location.pathname : "/";
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-white px-6 text-center">
      <h1 className="text-xl font-bold text-slate-900">
        कुछ गड़बड़ हो गई
        <span className="mt-1 block text-[15px] font-medium text-slate-600">Something went wrong</span>
      </h1>
      <button
        type="button"
        onClick={startAgain}
        className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-700 px-5 text-base font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
      >
        <RotateCcw className="size-5" aria-hidden /> फिर से शुरू करें · Start again
      </button>
    </main>
  );
}
