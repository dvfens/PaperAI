"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Mobile bottom sheet (centred card on larger screens), shadcn/ui-style on top of Radix Dialog. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  closeLabel,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  closeLabel: string;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-900/45" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-[2rem] bg-white px-5 pt-3 pb-safe shadow-2xl focus:outline-none",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,30rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[2rem] sm:pb-6",
            className,
          )}
        >
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 sm:hidden" aria-hidden />
          <div className="mb-3 flex items-start justify-between gap-3">
            <DialogPrimitive.Title className="pt-1 text-2xl font-bold text-slate-900">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="-mr-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
              aria-label={closeLabel}
            >
              <X className="size-6" />
            </DialogPrimitive.Close>
          </div>
          {description ? (
            <DialogPrimitive.Description className="mb-4 text-lg text-slate-600">{description}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
