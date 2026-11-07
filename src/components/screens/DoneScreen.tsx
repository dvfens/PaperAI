"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Fingerprint,
  FolderOpen,
  Info,
  Link2,
  ListChecks,
  Lock,
  Nfc,
  Plus,
  Share2,
  ShieldCheck,
  Signature,
  Trash2,
  XCircle,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { forgetFormTitle } from "@/lib/client/form-titles";
import { downloadBlob } from "@/lib/client/media";
import { formatDate, type StringKey } from "@/lib/i18n";
import { isCosignRole } from "@/lib/signing";
import type { VerificationSignature } from "@/lib/types";
import { shortHash } from "@/lib/utils";
import { ROLE_LABEL } from "@/components/sign/CosignSheet";
import { useSaveToCard } from "@/components/nfc/NfcCard";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  AppBar,
  AppScreen,
  Card,
  Chip,
  Dock,
  ListGroup,
  Notice,
  Page,
  SectionTitle,
  Segmented,
  Spinner,
} from "@/components/common/Chrome";
import { AppMenu } from "@/components/common/AppMenu";
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

/** Status chips may hold a full sentence, so they wrap instead of clipping. */
const STATUS_CHIP = "max-w-full rounded-xl px-3 py-1 text-left text-[13px]";

/** Receipt, download, next steps, sharing and deletion. */
export function DoneScreen() {
  const { state, update, reset, t, lang } = useApp();
  const receipt = state.receipt;
  const generated = state.generated!;
  const analysis = state.analysis!;
  const [arkivExpiry, setArkivExpiry] = useState<string | null>(null);
  const [erased, setErased] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const card = useSaveToCard();
  const guideRequested = useRef(false);

  // Next-step guidance.
  useEffect(() => {
    if (state.guide || guideRequested.current) return;
    guideRequested.current = true;
    api
      .guide(lang, analysis, state.intent === "sign" ? {} : (state.conversation?.answers ?? {}))
      // Signed in Paper AI: the signature is already in the form, so "sign here" is not a next step.
      .then((guide) => update({ guide: generated.signature ? { ...guide, steps: guide.steps.filter((s) => s.kind !== "sign") } : guide }))
      .catch(() => undefined);
  }, [state.guide, lang, analysis, state.conversation, state.intent, generated.signature, update]);

  // Retention date read back from the Arkiv commitment entity.
  useEffect(() => {
    if (!receipt) return;
    api
      .receipt(receipt.documentId)
      .then((r) => setArkivExpiry(r.arkivExpiry))
      .catch(() => undefined);
  }, [receipt]);

  const recorded = receipt?.arkiv.status === "recorded" ? receipt.arkiv : null;

  // Who has signed (the person, and anyone who co-signed through a share link), read back from Arkiv —
  // again whenever the person comes back to this screen or closes the share sheet.
  const [signatures, setSignatures] = useState<VerificationSignature[]>([]);
  const sha = receipt?.sha256;
  useEffect(() => {
    if (!recorded || erased || shareOpen || !sha) return;
    let live = true;
    const load = () =>
      api
        .verify(sha)
        .then((v) => live && setSignatures(v.signatures ?? []))
        .catch(() => undefined);
    void load();
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [recorded, erased, shareOpen, sha]);
  const keptUntil = arkivExpiry ?? receipt?.retentionUntil ?? null;

  return (
    <AppScreen>
      <AppBar
        menu={
          <AppMenu
            actions={[{ id: "my-forms", icon: FolderOpen, label: t("myForms"), onSelect: () => (window.location.href = "/forms"), leaves: true }]}
          />
        }
      />
      <Page>
        {/* Success hero */}
        <section className="flex flex-col items-center pt-3 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-green-100 ring-4 ring-green-50">
            <Check className="size-8 text-green-700" strokeWidth={3} aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-bold text-slate-900">{t("readyTitle")}</h1>
          <div className="mt-2.5 flex max-w-full flex-wrap justify-center gap-1.5" role="status">
            {!receipt && (
              <Chip icon={Info} className={STATUS_CHIP}>
                {t("notKept")}
              </Chip>
            )}
            {receipt && !erased && (
              <>
                {recorded ? (
                  <Chip tone="green" icon={ShieldCheck} className={STATUS_CHIP}>
                    {t("protectedChip")}
                  </Chip>
                ) : receipt.arkiv.status === "not_configured" ? (
                  <Chip icon={Info} className={STATUS_CHIP}>
                    {t("notConfigured")}
                  </Chip>
                ) : (
                  <Chip tone="amber" icon={AlertTriangle} className={STATUS_CHIP}>
                    {t("notRecorded")}
                  </Chip>
                )}
                {receipt.signature && (
                  <Chip tone="green" icon={Signature} className={STATUS_CHIP}>
                    {t("statusSigned")}
                  </Chip>
                )}
                {keptUntil && (
                  <Chip tone={recorded ? "green" : "blue"} icon={Lock} className={STATUS_CHIP}>
                    {t("safeUntil", { date: formatDate(lang, keptUntil) })}
                  </Chip>
                )}
              </>
            )}
            {erased && (
              <Chip icon={Trash2} className={STATUS_CHIP}>
                {t("deleted")}
              </Chip>
            )}
          </div>
        </section>

        {/* The person's two jobs from here: keep the form, and get it to whoever needs it.
            Checking a document is the recipient's job — it lives on the share link and /verify. */}
        <div className="mt-5 flex flex-col gap-2.5">
          <Button block size="lg" onClick={() => downloadBlob(generated.blob, "completed-form.pdf")}>
            <Download aria-hidden /> {t("saveForm")}
          </Button>
          {receipt && !erased && (
            <Button block size="lg" variant="secondary" onClick={() => setShareOpen(true)}>
              <Share2 aria-hidden /> {t("sendForm")}
            </Button>
          )}
          {receipt && !erased && card.supported && (
            <Button block size="lg" variant="secondary" onClick={() => void card.start(receipt.documentId)}>
              <Nfc aria-hidden /> {t("nfcSave")}
            </Button>
          )}
        </div>

        {signatures.length > 0 && !erased && (
          <>
            <SectionTitle icon={Signature}>{t("verifySignatures")}</SectionTitle>
            <ListGroup>
              {signatures.map((s) => (
                <div key={s.entityKey} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700" aria-hidden>
                    <CheckCircle2 className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-slate-900">
                      {isCosignRole(s.role) ? t(ROLE_LABEL[s.role]) : t("roleYou")}
                    </span>
                    <span className="block text-[13px] text-slate-600">{formatDate(lang, s.signedAt * 1000, true)}</span>
                  </span>
                </div>
              ))}
            </ListGroup>
          </>
        )}

        {/* Next steps */}
        {state.guide ? (
          <StepByStepGuide guide={state.guide} pages={generated.pages} />
        ) : (
          <>
            <SectionTitle icon={ListChecks}>{t("nextSteps")}</SectionTitle>
            <Card>
              <Spinner label={t("loading")} />
            </Card>
          </>
        )}

        {/* Technical details + delete */}
        {receipt && (
          <>
            <SectionTitle icon={Info}>{t("details")}</SectionTitle>
            <ListGroup>
              <details className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-300 active:bg-slate-100 [&::-webkit-details-marker]:hidden">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                    <Fingerprint className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-slate-900">{t("technicalDetails")}</span>
                    <span className="block truncate font-mono text-xs text-slate-500">{shortHash(receipt.sha256)}</span>
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <dl className="flex flex-col gap-2.5 border-t border-slate-100 px-4 py-3">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">{t("fingerprint")} (SHA-256)</dt>
                    <dd className="mt-0.5 break-all font-mono text-[13px] text-slate-900">{receipt.sha256}</dd>
                  </div>
                  {receipt.signature && (
                    <div>
                      <dt className="text-xs font-medium text-slate-500">{t("sigKey")}</dt>
                      <dd className="mt-0.5 break-all font-mono text-[13px] text-slate-900">{receipt.signature.signer}</dd>
                    </div>
                  )}
                  {recorded && (
                    <>
                      <div>
                        <dt className="text-xs font-medium text-slate-500">Arkiv entity</dt>
                        <dd className="mt-0.5 break-all font-mono text-[13px] text-slate-900">{recorded.commitmentKey}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-slate-500">Transaction</dt>
                        <dd>
                          <a
                            href={recorded.explorerTxUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex min-h-10 items-center gap-1 rounded-lg font-mono text-[13px] text-blue-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
                          >
                            {shortHash(recorded.txHash)} <ExternalLink className="size-4" aria-hidden />
                          </a>
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </details>
              {!erased && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-red-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-red-300 active:bg-red-100"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700">
                    <Trash2 className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-semibold text-red-700">{t("deleteDocument")}</span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
                </button>
              )}
            </ListGroup>
          </>
        )}
      </Page>

      <Dock>
        <Button block size="lg" variant="secondary" onClick={reset}>
          <Plus aria-hidden /> {t("newDoc")}
        </Button>
      </Dock>

      {card.sheet}
      {receipt && !erased && <ShareSection documentId={receipt.documentId} open={shareOpen} onOpenChange={setShareOpen} />}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t("deleteDocument")} description={t("deleteConfirm")} closeLabel={t("close")}>
        <div className="flex flex-col gap-3">
          <Button
            block
            variant="danger"
            onClick={async () => {
              await api.erase(receipt!.documentId).catch(() => undefined);
              forgetFormTitle(receipt!.documentId);
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
    </AppScreen>
  );
}

/**
 * Share links in a bottom sheet. The component stays mounted while the sheet is closed so the
 * links made in this visit (and their stop buttons) are still there when it is opened again.
 */
export function ShareSection({ documentId, open, onOpenChange }: { documentId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
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
    <Dialog open={open} onOpenChange={onOpenChange} title={t("shareTitle")} description={`${t("shareHint")} ${t("cosignInvite")}`} closeLabel={t("close")}>
      <div className="flex flex-col gap-4 pb-2">
        <div>
          <p className="mb-1.5 px-1 text-[13px] font-semibold text-slate-600" aria-hidden>
            {t("linkFor")}
          </p>
          <Segmented label={t("linkFor")} options={options.map((o) => ({ value: o.h, label: t(o.label) }))} value={hours} onChange={setHours} />
        </div>

        <Button block size="lg" onClick={create} disabled={busy}>
          <Link2 aria-hidden /> {busy ? t("loading") : t("createLink")}
        </Button>

        {error && <Notice tone="error">{t(error)}</Notice>}

        {shares.length > 0 && (
          <ul className="flex flex-col gap-3">
            {shares.map((s) =>
              s.revoked ? (
                <li key={s.shareId} className="flex items-center gap-2.5 rounded-xl bg-slate-100 px-3 py-2.5 text-[15px] font-semibold text-slate-600">
                  <XCircle className="size-5 shrink-0" aria-hidden /> {t("linkStopped")}
                </li>
              ) : (
                <li key={s.shareId} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Chip tone="green" icon={Clock} className={STATUS_CHIP}>
                      {t("linkActiveUntil", { date: formatDate(lang, s.expiresAt, true) })}
                    </Chip>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.qr} alt="QR" className="size-40 rounded-xl border border-slate-200 bg-white p-2" />
                    <p className="break-all font-mono text-xs text-slate-500">{s.url}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="md"
                      variant="secondary"
                      className="min-w-0 flex-1 basis-40"
                      onClick={async () => {
                        await navigator.clipboard?.writeText(s.url).catch(() => undefined);
                        setCopied(s.shareId);
                      }}
                    >
                      {copied === s.shareId ? <Check aria-hidden /> : <Copy aria-hidden />} {copied === s.shareId ? t("copied") : t("copyLink")}
                    </Button>
                    <Button size="md" variant="danger" className="min-w-0 flex-1 basis-40" onClick={() => revoke(s.shareId)}>
                      <XCircle aria-hidden /> {t("cancelLink")}
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
