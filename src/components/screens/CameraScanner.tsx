"use client";

import { Camera, FileUp, Flashlight, FlashlightOff, RotateCcw, ShieldCheck, Sparkles, Check } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureVideoFrame, imageFileToPage, MAX_UPLOAD_BYTES, pdfToPages, type PreparedPage } from "@/lib/client/media";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/common/LanguageSelector";
import { useApp, type SourceDocument } from "@/components/app/AppContext";

type CameraState = "starting" | "live" | "unavailable";

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
  const [captured, setCaptured] = useState<PreparedPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCamera("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera api");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
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

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setCaptured(await captureVideoFrame(video));
  };

  const useCaptured = () => {
    if (!captured) return;
    stopCamera();
    onDocument({ kind: "image", pdf: null, pages: [captured], pageCount: 1 });
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
        const page = await imageFileToPage(file);
        stopCamera();
        onDocument({ kind: "image", pdf: null, pages: [page], pageCount: 1 });
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
    <div className="flex min-h-dvh flex-col bg-slate-950">
      {/* Viewfinder */}
      <div className="relative flex-1 overflow-hidden">
        {captured ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={captured.dataUrl} alt={t("scanTitle")} className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" aria-hidden />
        )}

        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3">
          <span className="rounded-full bg-black/55 px-4 py-2 text-xl font-bold text-white">{t("appName")}</span>
          <LanguageSelector tone="dark" />
        </div>

        {!captured && camera === "live" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6">
            <div className="aspect-[3/4] w-full max-w-sm rounded-3xl border-4 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            <p className="mt-4 rounded-full bg-black/60 px-4 py-2 text-center text-lg font-semibold text-white">{t("scanHint")}</p>
          </div>
        )}

        {!captured && camera !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center text-white">
            <Camera className="size-14 text-white/70" aria-hidden />
            <p className="text-xl">{camera === "starting" ? t("cameraStarting") : t("cameraUnavailable")}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="rounded-t-3xl bg-white px-4 pt-5 pb-safe">
        <div className="mx-auto flex max-w-md flex-col gap-3">
          <h1 className="text-center text-2xl font-bold text-slate-900">{t("scanTitle")}</h1>
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-center text-lg text-red-800">
              {error}
            </p>
          )}

          {captured ? (
            <>
              <Button block onClick={useCaptured}>
                <Check aria-hidden /> {t("usePhoto")}
              </Button>
              <Button block variant="secondary" onClick={() => setCaptured(null)}>
                <RotateCcw aria-hidden /> {t("retake")}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-6">
                {torchSupported ? (
                  <button
                    onClick={toggleTorch}
                    aria-pressed={torchOn}
                    className="flex size-16 flex-col items-center justify-center rounded-full border-2 border-slate-300 text-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
                  >
                    {torchOn ? <FlashlightOff className="size-7" aria-hidden /> : <Flashlight className="size-7" aria-hidden />}
                    <span className="sr-only">{torchOn ? t("flashOff") : t("flashOn")}</span>
                  </button>
                ) : (
                  <span className="size-16" aria-hidden />
                )}
                <button
                  onClick={capture}
                  disabled={camera !== "live" || busy}
                  className="flex size-24 items-center justify-center rounded-full bg-blue-700 text-white shadow-lg ring-4 ring-blue-100 hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-8 focus-visible:ring-blue-300 disabled:bg-slate-300"
                  aria-label={t("takePhoto")}
                >
                  <Camera className="size-11" aria-hidden />
                </button>
                <span className="size-16" aria-hidden />
              </div>
              <p className="text-center text-lg font-semibold text-slate-800">{t("takePhoto")}</p>

              <Button block variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                <FileUp aria-hidden /> {busy ? t("loading") : t("chooseFile")}
              </Button>
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
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
                <button
                  onClick={() => void trySample()}
                  disabled={busy}
                  className="inline-flex min-h-12 items-center gap-2 text-lg font-semibold text-blue-800 underline-offset-4 hover:underline"
                >
                  <Sparkles className="size-5" aria-hidden /> {t("trySample")}
                </button>
                <Link
                  href="/verify"
                  className="inline-flex min-h-12 items-center gap-2 text-lg font-semibold text-blue-800 underline-offset-4 hover:underline"
                >
                  <ShieldCheck className="size-5" aria-hidden /> {t("checkDocument")}
                </Link>
              </div>
            </>
          )}
          <p className="text-center text-base text-slate-600">{t("privacyNote")}</p>
        </div>
      </div>
    </div>
  );
}
