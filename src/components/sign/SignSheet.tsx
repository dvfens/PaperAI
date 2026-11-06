"use client";

import { Eraser, Signature } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorKey } from "@/lib/client/api";
import { pagesWithinBudget, pdfToPages, PREVIEW_WIDTH, stampSignature } from "@/lib/client/media";
import { signDocument, signerAddress } from "@/lib/client/signer";
import type { StringKey } from "@/lib/i18n";
import type { SignMethod } from "@/lib/signing";
import type { FieldAnswer } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice, SpeakButton } from "@/components/common/Chrome";
import { useApp } from "@/components/app/AppContext";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";

/**
 * Sign the form with a finger. The signature is drawn into the form's signature boxes (with a
 * signature record page added at the end), and the finished PDF is signed with this phone's key —
 * nothing to install, no account. The signature is recorded on Arkiv only if the person then saves.
 */
export function SignSheet({
  open,
  onOpenChange,
  answers,
  saidYes,
  onSigned,
  onSkip,
}: {
  open: boolean;
  /** The answers written into the form (none when the form was already filled). */
  answers: Record<string, FieldAnswer>;
  onOpenChange: (open: boolean) => void;
  /** The person also said "yes" aloud on the final check. */
  saidYes: boolean;
  onSigned: () => void;
  onSkip: () => void;
}) {
  const { state, update, updateIf, t, speak, stopSpeaking } = useApp();
  const pad = useRef<SignaturePadHandle>(null);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const analysis = state.analysis!;
  const source = state.source!;
  const boxes = analysis.fields.filter((f) => f.type === "signature" && f.box).length;
  const spoken = `${t("signSpoken")} ${boxes ? "" : t("signNoBox")}`.trim();

  useEffect(() => {
    if (!open) return;
    setError(null);
    void speak(spoken);
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sign = async () => {
    setBusy(true);
    setError(null);
    stopSpeaking();
    try {
      const png = await pad.current?.toPng();
      if (!png) return;
      const signedAt = Math.floor(Date.now() / 1000);
      const method: SignMethod = saidYes ? "finger+voice" : "finger";
      const res = await api.generate(
        analysis.fields,
        answers,
        { pdf: source.pdf, pages: pagesWithinBudget(source.pages).map((p) => p.blob) },
        { png, signer: signerAddress(), signedAt, method },
      );
      // The phone's key signs the exact bytes of the finished PDF.
      const proof = await signDocument(res.sha256, signedAt, method);
      // Move on at once: the signature is drawn onto the pages already on screen. Redrawing the whole
      // signed PDF took several seconds on a phone; it now happens in the background and replaces
      // these pages (adding the signature record page) when it is ready.
      const shown = state.generated?.pages ?? [];
      const sigBoxes = analysis.fields.filter((f) => f.type === "signature" && f.box).map((f) => f.box!);
      const quick = shown.length ? await stampSignature(shown, sigBoxes, png).catch(() => null) : null;
      const exact = quick ? null : (await pdfToPages(res.bytes, 4, PREVIEW_WIDTH)).pages;
      update({
        generated: {
          blob: new Blob([res.bytes], { type: "application/pdf" }),
          sha256: res.sha256,
          token: res.token,
          pages: quick ?? exact!,
          skipped: res.skipped,
          signature: proof,
        },
      });
      onSigned();
      if (quick) {
        void pdfToPages(res.bytes, 4, PREVIEW_WIDTH)
          .then(({ pages }) =>
            updateIf(
              (st) => st.generated?.sha256 === res.sha256,
              (st) => ({ generated: { ...st.generated!, pages } }),
            ),
          )
          .catch(() => undefined); // keep the quick pages
      }
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)} title={t("signTitle")} closeLabel={t("close")}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 pt-2 text-[15px] text-slate-700">{t("signLine")}</p>
          <SpeakButton text={spoken} />
        </div>

        <SignaturePad ref={pad} label={t("signArea")} hint={t("signHint")} onInk={setHasInk} />

        {error && <Notice tone="error">{t(error)}</Notice>}

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button size="md" variant="secondary" disabled={!hasInk || busy} onClick={() => pad.current?.clear()}>
            <Eraser aria-hidden /> {t("signClear")}
          </Button>
          <Button size="md" disabled={!hasInk || busy} onClick={sign}>
            <Signature aria-hidden /> {busy ? t("signAdding") : t("signDone")}
          </Button>
        </div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onSkip}>
          {t("signLater")}
        </Button>
      </div>
    </Dialog>
  );
}
