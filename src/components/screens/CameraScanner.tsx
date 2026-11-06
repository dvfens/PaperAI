"use client";

import { CameraOff, Check, Flashlight, FlashlightOff, ImageUp, Loader2, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureVideoFrame, imageFileToPage, MAX_UPLOAD_BYTES, pdfToPages, type PreparedPage } from "@/lib/client/media";
import { IconAction } from "@/components/common/Chrome";
import { LanguageSelector } from "@/components/common/LanguageSelector";
import { VoiceEngineButton } from "@/components/common/VoiceEngine";
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
    <div className="relative h-dvh overflow-hidden bg-black text-white">
      {/* Viewfinder / captured photo */}
      {captured ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={captured.dataUrl} alt={t("scanTitle")} className="absolute inset-0 h-full w-full object-contain" />
      ) : (
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" aria-hidden />
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-6">
        <span className="text-[17px] font-bold tracking-tight">{t("appName")}</span>
        <div className="flex items-center gap-2">
          <VoiceEngineButton tone="dark" />
          <LanguageSelector tone="dark" />
        </div>
      </div>

      {/* Frame guide */}
      {!captured && camera === "live" && (
        <div className="pointer-events-none absolute inset-x-8 top-20 bottom-52" aria-hidden>
          <span className="absolute left-0 top-0 size-10 rounded-tl-2xl border-l-[3px] border-t-[3px] border-white/90" />
          <span className="absolute right-0 top-0 size-10 rounded-tr-2xl border-r-[3px] border-t-[3px] border-white/90" />
          <span className="absolute bottom-0 left-0 size-10 rounded-bl-2xl border-b-[3px] border-l-[3px] border-white/90" />
          <span className="absolute bottom-0 right-0 size-10 rounded-br-2xl border-b-[3px] border-r-[3px] border-white/90" />
          <span className="absolute inset-x-0 top-4 mx-auto w-fit rounded-full bg-black/55 px-3 py-1 text-[13px] font-medium backdrop-blur">
            {t("cam_hint")}
          </span>
        </div>
      )}

      {/* No camera */}
      {!captured && camera !== "live" && (
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
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pt-8 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {error && (
          <p role="alert" className="mx-auto mb-3 w-fit rounded-full bg-red-600 px-4 py-1.5 text-sm font-semibold">
            {error}
          </p>
        )}

        {captured ? (
          <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
            <button
              onClick={() => setCaptured(null)}
              className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-white/15 text-[15px] font-semibold backdrop-blur hover:bg-white/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
            >
              <RotateCcw className="size-5" aria-hidden /> {t("cam_retake")}
            </button>
            <button
              onClick={useCaptured}
              className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-blue-600 text-[15px] font-semibold hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
            >
              <Check className="size-5" aria-hidden /> {t("cam_use")}
            </button>
          </div>
        ) : (
          <>
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
                <IconAction tone="dark" icon={ImageUp} label={t("cam_file")} onClick={() => fileRef.current?.click()} disabled={busy} />
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
          </>
        )}
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
    </div>
  );
}
