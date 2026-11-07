"use client";

import { Download, FileText, FolderOpen, Lock, Nfc, Plus, Share2, ShieldCheck, SmartphoneNfc, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { forgetFormTitle, formTitles } from "@/lib/client/form-titles";
import { clearSession } from "@/lib/client/persist";
import { formatDate, type StringKey } from "@/lib/i18n";
import type { SavedForm } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AppBar, AppScreen, Card, Chip, Dock, Page, Spinner } from "@/components/common/Chrome";
import { AppMenu } from "@/components/common/AppMenu";
import { useApp } from "@/components/app/AppContext";
import { useOpenFromCard, useSaveToCard } from "@/components/nfc/NfcCard";
import { ShareSection } from "./DoneScreen";

const CHIP = "max-w-full rounded-xl px-2.5 py-1 text-left text-[13px]";

/**
 * "My forms": every form this phone saved and can still open. The PDF is stored encrypted by Paper AI
 * and opens only with this phone's cookie; Arkiv holds just its fingerprint. Each form can be opened,
 * sent (share link) or deleted — the same actions as the finished-form screen.
 */
export function MyForms() {
  const { t, lang } = useApp();
  const [forms, setForms] = useState<SavedForm[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  const card = useSaveToCard();
  const openCard = useOpenFromCard();

  useEffect(() => {
    setTitles(formTitles());
    api
      .myForms()
      .then(setForms)
      .catch(() => setForms([]));
  }, []);

  // Back returns to wherever the person was; "New form" really starts a new one (clears the resumable session).
  const home = () => (window.location.href = "/");
  const newForm = async () => {
    await clearSession();
    window.location.href = "/";
  };
  const titleOf = (f: SavedForm) => titles[f.documentId] ?? t(`formKind_${f.category}` as StringKey);

  const erase = async (id: string) => {
    await api.erase(id).catch(() => undefined);
    forgetFormTitle(id);
    setForms((prev) => prev?.filter((f) => f.documentId !== id) ?? null);
    setDeleteFor(null);
  };

  return (
    <AppScreen>
      <AppBar title={t("myForms")} onBack={home} menu={<AppMenu />} />
      <Page>
        <p className="mt-2 flex items-start gap-2 px-1 text-[13px] text-slate-500">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("myFormsWhere")}</span>
        </p>

        {openCard.supported && (
          <Button block size="lg" variant="secondary" className="mt-3" onClick={() => void openCard.start()}>
            <SmartphoneNfc aria-hidden /> {t("nfcOpen")}
          </Button>
        )}

        {forms === null && (
          <div className="flex justify-center py-12">
            <Spinner label={t("loading")} />
          </div>
        )}

        {forms?.length === 0 && (
          <Card className="mt-4 flex flex-col items-center gap-3 bg-slate-100/70 px-4 py-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-white text-slate-500">
              <FolderOpen className="size-7" aria-hidden />
            </span>
            <p className="max-w-sm text-[15px] font-medium text-slate-700">{t("myFormsEmpty")}</p>
          </Card>
        )}

        {forms && forms.length > 0 && (
          <ul className="mt-4 flex flex-col gap-3">
            {forms.map((f) => (
              <li key={f.documentId}>
                <Card>
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                      <FileText className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="break-words text-[15px] font-semibold leading-snug text-slate-900">{titleOf(f)}</h2>
                      <p className="mt-0.5 text-[13px] text-slate-500">{t("savedOn", { date: formatDate(lang, f.approvedAt) })}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {f.arkiv.status === "recorded" && (
                      <Chip tone="green" icon={ShieldCheck} className={CHIP}>
                        {t("protectedChip")}
                      </Chip>
                    )}
                    <Chip tone={f.arkiv.status === "recorded" ? "green" : "blue"} icon={Lock} className={CHIP}>
                      {t("safeUntil", { date: formatDate(lang, f.retentionUntil) })}
                    </Chip>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button size="lg" asChild>
                      <a href={`/api/documents/${f.documentId}/file?inline=1`} target="_blank" rel="noopener">
                        <Download aria-hidden /> {t("openForm")}
                      </a>
                    </Button>
                    <Button size="lg" variant="secondary" onClick={() => setShareFor(f.documentId)}>
                      <Share2 aria-hidden /> {t("sendShort")}
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3">
                    {card.supported && (
                      <button
                        type="button"
                        onClick={() => void card.start(f.documentId)}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-[13px] font-semibold text-blue-800 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
                      >
                        <Nfc className="size-4" aria-hidden /> {t("nfcSave")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteFor(f.documentId)}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-[13px] font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300"
                    >
                      <Trash2 className="size-4" aria-hidden /> {t("deleteDocument")}
                    </button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Page>

      <Dock>
        <Button block size="lg" variant="secondary" onClick={() => void newForm()}>
          <Plus aria-hidden /> {t("newDoc")}
        </Button>
      </Dock>

      {card.sheet}
      {openCard.sheet}
      {shareFor && <ShareSection documentId={shareFor} open onOpenChange={(o) => !o && setShareFor(null)} />}

      <Dialog
        open={deleteFor !== null}
        onOpenChange={(o) => !o && setDeleteFor(null)}
        title={t("deleteDocument")}
        description={t("deleteConfirm")}
        closeLabel={t("close")}
      >
        <div className="flex flex-col gap-3">
          <Button block variant="danger" onClick={() => deleteFor && void erase(deleteFor)}>
            <Trash2 aria-hidden /> {t("deleteDocument")}
          </Button>
          <Button block variant="secondary" onClick={() => setDeleteFor(null)}>
            {t("cancel")}
          </Button>
        </div>
      </Dialog>
    </AppScreen>
  );
}
