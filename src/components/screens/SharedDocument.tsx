"use client";

import { CheckCircle2, Download, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDate } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Notice, Screen, Spinner, TopBar } from "@/components/common/Chrome";
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

  return (
    <>
      <TopBar />
      <Screen>
        <h1 className="text-3xl font-bold text-slate-900">{t("sharedTitle")}</h1>
        {!meta && (
          <div className="mt-6">
            <Spinner label={t("loading")} />
          </div>
        )}
        {meta && !meta.valid && (
          <div className="mt-6 rounded-3xl border-2 border-slate-300 bg-slate-50 p-5">
            <p className="flex items-center gap-3 text-2xl font-bold text-slate-900">
              <XCircle className="size-9 text-slate-600" aria-hidden /> {t("sharedExpired")}
            </p>
          </div>
        )}
        {meta?.valid && (
          <div className="mt-6 flex flex-col gap-4">
            <Notice tone="info">{t("sharedValid", { date: formatDate(lang, meta.expiresAt, true) })}</Notice>
            {meta.arkivChecked && (
              <p className="flex items-start gap-2 text-lg text-green-900">
                <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-green-700" aria-hidden /> {t("verifyMatchDetail", { date: formatDate(lang, meta.approvedAt, true) })}
              </p>
            )}
            <Button block asChild>
              <a href={`/api/share/${encodeURIComponent(token)}/file`}>
                <Download aria-hidden /> {t("sharedDownload")}
              </a>
            </Button>
            <Button block variant="secondary" asChild>
              <Link href={`/verify?h=${meta.sha256}`}>
                <ShieldCheck aria-hidden /> {t("checkDocument")}
              </Link>
            </Button>
            <p className="text-lg text-slate-700">{t("verifyDisclaimer")}</p>
          </div>
        )}
      </Screen>
    </>
  );
}
