"use client";

import { Check, Contrast, Crop, Image as ImageIcon, Loader2, Plus, RotateCcw, RotateCw, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { IconAction } from "@/components/common/Chrome";
import { useApp } from "@/components/app/AppContext";
import { renderScan, type NormQuad } from "@/lib/client/scanner";
import type { PreparedPage } from "@/lib/client/media";
import type { ScanFilter } from "@/lib/scan/image";
import { CropEditor } from "./CropEditor";

const FILTERS: ScanFilter[] = ["clean", "gray", "original"];

/**
 * The photo just taken, already cut out, straightened and cleaned. The person only has to say "use it"
 * or "again"; crop, rotate, filter and extra pages are there if they want them.
 */
export function ScanReview({
  source,
  autoQuad,
  pageNumber,
  canAddPage,
  onRetake,
  onAddPage,
  onUse,
}: {
  source: HTMLCanvasElement;
  autoQuad: NormQuad | null;
  /** 1 for the first page. */
  pageNumber: number;
  canAddPage: boolean;
  onRetake: () => void;
  onAddPage: (page: PreparedPage) => void;
  onUse: (page: PreparedPage) => void;
}) {
  const { t } = useApp();
  const [quad, setQuad] = useState<NormQuad | null>(autoQuad);
  const [filter, setFilter] = useState<ScanFilter>("clean");
  const [turns, setTurns] = useState(0);
  const [page, setPage] = useState<PreparedPage | null>(null);
  const [rendering, setRendering] = useState(true);
  const [failed, setFailed] = useState(false);
  const [cropping, setCropping] = useState(false);

  useEffect(() => {
    let current = true;
    setRendering(true);
    renderScan(source, { quad, filter, turns })
      .then((p) => {
        if (!current) return;
        setPage(p);
        setFailed(false);
      })
      .catch(() => current && setFailed(true))
      .finally(() => current && setRendering(false));
    return () => {
      current = false;
    };
  }, [source, quad, filter, turns]);

  const filterLabel = { clean: t("scan_filterClean"), gray: t("scan_filterGray"), original: t("scan_filterOriginal") }[filter];
  const FilterIcon = { clean: WandSparkles, gray: Contrast, original: ImageIcon }[filter];
  const ready = Boolean(page) && !rendering;
  const total = pageNumber;

  if (cropping) {
    return (
      <CropEditor
        source={source}
        initial={quad}
        auto={autoQuad}
        onDone={(q) => {
          setQuad(q);
          setCropping(false);
        }}
      />
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <span className="text-[17px] font-semibold">{t("scan_pageN", { n: pageNumber })}</span>
      </div>

      <div className="relative mx-4 flex-1">
        {page && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.dataUrl} alt={t("scan_pageN", { n: pageNumber })} className="absolute inset-0 h-full w-full object-contain" />
        )}
        {rendering && (
          <div className="absolute inset-0 flex items-center justify-center" role="status" aria-label={t("loading")}>
            <span className="flex size-12 items-center justify-center rounded-full bg-black/60">
              <Loader2 className="size-6 animate-spin" aria-hidden />
            </span>
          </div>
        )}
        {!autoQuad && !rendering && quad === null && (
          <p className="absolute inset-x-0 bottom-2 mx-auto w-fit max-w-[90%] rounded-full bg-black/70 px-3 py-1.5 text-center text-[13px] font-medium">
            {t("scan_noEdges")}
          </p>
        )}
        {failed && (
          <p role="alert" className="absolute inset-x-0 top-2 mx-auto w-fit rounded-full bg-red-600 px-4 py-1.5 text-sm font-semibold">
            {t("errorGeneric")}
          </p>
        )}
      </div>

      <div className="px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-4 flex max-w-md justify-around">
          <IconAction tone="dark" icon={Crop} label={t("scan_crop")} onClick={() => setCropping(true)} disabled={rendering} />
          <IconAction tone="dark" icon={RotateCw} label={t("scan_rotate")} onClick={() => setTurns((n) => (n + 1) % 4)} disabled={rendering} />
          <IconAction
            tone="dark"
            icon={FilterIcon}
            label={filterLabel}
            onClick={() => setFilter((f) => FILTERS[(FILTERS.indexOf(f) + 1) % FILTERS.length])}
            disabled={rendering}
          />
          {canAddPage && <IconAction tone="dark" icon={Plus} label={t("scan_addPage")} onClick={() => page && onAddPage(page)} disabled={!ready} />}
        </div>
        <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onRetake}
            className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-white/15 text-[15px] font-semibold backdrop-blur hover:bg-white/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
          >
            <RotateCcw className="size-5" aria-hidden /> {t("cam_retake")}
          </button>
          <button
            type="button"
            onClick={() => page && onUse(page)}
            disabled={!ready}
            className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-blue-600 text-[15px] font-semibold hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
          >
            <Check className="size-5" aria-hidden /> {total > 1 ? t("scan_useN", { n: total }) : t("cam_use")}
          </button>
        </div>
      </div>
    </div>
  );
}
