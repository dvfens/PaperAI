"use client";

import { CameraOff, Flashlight, FlashlightOff, FolderOpen, ImageUp, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { MAX_UPLOAD_BYTES, pdfToPages, type PreparedPage } from "@/lib/client/media";
import { findPage, grabFrame, imageToCanvas, PHOTO_EDGE, type NormQuad } from "@/lib/client/scanner";
import { IconAction } from "@/components/common/Chrome";
import { LanguageSelector } from "@/components/common/LanguageSelector";
import { VoiceEngineButton } from "@/components/common/VoiceEngine";
import { LiveOutline, type TrackState } from "@/components/scan/LiveOutline";
import { ScanReview } from "@/components/scan/ScanReview";
import { useApp, type SourceDocument } from "@/components/app/AppContext";

type CameraState = "starting" | "live" | "unavailable";

/** The analysis and fill requests take up to four page images. */
const MAX_PAGES = 4;

interface Draft {
  id: number;
  /** The photo at full resolution. */
  source: HTMLCanvasElement;
  /** Page outline found in it (null: none found, the whole photo is used). */
  quad: NormQuad | null;
}

function safeFind(source: HTMLCanvasElement): NormQuad | null {
  try {
    return findPage(source, source.width, source.height, PHOTO_EDGE);
  } catch {
    return null;
  }
}

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

/**
 * Screen 1 — the app opens straight into the camera. One big shutter button, an upload option,
 * a light toggle where the phone supports it, and the language switch. Nothing else.
 */
export function CameraScanner({ onDocument }: { onDocument: (doc: SourceDocument) => void }) {
  const { t } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<CameraState>("starting");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  // The photo being checked, and pages already kept with "Add page".
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pages, setPages] = useState<PreparedPage[]>([]);
  const draftId = useRef(0);
  const [track, setTrack] = useState<TrackState>("searching");
  const [flash, setFlash] = useState(false);
  const liveQuad = useRef<NormQuad | null>(null);
  // No automatic photo in the first moments after the camera opens or a photo is put away.
  const [autoAfter, setAutoAfter] = useState(() => Date.now() + 1500);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Forms this phone saved earlier: shown as a "My forms" button only when there are some.
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    api
      .myForms()
      .then((forms) => setSavedCount(forms.length))
      .catch(() => undefined);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCamera("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera api");
      const stream = await navigator.mediaDevices.getUserMedia({
        // A sharper stream than the screen needs: the page is cut out of it, so every pixel counts.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as TorchCapabilities;
      setTorchSupported(Boolean(caps.torch));
      setCamera("live");
    } catch {
      setCamera("unavailable");
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      setTorchOn(!torchOn);
    } catch {
      setTorchSupported(false);
    }
  };

  /** Take the photo (shutter button, or automatically once the page has been still for a moment). */
  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || draft || busy) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
    navigator.vibrate?.(30);
    const source = grabFrame(video);
    // A closer look at the full photo; the live outline is the fallback.
    setDraft({ id: ++draftId.current, source, quad: safeFind(source) ?? liveQuad.current });
  };

  const putAwayDraft = () => {
    setDraft(null);
    setAutoAfter(Date.now() + 2500);
  };

  const finish = (all: PreparedPage[]) => {
    stopCamera();
    onDocument({ kind: "image", pdf: null, pages: all, pageCount: all.length });
  };

  const handleFile = async (file: File) => {
    setError(null);
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    // PDFs are uploaded as they are; photos are re-encoded much smaller in the browser first.
    if (file.size > (isPdf ? MAX_UPLOAD_BYTES : 40_000_000)) {
      setError(t("errorTooBig"));
      return;
    }
    setBusy(true);
    try {
      if (isPdf) {
        const data = await file.arrayBuffer();
        const { pages, pageCount } = await pdfToPages(data);
        stopCamera();
        onDocument({ kind: "pdf", pdf: new Blob([data], { type: "application/pdf" }), pages, pageCount });
      } else if (file.type.startsWith("image/")) {
        // Photos from the gallery get the same cut-out, straightening and clean-up as camera photos.
        const source = await imageToCanvas(file);
        setDraft({ id: ++draftId.current, source, quad: safeFind(source) });
      } else {
        setError(t("errorFileType"));
      }
    } catch {
      setError(t("errorFileType"));
    } finally {
      setBusy(false);
    }
  };

  const trySample = async (variant: "fillable" | "flat" = "fillable") => {
    setBusy(true);
    try {
      const name = variant === "flat" ? "library-membership-form-flat.pdf" : "library-membership-form.pdf";
      const res = await fetch(`/samples/${name}`);
      const blob = await res.blob();
      await handleFile(new File([blob], name, { type: "application/pdf" }));
    } catch {
      setError(t("errorNetwork"));
      setBusy(false);
    }
  };

  // Demo shortcut: /?sample=flat loads the "paper" version (scan pipeline), /?sample=fillable the AcroForm one.
  useEffect(() => {
    const sample = new URLSearchParams(window.location.search).get("sample");
    if (sample === "flat" || sample === "fillable") {
      window.history.replaceState(null, "", "/");
      void trySample(sample);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-dvh overflow-hidden bg-black text-white">
      {/* Viewfinder, with the page outline tracked live. The camera keeps running while a photo is
          checked, so "Retake" and "Add page" are instant. */}
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" aria-hidden />
      {camera === "live" && (
        <LiveOutline videoRef={videoRef} active={!draft && !busy} autoAfter={autoAfter} quadRef={liveQuad} onState={setTrack} onSteady={capture} />
      )}
      {flash && <div className="pointer-events-none absolute inset-0 z-30 bg-white/70" aria-hidden />}

      {/* Top bar */}
      <div inert={Boolean(draft)} className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-6">
        <span className="text-[17px] font-bold tracking-tight">{t("appName")}</span>
        <div className="flex items-center gap-2">
          <VoiceEngineButton tone="dark" />
          <LanguageSelector tone="dark" />
        </div>
      </div>

      {/* Frame guide while no page is in view; "hold still" once the outline has found it. */}
      {!draft && camera === "live" && (
        <div className="pointer-events-none absolute inset-x-8 top-20 bottom-52">
          {track === "searching" && (
            <>
              <span className="absolute left-0 top-0 size-10 rounded-tl-2xl border-l-[3px] border-t-[3px] border-white/90" aria-hidden />
              <span className="absolute right-0 top-0 size-10 rounded-tr-2xl border-r-[3px] border-t-[3px] border-white/90" aria-hidden />
              <span className="absolute bottom-0 left-0 size-10 rounded-bl-2xl border-b-[3px] border-l-[3px] border-white/90" aria-hidden />
              <span className="absolute bottom-0 right-0 size-10 rounded-br-2xl border-b-[3px] border-r-[3px] border-white/90" aria-hidden />
            </>
          )}
          <span role="status" className="absolute inset-x-0 top-4 mx-auto w-fit rounded-full bg-black/55 px-3 py-1 text-[13px] font-medium backdrop-blur">
            {track === "searching" ? t("cam_hint") : t("scan_hold")}
          </span>
        </div>
      )}

      {/* No camera */}
      {!draft && camera !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-10 pb-40 text-center">
          {camera === "starting" ? (
            <Loader2 className="size-8 animate-spin text-white/70" aria-hidden />
          ) : (
            <>
              <span className="flex size-14 items-center justify-center rounded-full bg-white/10">
                <CameraOff className="size-7 text-white/80" aria-hidden />
              </span>
              <p className="text-[15px] font-semibold">{t("cam_noCamera")}</p>
            </>
          )}
        </div>
      )}

      {/* Busy overlay (reading a file) */}
      {busy && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60" role="status" aria-label={t("loading")}>
          <Loader2 className="size-8 animate-spin" aria-hidden />
        </div>
      )}

      {/* Bottom controls */}
      <div inert={Boolean(draft)} className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pt-8 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {error && (
          <p role="alert" className="mx-auto mb-3 w-fit rounded-full bg-red-600 px-4 py-1.5 text-sm font-semibold">
            {error}
          </p>
        )}

            {savedCount > 0 && (
              <div className="mb-2.5 flex justify-center">
                <Link
                  href="/forms"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-5 text-[15px] font-semibold text-slate-900 hover:bg-white/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
                >
                  <FolderOpen className="size-4" aria-hidden /> {t("myForms")}
                  <span className="ml-0.5 rounded-full bg-blue-600 px-1.5 text-xs font-bold leading-5 text-white">{savedCount}</span>
                </Link>
              </div>
            )}
            <div className="mb-4 flex justify-center gap-2">
              <button
                onClick={() => void trySample()}
                disabled={busy}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-semibold backdrop-blur hover:bg-white/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
              >
                <Sparkles className="size-4" aria-hidden /> {t("cam_sample")}
              </button>
              <Link
                href="/verify"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-semibold backdrop-blur hover:bg-white/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
              >
                <ShieldCheck className="size-4" aria-hidden /> {t("cam_check")}
              </Link>
            </div>
            <div className="mx-auto grid max-w-md grid-cols-3 items-center">
              <div className="flex justify-center">
                {pages.length > 0 ? (
                  // Pages kept so far: tap to use them, like the stack in a scanner app.
                  <button
                    type="button"
                    onClick={() => finish(pages)}
                    aria-label={pages.length === 1 ? t("scan_pageDone") : t("scan_pagesDone", { n: pages.length })}
                    className="relative size-12 rounded-lg border-2 border-white bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pages[pages.length - 1].dataUrl} alt="" className="h-full w-full rounded-md object-cover" />
                    <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-blue-600 px-1.5 text-xs font-bold leading-5 text-white">{pages.length}</span>
                  </button>
                ) : (
                  <IconAction tone="dark" icon={ImageUp} label={t("cam_file")} onClick={() => fileRef.current?.click()} disabled={busy} />
                )}
              </div>
              <div className="flex justify-center">
                <button
                  onClick={capture}
                  disabled={camera !== "live" || busy}
                  aria-label={t("takePhoto")}
                  className="flex size-[4.5rem] items-center justify-center rounded-full border-4 border-white p-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:opacity-40"
                >
                  <span className="block size-full rounded-full bg-white transition-transform active:scale-90" />
                </button>
              </div>
              <div className="flex justify-center">
                {torchSupported ? (
                  <IconAction tone="dark" icon={torchOn ? FlashlightOff : Flashlight} label={t("cam_light")} active={torchOn} onClick={toggleTorch} />
                ) : (
                  <span className="size-11" aria-hidden />
                )}
              </div>
            </div>
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
      </div>

      {draft && (
        <ScanReview
          key={draft.id}
          source={draft.source}
          autoQuad={draft.quad}
          pageNumber={pages.length + 1}
          canAddPage={pages.length + 1 < MAX_PAGES}
          onRetake={putAwayDraft}
          onAddPage={(page) => {
            setPages((p) => [...p, page]);
            putAwayDraft();
          }}
          onUse={(page) => finish([...pages, page])}
        />
      )}
    </div>
  );
}
