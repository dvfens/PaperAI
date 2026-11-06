"use client";

import { ChevronLeft, ChevronRight, FileStack, Info, ListChecks, Signature, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GuideStep, NextStepsGuide, PageImage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, IconButton, Notice, SectionTitle, SpeakButton } from "@/components/common/Chrome";
import { DocumentPreview } from "@/components/DocumentPreview";
import { useApp } from "@/components/app/AppContext";

const ICONS: Record<GuideStep["kind"], typeof Signature> = {
  sign: Signature,
  attach: FileStack,
  submit: Store,
  check: ListChecks,
  info: Info,
};

/** Screen 6 — what to do next, one step card at a time, read aloud. */
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

  // No steps: still show the section header, so the notice is not stuck to the card above it.
  if (!step)
    return (
      <section aria-labelledby="next-steps">
        <SectionTitle icon={ListChecks}>
          <span id="next-steps">{t("nextSteps")}</span>
        </SectionTitle>
        <Notice tone="info">{guide.notSubmittedNotice}</Notice>
      </section>
    );
  const Icon = ICONS[step.kind];
  const total = guide.steps.length;
  const stepOf = t("stepOf", { n: i + 1, total });

  return (
    <section aria-labelledby="next-steps">
      <SectionTitle icon={ListChecks} right={<SpeakButton text={`${guide.intro} ${stepOf}. ${stepText}`} />}>
        <span id="next-steps">{t("nextSteps")}</span>
      </SectionTitle>

      <Card className="p-5">
        {/* Progress dots */}
        <div className="flex flex-wrap items-center justify-center gap-2" aria-hidden>
          {guide.steps.map((_, k) => (
            <span
              key={k}
              className={cn(
                "h-2.5 rounded-full transition-all",
                k === i ? "w-8 bg-blue-600" : k < i ? "w-2.5 bg-blue-300" : "w-2.5 bg-slate-200",
              )}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-col items-center text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-blue-50 text-blue-700">
            <Icon className="size-8" aria-hidden />
          </span>
          <h3 className="mt-3 text-xl font-bold text-pretty text-slate-900">{step.title}</h3>
          <p className="mt-1 text-lg text-pretty text-slate-700">{step.detail}</p>
        </div>

        {step.kind === "sign" && step.box && pages[step.box.page] && (
          <DocumentPreview
            pages={pages}
            highlights={[{ box: step.box, tone: "sign", label: t("statusByHand") }]}
            alt={t("completed")}
            className="mt-5"
            maxPages={step.box.page + 1}
          />
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <IconButton
            icon={ChevronLeft}
            label={t("previousStep")}
            tone="soft"
            className="size-14"
            disabled={i === 0}
            onClick={() => setI(i - 1)}
          />
          <p className="text-lg font-bold text-slate-700" aria-live="polite">
            <span aria-hidden>
              {i + 1} / {total}
            </span>
            <span className="sr-only">{stepOf}</span>
          </p>
          <IconButton
            icon={ChevronRight}
            label={t("nextStep")}
            tone="soft"
            className="size-14 bg-blue-600 text-white hover:bg-blue-700"
            disabled={i >= total - 1}
            onClick={() => setI(i + 1)}
          />
        </div>
      </Card>

      <div className="mt-3">
        <Notice tone="info">{guide.notSubmittedNotice}</Notice>
      </div>
    </section>
  );
}
