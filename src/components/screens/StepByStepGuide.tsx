"use client";

import { ChevronLeft, ChevronRight, FileStack, Info, ListChecks, Signature, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GuideStep, NextStepsGuide, PageImage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Notice, ReadAloudButton } from "@/components/common/Chrome";
import { DocumentPreview } from "@/components/DocumentPreview";
import { useApp } from "@/components/app/AppContext";

const ICONS: Record<GuideStep["kind"], typeof Signature> = {
  sign: Signature,
  attach: FileStack,
  submit: Store,
  check: ListChecks,
  info: Info,
};

/** Screen 6 — what to do next, one step at a time, read aloud. */
export function StepByStepGuide({ guide, pages }: { guide: NextStepsGuide; pages: PageImage[] }) {
  const { t, speak } = useApp();
  const [i, setI] = useState(0);
  const step = guide.steps[i];
  const introSpoken = useRef(false);
  const stepText = step ? `${step.title}. ${step.detail}` : "";

  useEffect(() => {
    if (!step) return;
    if (!introSpoken.current) {
      introSpoken.current = true;
      void speak(`${guide.intro} ${t("stepOf", { n: 1, total: guide.steps.length })}. ${stepText}`);
    } else {
      void speak(stepText);
    }
    // Speak when the step changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  if (!step) return <Notice tone="info">{guide.notSubmittedNotice}</Notice>;
  const Icon = ICONS[step.kind];

  return (
    <section aria-labelledby="next-steps">
      <h2 id="next-steps" className="text-2xl font-bold text-slate-900">
        {t("nextStepsTitle")}
      </h2>
      <p className="mt-1 text-lg text-slate-700">{guide.intro}</p>
      <div className="mt-4 rounded-3xl border-2 border-blue-100 bg-blue-50/50 p-5">
        <p className="text-base font-semibold text-blue-800">{t("stepOf", { n: i + 1, total: guide.steps.length })}</p>
        <h3 className="mt-1 flex items-start gap-3 text-2xl font-bold text-slate-900">
          <Icon className="mt-1 size-7 shrink-0 text-blue-700" aria-hidden /> {step.title}
        </h3>
        <p className="mt-2 text-xl text-slate-800">{step.detail}</p>
        {step.kind === "sign" && step.box && pages[step.box.page] && (
          <DocumentPreview
            pages={pages}
            highlights={[{ box: step.box, tone: "sign", label: t("statusByHand") }]}
            alt={t("completed")}
            className="mt-4"
            maxPages={step.box.page + 1}
          />
        )}
        <ReadAloudButton text={stepText} className="mt-4" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Button variant="secondary" size="md" disabled={i === 0} onClick={() => setI(i - 1)}>
          <ChevronLeft aria-hidden /> {t("previousStep")}
        </Button>
        <Button size="md" disabled={i >= guide.steps.length - 1} onClick={() => setI(i + 1)}>
          {t("nextStep")} <ChevronRight aria-hidden />
        </Button>
      </div>
      <div className="mt-4">
        <Notice tone="info">{guide.notSubmittedNotice}</Notice>
      </div>
    </section>
  );
}
