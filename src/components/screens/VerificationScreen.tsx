"use client";

import {
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  Clock,
  CloudOff,
  FileText,
  FileUp,
  Fingerprint,
  FlaskConical,
  History,
  Info,
  Link2,
  Link2Off,
  Lock,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { arkivReader, isHash, verifyHashOnArkiv } from "@/lib/arkiv/read";
import { api } from "@/lib/client/api";
import { downloadBlob, sha256Hex } from "@/lib/client/media";
import { formatDate, type StringKey } from "@/lib/i18n";
import type { VerificationEvent, VerificationResult } from "@/lib/types";
import { cn, shortHash } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AppBar, AppScreen, Card, Dock, Page, SectionTitle, SpeakButton, Spinner } from "@/components/common/Chrome";
import { useApp } from "@/components/app/AppContext";

const EVENT_LABEL: Record<VerificationEvent["kind"], StringKey> = {
  approved: "eventApproved",
  stored: "eventStored",
  shared: "eventShared",
  share_revoked: "eventShareRevoked",
  erased: "eventErased",
  other: "eventStored",
};

const EVENT_ICON: Record<VerificationEvent["kind"], LucideIcon> = {
  approved: BadgeCheck,
  stored: Lock,
  shared: Link2,
  share_revoked: Link2Off,
  erased: Trash2,
  other: Lock,
};

type Outcome = "match" | "no_match" | "unavailable";

const OUTCOME_STYLE: Record<Outcome, { icon: LucideIcon; card: string; circle: string; title: string }> = {
  match: { icon: CheckCircle2, card: "border-green-200", circle: "bg-green-100 text-green-700", title: "text-green-900" },
  no_match: { icon: XCircle, card: "border-red-200", circle: "bg-red-100 text-red-700", title: "text-red-900" },
  unavailable: { icon: CloudOff, card: "border-amber-200", circle: "bg-amber-100 text-amber-800", title: "text-amber-950" },
};

const ACCESS_KEY = process.env.NEXT_PUBLIC_ARKIV_ACCESS_KEY ?? "";

/**
 * Document integrity check. The PDF is hashed on this device (Web Crypto) — it is never uploaded.
 * The fingerprint is looked up directly on Arkiv from the browser, so the check does not depend on
 * trusting Saathi's server; the server route is only a fallback when Arkiv cannot be reached.
 */
export function VerificationScreen() {
  const { t, lang, status } = useApp();
  const params = useSearchParams();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [via, setVia] = useState<"browser" | "server" | null>(null);
  const [file, setFile] = useState<{ name: string; bytes: ArrayBuffer } | null>(null);
  const [tampered, setTampered] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const check = useCallback(
    async (hash: string) => {
      setChecking(true);
      setResult(null);
      try {
        const writer = status?.arkiv.writerAddress as Hex | null;
        if (writer) {
          try {
            const r = await verifyHashOnArkiv(arkivReader(ACCESS_KEY), hash, writer);
            setResult(r);
            setVia("browser");
            return;
          } catch {
            // fall back to the server mirror
          }
        }
        setResult(await api.verify(hash));
        setVia("server");
      } catch {
        setResult({ sha256: hash, status: "unavailable", history: [], checkedAgainst: "none" });
      } finally {
        setChecking(false);
      }
    },
    [status],
  );

  // Deep link: /verify?h=<sha256>
  const h = params.get("h");
  useEffect(() => {
    if (status && h && isHash(h) && !file) void check(h);
  }, [status, h, file, check]);

  const onFile = async (f: File) => {
    const bytes = await f.arrayBuffer();
    setFile({ name: f.name, bytes });
    setTampered(false);
    await check(await sha256Hex(bytes));
  };

  /** Demo: change one word in the PDF and verify again — the fingerprint no longer matches. */
  const tamper = async () => {
    if (!file) return;
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.load(file.bytes);
    const page = doc.getPages()[0];
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("EDITED", { x: 36, y: page.getHeight() - 30, size: 10, font, color: rgb(0.8, 0, 0) });
    const bytes = await doc.save();
    const copy = bytes.slice().buffer;
    setFile({ name: `edited-${file.name}`, bytes: copy });
    setTampered(true);
    downloadBlob(new Blob([copy], { type: "application/pdf" }), `edited-${file.name}`);
    await check(await sha256Hex(copy));
  };

  const pickFile = () => fileRef.current?.click();

  const outcome: Outcome | null = !result
    ? null
    : result.status === "match" && result.commitment
      ? "match"
      : result.status === "no_match"
        ? "no_match"
        : "unavailable";
  const showResult = Boolean(result && outcome && !checking);
  const approvedDate = result?.commitment ? formatDate(lang, result.commitment.approvedAt * 1000, true) : "";

  return (
    <AppScreen>
      {/* "Check a document" is cut off in the bar at 375px; the one-word label fits. */}
      <AppBar title={t("verify")} onBack={() => (window.location.href = "/")} />
      <Page dock={showResult}>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />

        {/* Empty state: one big drop-zone style button. */}
        {!result && !checking && (
          <button
            type="button"
            onClick={pickFile}
            aria-label={t("choosePdf")}
            aria-describedby="verify-hint"
            className="mt-4 flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-blue-300 bg-white px-5 py-10 text-center shadow-sm transition-colors hover:border-blue-500 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 active:bg-blue-50"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-blue-50 text-blue-700">
              <FileUp className="size-10" aria-hidden />
            </span>
            <span className="text-xl font-bold text-blue-800">{t("choosePdf")}</span>
            <span id="verify-hint" className="flex max-w-md items-start gap-2 text-base text-slate-500">
              <Lock className="mt-1 size-4 shrink-0" aria-hidden />
              <span>{t("verifyHint")}</span>
            </span>
          </button>
        )}

        {checking && (
          <Card className="mt-4 flex flex-col items-center gap-3 py-12">
            <Spinner label={t("checking")} />
            {file && <p className="max-w-full break-all text-center text-base text-slate-500">{file.name}</p>}
          </Card>
        )}

        <section aria-live="polite">
          {showResult && result && outcome && (
            <>
              <StatusCard
                outcome={outcome}
                title={outcome === "match" ? t("unchanged") : outcome === "no_match" ? t("mismatch") : t("verifyUnavailable")}
                line={outcome === "match" ? t("approvedOn", { date: approvedDate }) : outcome === "no_match" ? t("verifyNoMatchDetail") : null}
                spoken={
                  outcome === "match"
                    ? `${t("verifyMatch")}. ${t("verifyMatchDetail", { date: approvedDate })} ${t("verifyDisclaimer")}`
                    : outcome === "no_match"
                      ? `${t("verifyNoMatch")}. ${t("verifyNoMatchDetail")}`
                      : t("verifyUnavailable")
                }
                expires={
                  outcome === "match" && result.commitment?.expiresAtEstimate
                    ? t("recordExpires", { date: formatDate(lang, result.commitment.expiresAtEstimate) })
                    : null
                }
                fileName={file?.name ?? null}
              />

              {outcome === "match" && result.history.length > 0 && (
                <>
                  <SectionTitle icon={History}>{t("verifyHistory")}</SectionTitle>
                  <Card className="px-4 py-4">
                    <ol>
                      {result.history.map((e, i) => {
                        const EventIcon = EVENT_ICON[e.kind];
                        const last = i === result.history.length - 1;
                        return (
                          <li key={e.entityKey} className="flex gap-3">
                            <div className="flex flex-col items-center" aria-hidden>
                              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                                <EventIcon className="size-5" />
                              </span>
                              {!last && <span className="my-1 w-0.5 flex-1 rounded-full bg-slate-200" />}
                            </div>
                            <div className={cn("min-w-0 flex-1 pt-1", !last && "pb-4")}>
                              <p className="text-lg font-semibold leading-snug text-slate-900">{t(EVENT_LABEL[e.kind])}</p>
                              <p className="text-base text-slate-500">{formatDate(lang, e.at * 1000, true)}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </Card>
                </>
              )}

              <p className="mt-4 flex items-start gap-2 px-1 text-base text-slate-500">
                <Info className="mt-1 size-4 shrink-0" aria-hidden />
                <span>{t("verifyDisclaimer")}</span>
              </p>

              <details className="group mt-4 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-300 [&::-webkit-details-marker]:hidden">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                    <Fingerprint className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 text-lg font-semibold text-slate-900">{t("technicalDetails")}</span>
                  <ChevronDown className="size-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <dl className="divide-y divide-slate-100 border-t border-slate-100">
                  <DetailRow label={`${t("fingerprint")} (SHA-256)`} mono>
                    {result.sha256}
                  </DetailRow>
                  <DetailRow label="Checked against">
                    {result.checkedAgainst === "arkiv"
                      ? `Arkiv Rabdi testnet (chain ${status?.arkiv.chainId}) — ${via === "browser" ? "queried from this browser" : "via server"}`
                      : "—"}
                  </DetailRow>
                  {result.commitment && (
                    <>
                      <DetailRow label="Entity" mono>
                        {result.commitment.entityKey}
                      </DetailRow>
                      <DetailRow label="Written by" mono>
                        {shortHash(result.commitment.creator, 10)}
                      </DetailRow>
                      <DetailRow label="Read-only">{result.commitment.readonly ? "yes — the record can never be changed" : "no"}</DetailRow>
                    </>
                  )}
                </dl>
              </details>

              {status?.demoTools && file && result.status === "match" && !tampered && (
                <Button block variant="secondary" size="md" className="mt-4" onClick={tamper}>
                  <FlaskConical aria-hidden /> {t("demoTamper")}
                </Button>
              )}
            </>
          )}
        </section>
      </Page>

      {showResult && (
        <Dock>
          <Button block size="lg" onClick={pickFile}>
            <FileUp aria-hidden /> {t("checkAnother")}
          </Button>
        </Dock>
      )}
    </AppScreen>
  );
}

/** The big result card: icon in a circle, a two-word verdict, one short line. */
function StatusCard({
  outcome,
  title,
  line,
  spoken,
  expires,
  fileName,
}: {
  outcome: Outcome;
  title: string;
  line: string | null;
  spoken: string;
  expires: string | null;
  fileName: string | null;
}) {
  const s = OUTCOME_STYLE[outcome];
  const StatusIcon = s.icon;
  return (
    <Card className={cn("relative mt-4 flex flex-col items-center gap-2 border-2 px-5 pb-5 pt-8 text-center", s.card)}>
      <SpeakButton text={spoken} className="absolute right-3 top-3" />
      <span className={cn("flex size-16 items-center justify-center rounded-full", s.circle)}>
        <StatusIcon className="size-11" aria-hidden />
      </span>
      <h2 className={cn("mt-2 text-xl font-bold", s.title)}>{title}</h2>
      {line && <p className="max-w-md text-lg text-slate-700">{line}</p>}
      {expires && (
        <p className="flex items-center gap-1.5 text-base text-slate-500">
          <Clock className="size-4 shrink-0" aria-hidden />
          <span>{expires}</span>
        </p>
      )}
      {fileName && (
        <p className="mt-2 flex w-full items-center justify-center gap-2 border-t border-slate-100 pt-3 text-base text-slate-500">
          <FileText className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0 break-all">{fileName}</span>
        </p>
      )}
    </Card>
  );
}

function DetailRow({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className={cn("mt-0.5 text-base text-slate-900", mono && "break-all font-mono")}>{children}</dd>
    </div>
  );
}
