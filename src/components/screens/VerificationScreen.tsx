"use client";

import { CheckCircle2, FileSearch, FlaskConical, ShieldAlert, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { arkivReader, isHash, verifyHashOnArkiv } from "@/lib/arkiv/read";
import { api } from "@/lib/client/api";
import { downloadBlob, sha256Hex } from "@/lib/client/media";
import { formatDate, type StringKey } from "@/lib/i18n";
import type { VerificationEvent, VerificationResult } from "@/lib/types";
import { shortHash } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Notice, Screen, Spinner, TopBar } from "@/components/common/Chrome";
import { useApp } from "@/components/app/AppContext";

const EVENT_LABEL: Record<VerificationEvent["kind"], StringKey> = {
  approved: "eventApproved",
  stored: "eventStored",
  shared: "eventShared",
  share_revoked: "eventShareRevoked",
  erased: "eventErased",
  other: "eventStored",
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

  return (
    <>
      <TopBar onBack={() => (window.location.href = "/")} />
      <Screen>
        <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-900">
          <FileSearch className="size-8 text-blue-700" aria-hidden /> {t("verifyTitle")}
        </h1>
        <p className="mt-2 text-xl text-slate-700">{t("verifyHint")}</p>

        <Button block className="mt-5" onClick={() => fileRef.current?.click()} disabled={checking}>
          <FileSearch aria-hidden /> {t("verifyChoose")}
        </Button>
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
        {file && <p className="mt-2 break-all text-base text-slate-600">{file.name}</p>}

        {checking && (
          <div className="mt-6">
            <Spinner label={t("checking")} />
          </div>
        )}

        {result && !checking && (
          <section className="mt-6" aria-live="polite">
            {result.status === "match" && result.commitment ? (
              <div className="rounded-3xl border-2 border-green-300 bg-green-50 p-5">
                <p className="flex items-center gap-3 text-2xl font-bold text-green-900">
                  <CheckCircle2 className="size-10 shrink-0 text-green-700" aria-hidden /> {t("verifyMatch")}
                </p>
                <p className="mt-2 text-xl text-green-950">
                  {t("verifyMatchDetail", { date: formatDate(lang, result.commitment.approvedAt * 1000, true) })}
                </p>
                {result.commitment.expiresAtEstimate && (
                  <p className="mt-1 text-lg text-green-900">{t("recordExpires", { date: formatDate(lang, result.commitment.expiresAtEstimate) })}</p>
                )}
                {result.history.length > 0 && (
                  <div className="mt-4">
                    <h2 className="text-lg font-semibold text-green-950">{t("verifyHistory")}</h2>
                    <ol className="mt-2 flex flex-col gap-2 border-l-4 border-green-300 pl-4">
                      {result.history.map((e) => (
                        <li key={e.entityKey} className="text-lg text-green-950">
                          <span className="font-semibold">{t(EVENT_LABEL[e.kind])}</span> — {formatDate(lang, e.at * 1000, true)}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ) : result.status === "no_match" ? (
              <div className="rounded-3xl border-2 border-red-300 bg-red-50 p-5">
                <p className="flex items-center gap-3 text-2xl font-bold text-red-900">
                  <XCircle className="size-10 shrink-0 text-red-700" aria-hidden /> {t("verifyNoMatch")}
                </p>
                <p className="mt-2 text-xl text-red-950">{t("verifyNoMatchDetail")}</p>
              </div>
            ) : (
              <Notice tone="warning">
                <span className="flex items-center gap-2">
                  <ShieldAlert className="size-6" aria-hidden /> {t("verifyUnavailable")}
                </span>
              </Notice>
            )}

            <p className="mt-4 text-lg text-slate-700">{t("verifyDisclaimer")}</p>

            <details className="mt-4 rounded-2xl border-2 border-slate-200 p-4">
              <summary className="cursor-pointer text-lg font-semibold text-slate-800">{t("technicalDetails")}</summary>
              <dl className="mt-3 flex flex-col gap-2 text-base text-slate-800">
                <div>
                  <dt className="font-semibold">{t("fingerprint")} (SHA-256)</dt>
                  <dd className="break-all font-mono text-sm">{result.sha256}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Checked against</dt>
                  <dd>
                    {result.checkedAgainst === "arkiv" ? `Arkiv Rabdi testnet (chain ${status?.arkiv.chainId}) — ${via === "browser" ? "queried from this browser" : "via server"}` : "—"}
                  </dd>
                </div>
                {result.commitment && (
                  <>
                    <div>
                      <dt className="font-semibold">Entity</dt>
                      <dd className="break-all font-mono text-sm">{result.commitment.entityKey}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Written by</dt>
                      <dd className="break-all font-mono text-sm">{shortHash(result.commitment.creator, 10)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Read-only</dt>
                      <dd>{result.commitment.readonly ? "yes — the record can never be changed" : "no"}</dd>
                    </div>
                  </>
                )}
              </dl>
            </details>

            {status?.demoTools && file && result.status === "match" && !tampered && (
              <Button block variant="secondary" className="mt-4" onClick={tamper}>
                <FlaskConical aria-hidden /> {t("demoTamper")}
              </Button>
            )}
          </section>
        )}
      </Screen>
    </>
  );
}
