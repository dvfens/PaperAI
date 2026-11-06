"use client";

import { CheckCircle2, Copy, Download, ExternalLink, Link2, Plus, ShieldCheck, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { downloadBlob } from "@/lib/client/media";
import { formatDate, type StringKey } from "@/lib/i18n";
import { cn, shortHash } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice, Screen, Spinner, TopBar } from "@/components/common/Chrome";
import { useApp } from "@/components/app/AppContext";
import { StepByStepGuide } from "./StepByStepGuide";

interface ShareInfo {
  shareId: string;
  url: string;
  expiresAt: string;
  qr: string;
  revoked: boolean;
  txUrl: string | null;
}

/** Receipt, download, next steps, sharing and deletion. */
export function DoneScreen() {
  const { state, update, reset, t, lang } = useApp();
  const receipt = state.receipt;
  const generated = state.generated!;
  const analysis = state.analysis!;
  const [arkivExpiry, setArkivExpiry] = useState<string | null>(null);
  const [erased, setErased] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const guideRequested = useRef(false);

  // Next-step guidance.
  useEffect(() => {
    if (state.guide || guideRequested.current) return;
    guideRequested.current = true;
    api
      .guide(lang, analysis, state.conversation!.answers)
      .then((guide) => update({ guide }))
      .catch(() => undefined);
  }, [state.guide, lang, analysis, state.conversation, update]);

  // Retention date read back from the Arkiv commitment entity.
  useEffect(() => {
    if (!receipt) return;
    api
      .receipt(receipt.documentId)
      .then((r) => setArkivExpiry(r.arkivExpiry))
      .catch(() => undefined);
  }, [receipt]);

  const recorded = receipt?.arkiv.status === "recorded" ? receipt.arkiv : null;
  const keptUntil = arkivExpiry ?? receipt?.retentionUntil ?? null;

  return (
    <>
      <TopBar />
      <Screen>
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 className="size-20 text-green-700" aria-hidden />
          <h1 className="mt-3 text-3xl font-bold text-slate-900">{t("doneTitle")}</h1>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <Button block onClick={() => downloadBlob(generated.blob, "completed-form.pdf")}>
            <Download aria-hidden /> {t("downloadPdf")}
          </Button>
          {!receipt && <Notice tone="info">{t("notKept")}</Notice>}
          {receipt && !erased && (
            <Notice tone={recorded ? "success" : receipt.arkiv.status === "not_configured" ? "info" : "warning"}>
              <p className="flex items-start gap-2 font-semibold">
                {recorded && <ShieldCheck className="mt-0.5 size-6 shrink-0 text-green-700" aria-hidden />}
                {recorded ? t("recorded") : receipt.arkiv.status === "not_configured" ? t("notConfigured") : t("notRecorded")}
              </p>
              {keptUntil && <p className="mt-1">{t("keptUntil", { date: formatDate(lang, keptUntil) })}</p>}
            </Notice>
          )}
          {erased && <Notice tone="info">{t("deleted")}</Notice>}
        </div>

        <div className="mt-8">
          {state.guide ? <StepByStepGuide guide={state.guide} pages={generated.pages} /> : <Spinner label={t("loading")} />}
        </div>

        {receipt && !erased && <ShareSection documentId={receipt.documentId} />}

        {receipt && (
          <details className="mt-8 rounded-2xl border-2 border-slate-200 p-4">
            <summary className="cursor-pointer text-lg font-semibold text-slate-800">{t("technicalDetails")}</summary>
            <dl className="mt-3 flex flex-col gap-2 text-base text-slate-800">
              <div>
                <dt className="font-semibold">{t("fingerprint")} (SHA-256)</dt>
                <dd className="break-all font-mono text-sm">{receipt.sha256}</dd>
              </div>
              {recorded && (
                <>
                  <div>
                    <dt className="font-semibold">Arkiv entity</dt>
                    <dd className="break-all font-mono text-sm">{recorded.commitmentKey}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Transaction</dt>
                    <dd>
                      <a href={recorded.explorerTxUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-sm text-blue-800 underline">
                        {shortHash(recorded.txHash)} <ExternalLink className="size-4" aria-hidden />
                      </a>
                    </dd>
                  </div>
                </>
              )}
            </dl>
            <Link href={`/verify?h=${receipt.sha256}`} className="mt-3 inline-flex min-h-12 items-center gap-2 text-lg font-semibold text-blue-800 underline">
              <ShieldCheck className="size-5" aria-hidden /> {t("checkDocument")}
            </Link>
          </details>
        )}

        <div className="mt-8 flex flex-col gap-3 pb-safe">
          {receipt && !erased && (
            <Button block variant="danger" size="md" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden /> {t("deleteDocument")}
            </Button>
          )}
          <Button block variant="secondary" onClick={reset}>
            <Plus aria-hidden /> {t("newDocument")}
          </Button>
        </div>
      </Screen>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t("deleteDocument")} description={t("deleteConfirm")} closeLabel={t("close")}>
        <div className="flex flex-col gap-3">
          <Button
            block
            variant="danger"
            onClick={async () => {
              await api.erase(receipt!.documentId).catch(() => undefined);
              setErased(true);
              setConfirmDelete(false);
            }}
          >
            <Trash2 aria-hidden /> {t("deleteDocument")}
          </Button>
          <Button block variant="secondary" onClick={() => setConfirmDelete(false)}>
            {t("cancel")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function ShareSection({ documentId }: { documentId: string }) {
  const { t, lang } = useApp();
  const [hours, setHours] = useState<1 | 24 | 168>(24);
  const [shares, setShares] = useState<ShareInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.createShare(documentId, hours);
      const qr = await QRCode.toDataURL(s.url, { margin: 1, width: 240 });
      setShares((prev) => [{ shareId: s.shareId, url: s.url, expiresAt: s.expiresAt, qr, revoked: false, txUrl: s.arkiv?.explorerTxUrl ?? null }, ...prev]);
    } catch {
      setError("errorGeneric");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (shareId: string) => {
    await api.revokeShare(documentId, shareId).catch(() => undefined);
    setShares((prev) => prev.map((s) => (s.shareId === shareId ? { ...s, revoked: true } : s)));
  };

  const options: { h: 1 | 24 | 168; label: StringKey }[] = [
    { h: 1, label: "share1h" },
    { h: 24, label: "share24h" },
    { h: 168, label: "share7d" },
  ];

  return (
    <section className="mt-8 rounded-3xl border-2 border-slate-200 p-5">
      <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
        <Link2 className="size-7 text-blue-700" aria-hidden /> {t("shareTitle")}
      </h2>
      <p className="mt-1 text-lg text-slate-700">{t("shareHint")}</p>
      <p className="mt-4 text-lg font-semibold text-slate-900">{t("shareFor")}</p>
      <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup">
        {options.map((o) => (
          <button
            key={o.h}
            role="radio"
            aria-checked={hours === o.h}
            onClick={() => setHours(o.h)}
            className={cn(
              "min-h-14 rounded-2xl border-2 text-lg font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
              hours === o.h ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-900",
            )}
          >
            {t(o.label)}
          </button>
        ))}
      </div>
      <Button block size="md" className="mt-3" onClick={create} disabled={busy}>
        <Link2 aria-hidden /> {busy ? t("loading") : t("createLink")}
      </Button>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{t(error)}</Notice>
        </div>
      )}
      <ul className="mt-4 flex flex-col gap-4">
        {shares.map((s) => (
          <li key={s.shareId} className={cn("rounded-2xl border-2 p-4", s.revoked ? "border-slate-200 opacity-60" : "border-blue-200")}>
            {s.revoked ? (
              <p className="flex items-center gap-2 text-lg font-semibold text-slate-700">
                <XCircle className="size-6" aria-hidden /> {t("linkStopped")}
              </p>
            ) : (
              <>
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.qr} alt="QR" className="size-40 rounded-lg border border-slate-200" />
                  <div className="min-w-0 flex-1">
                    <p className="text-lg text-slate-800">{t("linkActiveUntil", { date: formatDate(lang, s.expiresAt, true) })}</p>
                    <p className="mt-1 break-all font-mono text-sm text-slate-600">{s.url}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      await navigator.clipboard?.writeText(s.url).catch(() => undefined);
                      setCopied(s.shareId);
                    }}
                  >
                    <Copy aria-hidden /> {copied === s.shareId ? t("copied") : t("copyLink")}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => revoke(s.shareId)}>
                    <XCircle aria-hidden /> {t("cancelLink")}
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
