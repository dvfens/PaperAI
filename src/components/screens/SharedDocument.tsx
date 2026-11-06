"use client";

import { CheckCircle2, Clock, Download, FileText, Info, Link2Off, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { AppBar, AppScreen, Card, Chip, Dock, Page, SpeakButton, Spinner } from "@/components/common/Chrome";
import { useApp } from "@/components/app/AppContext";

type Meta =
  | { valid: false }
  | { valid: true; expiresAt: string; sha256: string; approvedAt: string; pageCount: number; arkivChecked: boolean };

/** What the recipient (bank clerk, family member) sees when they open a share link. */
export function SharedDocument({ token }: { token: string }) {
  const { t, lang } = useApp();
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => setMeta({ valid: false }));
  }, [token]);

  const valid = meta?.valid ? meta : null;

  return (
    <AppScreen>
      {/* The full title wraps on the card below instead of being cut off in the bar. */}
      <AppBar />
      <Page dock={Boolean(valid)}>
        {!meta && (
          <div className="flex justify-center py-16">
            <Spinner label={t("loading")} />
          </div>
        )}

        {meta && !meta.valid && (
          <Card className="mt-4 flex flex-col items-center gap-3 bg-slate-100/70 px-5 py-10 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-white text-slate-500">
              <Link2Off className="size-10" aria-hidden />
            </span>
            <h1 className="max-w-md text-xl font-bold leading-snug text-slate-700">{t("sharedExpired")}</h1>
          </Card>
        )}

        {valid && (
          <>
            <Card className="relative mt-4 flex flex-col items-center gap-3 px-5 pb-6 pt-8 text-center">
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
              <span className="flex size-16 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                <FileText className="size-10" aria-hidden />
              </span>
              <h1 className="max-w-md text-xl font-bold leading-snug text-slate-900">{t("sharedTitle")}</h1>
              <div className="flex flex-wrap justify-center gap-2">
                {/* Dates with a time wrap at 375px, so these chips use the wrapping (rounded-2xl) shape. */}
                <Chip tone="blue" icon={Clock} className="max-w-full rounded-2xl px-4 py-1.5 text-base">
                  {t("linkActiveUntil", { date: formatDate(lang, valid.expiresAt, true) })}
                </Chip>
                {valid.arkivChecked && (
                  <Chip tone="green" icon={CheckCircle2} className="max-w-full rounded-2xl px-4 py-1.5 text-base">
                    {t("approvedOn", { date: formatDate(lang, valid.approvedAt, true) })}
                  </Chip>
                )}
              </div>
            </Card>

            <p className="mt-4 flex items-start gap-2 px-1 text-base text-slate-500">
              <Info className="mt-1 size-4 shrink-0" aria-hidden />
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
          <Button block size="md" variant="ghost" asChild>
            <Link href={`/verify?h=${valid.sha256}`}>
              <ShieldCheck aria-hidden /> {t("verify")}
            </Link>
          </Button>
        </Dock>
      )}
    </AppScreen>
  );
}
