"use client";

import { CheckCircle2, Clock, Download, ExternalLink, FileText, Info, Link2Off, ShieldCheck, Signature } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { pdfToPages, sha256Hex, type PreparedPage } from "@/lib/client/media";
import { formatDate } from "@/lib/i18n";
import { shortHash } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AppBar, AppScreen, Card, Chip, Dock, Page, SpeakButton, Spinner } from "@/components/common/Chrome";
import { AppMenu } from "@/components/common/AppMenu";
import { DocumentPreview } from "@/components/DocumentPreview";
import { CosignSheet, ROLE_LABEL, type CosignResult } from "@/components/sign/CosignSheet";
import { useApp } from "@/components/app/AppContext";

type Meta =
  | { valid: false }
  | { valid: true; expiresAt: string; sha256: string; approvedAt: string; pageCount: number; arkivChecked: boolean };

/** What the recipient (bank clerk, family member, witness) sees when they open a share link. */
export function SharedDocument({ token }: { token: string }) {
  const { t, lang } = useApp();
  const [meta, setMeta] = useState<Meta | null>(null);
  // The document itself, so a co-signer sees exactly what they sign.
  const [doc, setDoc] = useState<{ pages: PreparedPage[]; sha256: string } | null>(null);
  const [cosignOpen, setCosignOpen] = useState(false);
  const [cosigned, setCosigned] = useState<CosignResult | null>(null);

  useEffect(() => {
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => setMeta({ valid: false }));
  }, [token]);

  const valid = meta?.valid ? meta : null;

  useEffect(() => {
    if (!valid) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(token)}/file`);
        if (!res.ok) return;
        const bytes = await res.arrayBuffer();
        const sha256 = await sha256Hex(bytes);
        const { pages } = await pdfToPages(bytes);
        if (live) setDoc({ pages, sha256 });
      } catch {
        // Preview is a convenience; Download still works.
      }
    })();
    return () => {
      live = false;
    };
  }, [valid, token]);

  // Co-signing needs an Arkiv record, and the file shown must be the one that record is about.
  const canCosign = Boolean(valid?.arkivChecked && doc && doc.sha256 === valid.sha256);

  return (
    <AppScreen>
      {/* The full title wraps on the card below instead of being cut off in the bar. */}
      <AppBar menu={<AppMenu />} />
      <Page dock={Boolean(valid)}>
        {!meta && (
          <div className="flex justify-center py-12">
            <Spinner label={t("loading")} />
          </div>
        )}

        {meta && !meta.valid && (
          <Card className="mt-4 flex flex-col items-center gap-3 bg-slate-100/70 px-4 py-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-white text-slate-500">
              <Link2Off className="size-7" aria-hidden />
            </span>
            <h1 className="max-w-md text-[17px] font-semibold leading-snug text-slate-700">{t("sharedExpired")}</h1>
          </Card>
        )}

        {valid && (
          <>
            <Card className="relative mt-4 flex flex-col items-center gap-3 px-4 pb-4 pt-6 text-center">
              <SpeakButton
                text={[
                  t("sharedTitle"),
                  t("sharedValid", { date: formatDate(lang, valid.expiresAt, true) }),
                  valid.arkivChecked ? t("verifyMatchDetail", { date: formatDate(lang, valid.approvedAt, true) }) : "",
                  t("verifyDisclaimer"),
                ]
                  .filter(Boolean)
                  .join(" ")}
                className="absolute right-3 top-3"
              />
              <span className="flex size-14 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                <FileText className="size-7" aria-hidden />
              </span>
              <h1 className="max-w-md text-[17px] font-semibold leading-snug text-slate-900">{t("sharedTitle")}</h1>
              <div className="flex flex-wrap justify-center gap-2">
                {/* Dates with a time wrap at 375px, so these chips use the wrapping (rounded-xl) shape. */}
                <Chip tone="blue" icon={Clock} className="max-w-full rounded-xl px-2.5 py-1 text-[13px]">
                  {t("linkActiveUntil", { date: formatDate(lang, valid.expiresAt, true) })}
                </Chip>
                {valid.arkivChecked && (
                  <Chip tone="green" icon={CheckCircle2} className="max-w-full rounded-xl px-2.5 py-1 text-[13px]">
                    {t("approvedOn", { date: formatDate(lang, valid.approvedAt, true) })}
                  </Chip>
                )}
              </div>
            </Card>

            {cosigned && (
              <Card className="mt-4 flex items-start gap-3 border-2 border-green-200 bg-green-50/60">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700" aria-hidden>
                  <CheckCircle2 className="size-5" />
                </span>
                <div className="min-w-0 flex-1" role="status">
                  <p className="text-[15px] font-semibold text-slate-900">
                    {t("cosignDone", { role: t(ROLE_LABEL[cosigned.role]) })}
                  </p>
                  <p className="text-[13px] text-slate-600">{formatDate(lang, cosigned.signedAt, true)}</p>
                  <a
                    href={cosigned.explorerTxUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-flex min-h-10 items-center gap-1 font-mono text-[13px] text-blue-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
                  >
                    {shortHash(cosigned.txHash)} <ExternalLink className="size-4" aria-hidden />
                  </a>
                </div>
              </Card>
            )}

            <Card className="mt-4 p-2">
              {doc ? (
                <DocumentPreview pages={doc.pages} alt={t("sharedTitle")} />
              ) : (
                <div className="flex justify-center py-10">
                  <Spinner label={t("loading")} />
                </div>
              )}
            </Card>

            <p className="mt-4 flex items-start gap-2 px-1 text-[13px] text-slate-500">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t("verifyDisclaimer")}</span>
            </p>
          </>
        )}
      </Page>

      {valid && (
        <Dock>
          <Button block size="lg" asChild>
            <a href={`/api/share/${encodeURIComponent(token)}/file`}>
              <Download aria-hidden /> {t("sharedDownload")}
            </a>
          </Button>
          <div className="grid grid-cols-2 gap-2">
            {canCosign && (
              <Button size="md" variant="secondary" disabled={Boolean(cosigned)} onClick={() => setCosignOpen(true)}>
                <Signature aria-hidden /> {cosigned ? t("cosigned") : t("cosignShort")}
              </Button>
            )}
            <Button size="md" variant="ghost" className={canCosign ? undefined : "col-span-2"} asChild>
              <Link href={`/verify?h=${valid.sha256}`}>
                <ShieldCheck aria-hidden /> {t("verify")}
              </Link>
            </Button>
          </div>
        </Dock>
      )}

      {valid && doc && (
        <CosignSheet
          open={cosignOpen}
          onOpenChange={setCosignOpen}
          token={token}
          docHash={doc.sha256}
          onDone={(r) => {
            setCosigned(r);
            setCosignOpen(false);
          }}
        />
      )}
    </AppScreen>
  );
}
