"use client";

import { ArrowRight, FolderOpen, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { api } from "@/lib/client/api";
import type { PreparedPage } from "@/lib/client/media";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/common/LanguageSelector";
import { VoiceEngineButton } from "@/components/common/VoiceEngine";
import { ScanReview } from "@/components/scan/ScanReview";
import { MAX_PAGES, useFileIntake } from "@/components/scan/useFileIntake";
import { useApp, type SourceDocument } from "@/components/app/AppContext";

const textLink =
  "inline-flex items-center gap-1.5 rounded text-[15px] font-semibold text-blue-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:opacity-50";

/**
 * Start page on a computer. A webcam is no good for scanning paper, so instead of the camera the
 * page asks for the form's file (button, or drop it anywhere), and shows what the product does
 * with a real result: the sample form as Paper AI filled it. A small QR code hands a paper-only
 * form over to the phone; the webcam stays available as a fallback.
 */
export function DesktopHome({ onDocument, onUseCamera }: { onDocument: (doc: SourceDocument) => void; onUseCamera: () => void }) {
  const { t } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, error, draft, closeDraft, handleFile, trySample } = useFileIntake(onDocument);
  // Photos kept with "Add page" in the review sheet (a PDF goes straight on).
  const [pages, setPages] = useState<PreparedPage[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [savedCount, setSavedCount] = useState(0);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    api
      .myForms()
      .then((forms) => setSavedCount(forms.length))
      .catch(() => undefined);
    QRCode.toDataURL(window.location.origin, { margin: 0, width: 240, color: { dark: "#1c1917", light: "#ffffff" } })
      .then(setQr)
      .catch(() => undefined);
  }, []);

  const chooseFile = () => {
    if (!busy) fileRef.current?.click();
  };
  const finish = (all: PreparedPage[]) => onDocument({ kind: "image", pdf: null, pages: all, pageCount: all.length });

  // The whole page takes a dropped file (so a near miss never opens the PDF in the browser instead).
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !busy && !draft) void handleFile(file);
  };

  return (
    <div
      className="min-h-dvh overflow-x-clip bg-[#f6f4ef] text-stone-900"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6 lg:px-10">
        <span className="text-xl font-extrabold tracking-tight text-blue-700">{t("appName")}</span>
        <div className="flex items-center gap-2">
          {savedCount > 0 && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/forms">
                <FolderOpen aria-hidden /> {t("myForms")}
                <span className="rounded-full bg-blue-700 px-1.5 text-xs font-bold leading-5 text-white">{savedCount}</span>
              </Link>
            </Button>
          )}
          <VoiceEngineButton />
          <LanguageSelector />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-16 pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-20 lg:px-10 lg:pt-14">
        <section className="max-w-xl">
          <h1 className="text-[40px] font-bold leading-[1.1] tracking-tight lg:text-[52px]">{t("home_title")}</h1>
          <p className="mt-5 text-[18px] leading-relaxed text-stone-600">{t("home_sub")}</p>

          {pages.length > 0 ? (
            <div className="mt-9 rounded-2xl bg-white p-5 ring-1 ring-stone-200">
              <p className="text-[15px] font-semibold">{t("home_pagesReady")}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {pages.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={p.dataUrl} alt={t("scan_pageN", { n: i + 1 })} className="h-32 w-24 rounded-md object-cover ring-1 ring-stone-200" />
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={() => finish(pages)}>{pages.length === 1 ? t("cam_use") : t("scan_useN", { n: pages.length })}</Button>
                {pages.length < MAX_PAGES && (
                  <Button variant="secondary" onClick={chooseFile} disabled={busy}>
                    {t("scan_addPage")}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-9">
              <Button size="lg" className="min-h-14 rounded-2xl px-7 text-[17px]" onClick={chooseFile} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />} {t("home_upload")}
              </Button>
              <p className="mt-3 text-[15px] text-stone-500">{t("home_uploadHint")}</p>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-[15px] font-semibold text-red-700">
              {error}
            </p>
          )}

          <div className="mt-7 flex flex-col items-start gap-2.5">
            <button type="button" className={textLink} onClick={() => void trySample()} disabled={busy}>
              {t("home_sample")} <ArrowRight className="size-4" aria-hidden />
            </button>
            <Link href="/verify" className={textLink}>
              {t("home_check")} <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>

          <div className="mt-10 flex items-center gap-4 border-t border-stone-300/70 pt-6">
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="" aria-hidden className="size-[84px] shrink-0 rounded-lg bg-white p-1.5 ring-1 ring-stone-200" />
            )}
            <div>
              <p className="text-[15px] leading-snug text-stone-600">{t("home_phone")}</p>
              <button
                type="button"
                onClick={onUseCamera}
                className="mt-1.5 rounded text-[14px] font-semibold text-stone-700 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
              >
                {t("home_useWebcam")}
              </button>
            </div>
          </div>
        </section>

        {/* What the product does, shown with a real result: the sample form as Paper AI filled it,
            next to the question and answer that filled its first line. Clicking it opens the sample. */}
        <figure className="relative mx-auto w-full max-w-[560px]">
          <button
            type="button"
            onClick={() => void trySample()}
            disabled={busy}
            aria-label={t("home_sample")}
            className="group block w-full rounded-[6px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/samples/library-membership-form-filled.webp"
              alt=""
              width={1061}
              height={1060}
              className="w-full rounded-[6px] bg-white shadow-[0_1px_2px_rgba(28,25,23,0.06),0_24px_48px_-20px_rgba(68,48,20,0.28)] ring-1 ring-stone-200/80 transition-transform duration-200 group-hover:-translate-y-1"
            />
          </button>
          <div className="pointer-events-none absolute bottom-[19%] left-3 flex w-[min(290px,72%)] flex-col gap-2 sm:-left-8 lg:-left-12" aria-hidden>
            <p className="self-start rounded-2xl rounded-bl-md bg-stone-900 px-4 py-2.5 text-[15px] leading-snug text-white shadow-lg">
              <span className="mb-0.5 block text-[12px] font-semibold text-stone-400">{t("appName")}</span>
              {t("home_ask")}
            </p>
            <p className="self-end rounded-2xl rounded-br-md bg-blue-700 px-4 py-2.5 text-[15px] font-medium leading-snug text-white shadow-lg">
              {t("home_reply")}
            </p>
          </div>
          <figcaption className="mt-4 text-[13px] text-stone-500">{t("home_caption")}</figcaption>
        </figure>
      </main>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handleFile(f);
        }}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-blue-700/10 ring-4 ring-inset ring-blue-600">
          <p className="rounded-full bg-blue-700 px-6 py-3 text-lg font-semibold text-white shadow-xl">{t("home_dropping")}</p>
        </div>
      )}

      {busy && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#f6f4ef]/60" role="status" aria-label={t("loading")}>
          <Loader2 className="size-8 animate-spin text-blue-700" aria-hidden />
        </div>
      )}

      {draft && (
        // The review sheet (crop, straighten, clean up) fills the window, as it does on a phone.
        <div className="fixed inset-0 z-50">
          <ScanReview
            key={draft.id}
            source={draft.source}
            autoQuad={draft.quad}
            pageNumber={pages.length + 1}
            canAddPage={pages.length + 1 < MAX_PAGES}
            onRetake={closeDraft}
            onAddPage={(page) => {
              setPages((p) => [...p, page]);
              closeDraft();
            }}
            onUse={(page) => finish([...pages, page])}
          />
        </div>
      )}
    </div>
  );
}
