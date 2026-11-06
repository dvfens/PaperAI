"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_UPLOAD_BYTES, pdfToPages } from "@/lib/client/media";
import { findPage, imageToCanvas, PHOTO_EDGE, type NormQuad } from "@/lib/client/scanner";
import { useApp, type SourceDocument } from "@/components/app/AppContext";

/** The analysis and fill requests take up to four page images. */
export const MAX_PAGES = 4;

/** A photo waiting in the review sheet (crop, straighten, clean up) before it becomes a page. */
export interface Draft {
  id: number;
  /** The photo at full resolution. */
  source: HTMLCanvasElement;
  /** Page outline found in it (null: none found, the whole photo is used). */
  quad: NormQuad | null;
}

export function safeFind(source: HTMLCanvasElement): NormQuad | null {
  try {
    return findPage(source, source.width, source.height, PHOTO_EDGE);
  } catch {
    return null;
  }
}

/**
 * Taking in a form from a file, shared by both start screens (the camera on phones, the upload
 * page on computers): a PDF goes straight on, a photo opens the review sheet first, and
 * "Try a sample" loads the demo form. Also handles the /?sample=flat|fillable demo shortcut.
 * `beforeDocument` runs just before a PDF is handed on (the camera screen stops the camera).
 */
export function useFileIntake(onDocument: (doc: SourceDocument) => void, beforeDocument?: () => void) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftId = useRef(0);

  const openDraft = useCallback((source: HTMLCanvasElement, quad: NormQuad | null) => {
    setDraft({ id: ++draftId.current, source, quad });
  }, []);
  const closeDraft = useCallback(() => setDraft(null), []);

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
        beforeDocument?.();
        onDocument({ kind: "pdf", pdf: new Blob([data], { type: "application/pdf" }), pages, pageCount });
      } else if (file.type.startsWith("image/")) {
        // Photos from the gallery get the same cut-out, straightening and clean-up as camera photos.
        const source = await imageToCanvas(file);
        openDraft(source, safeFind(source));
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

  return { busy, error, setError, draft, openDraft, closeDraft, handleFile, trySample };
}
