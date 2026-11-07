"use client";

import { CheckCircle2, ShieldAlert, SmartphoneNfc } from "lucide-react";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client/api";
import { buzz, listenForCards, NfcError, nfcAvailable, startNfc, writeCardLink, type NfcProblem } from "@/lib/client/nfc";
import { formatDate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice, Spinner } from "@/components/common/Chrome";
import { useApp } from "@/components/app/AppContext";

const noSubscribe = () => () => undefined;

/** True only where Web NFC works (Chrome on Android). False on the server, so the first render matches. */
export function useNfc(): boolean {
  return useSyncExternalStore(noSubscribe, nfcAvailable, () => false);
}

const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === "AbortError";

/** The "hold your card here" picture shown while the phone waits for the card. */
function HoldCard({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <span className="relative flex size-20 items-center justify-center rounded-full bg-blue-50 text-blue-700">
        <span className="absolute inset-0 animate-ping rounded-full bg-blue-100 opacity-60 motion-reduce:hidden" aria-hidden />
        <SmartphoneNfc className="relative size-9" aria-hidden />
      </span>
      <p className="max-w-xs text-[15px] font-medium text-slate-800" role="status">
        {text}
      </p>
      {children}
    </div>
  );
}

type SaveJob =
  | { phase: "preparing" }
  | { phase: "hold" }
  | { phase: "done"; until: string }
  | { phase: "error"; problem: NfcProblem | "errorGeneric" };

/**
 * "Save on NFC card": writes a card link to the form (a share link that lasts as long as the form is
 * kept) onto the card. Call start() straight from the button's click — Chrome asks for NFC only during
 * a tap — and render `sheet`.
 */
export function useSaveToCard() {
  const { t, lang } = useApp();
  const supported = useNfc();
  const [target, setTarget] = useState<string | null>(null);
  const [job, setJob] = useState<SaveJob>({ phase: "preparing" });
  const ctl = useRef<AbortController | null>(null);
  // One card link per form in this visit: trying again, or writing a second card, reuses it.
  const links = useRef(new Map<string, { url: string; expiresAt: string }>());

  const start = useCallback(async (documentId: string) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setTarget(documentId);
    setJob({ phase: "preparing" });
    try {
      // NFC first (the permission prompt needs the tap), then the link. The scan keeps running until
      // the sheet closes, so the card comes to Paper AI instead of opening its old link.
      const reader = await startNfc(c.signal);
      let link = links.current.get(documentId);
      if (!link) {
        const s = await api.createShare(documentId, "kept");
        link = { url: s.url, expiresAt: s.expiresAt };
        links.current.set(documentId, link);
      }
      if (c.signal.aborted) return;
      setJob({ phase: "hold" });
      await writeCardLink(reader, link.url, c.signal);
      buzz();
      setJob({ phase: "done", until: link.expiresAt });
    } catch (err) {
      if (c.signal.aborted || isAbort(err)) return;
      setJob({ phase: "error", problem: err instanceof NfcError ? err.problem : "errorGeneric" });
    }
  }, []);

  const close = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setTarget(null);
  }, []);

  const sheet = (
    <Dialog open={target !== null} onOpenChange={(o) => !o && close()} title={t("nfcSaveTitle")} closeLabel={t("close")}>
      <div className="flex flex-col gap-4 pb-2">
        {job.phase === "preparing" && (
          <div className="flex justify-center py-6">
            <Spinner label={t("nfcPreparing")} />
          </div>
        )}
        {job.phase === "hold" && (
          <HoldCard text={t("nfcHold")}>
            <p className="max-w-xs text-[13px] text-slate-500">{t("nfcReplaces")}</p>
          </HoldCard>
        )}
        {job.phase === "done" && (
          <div className="flex flex-col items-center gap-3 py-2 text-center" role="status">
            <span className="flex size-16 items-center justify-center rounded-full bg-green-100 ring-4 ring-green-50">
              <CheckCircle2 className="size-8 text-green-700" aria-hidden />
            </span>
            <p className="text-[17px] font-semibold text-slate-900">{t("nfcSaved")}</p>
            <p className="max-w-sm text-[15px] text-slate-700">{t("nfcSavedHint", { date: formatDate(lang, job.until) })}</p>
            <p className="flex max-w-sm items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-[13px] text-amber-950">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("nfcKeepSafe")}
            </p>
          </div>
        )}
        {job.phase === "error" && (
          <>
            <Notice tone="error">{t(job.problem)}</Notice>
            <Button block size="lg" onClick={() => target && void start(target)}>
              {t("tryAgain")}
            </Button>
          </>
        )}
        <Button block size="lg" variant={job.phase === "done" ? "primary" : "secondary"} onClick={close}>
          {job.phase === "done" ? t("nfcDone") : t("cancel")}
        </Button>
      </div>
    </Dialog>
  );

  return { supported, start, sheet };
}

type OpenJob = { phase: "hold"; other: boolean } | { phase: "opening" } | { phase: "error"; problem: NfcProblem };

/**
 * "Open a form from my NFC card": waits for a card and opens the Paper AI form link on it. Call start()
 * straight from a click, and render `sheet` (with `onCloseAutoFocus` to put focus back where it was).
 */
export function useOpenFromCard(onCloseAutoFocus?: (event: Event) => void) {
  const { t } = useApp();
  const supported = useNfc();
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<OpenJob>({ phase: "hold", other: false });
  const ctl = useRef<AbortController | null>(null);

  const start = useCallback(async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setOpen(true);
    setJob({ phase: "hold", other: false });
    try {
      const reader = await startNfc(c.signal);
      const stop = listenForCards(
        reader,
        (url) => {
          stop();
          buzz();
          setJob({ phase: "opening" });
          window.location.href = url;
        },
        () => setJob({ phase: "hold", other: true }),
      );
      c.signal.addEventListener("abort", stop);
    } catch (err) {
      if (c.signal.aborted || isAbort(err)) return;
      setJob({ phase: "error", problem: err instanceof NfcError ? err.problem : "nfcNoReader" });
    }
  }, []);

  const close = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setOpen(false);
  }, []);

  const sheet = (
    <Dialog open={open} onOpenChange={(o) => !o && close()} onCloseAutoFocus={onCloseAutoFocus} title={t("nfcOpenTitle")} closeLabel={t("close")}>
      <div className="flex flex-col gap-4 pb-2">
        {job.phase === "hold" && (
          <HoldCard text={t("nfcOpenHold")}>{job.other && <Notice tone="warning">{t("nfcNotOurs")}</Notice>}</HoldCard>
        )}
        {job.phase === "opening" && (
          <div className="flex justify-center py-6">
            <Spinner label={t("nfcOpening")} />
          </div>
        )}
        {job.phase === "error" && (
          <>
            <Notice tone="error">{t(job.problem)}</Notice>
            <Button block size="lg" onClick={() => void start()}>
              {t("tryAgain")}
            </Button>
          </>
        )}
        <Button block size="lg" variant="secondary" onClick={close}>
          {t("cancel")}
        </Button>
      </div>
    </Dialog>
  );

  return { supported, start, sheet };
}
