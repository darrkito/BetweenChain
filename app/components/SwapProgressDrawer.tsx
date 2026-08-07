"use client";

import { AnimatePresence, motion } from "motion/react";
import { SwapStepper, type SwapStep } from "@/app/components/SwapStepper";
import { usePrefersReducedMotion } from "@/lib/client/usePrefersReducedMotion";

// Slide-out transaction-progress drawer (2026-08-07) — same motion/
// AnimatePresence mechanics as the (now header-unwired) ActivityDrawer.tsx,
// a new component for a different purpose, not a resurrection of that one.
// Renders the existing, already-real SwapStepper unchanged — this drawer is
// presentation chrome only; the actual source/bridge/destination-aware step
// LABELS are built by the caller (SwapPageClient.tsx, which has the real
// chain names) and passed in via `steps`, not decided here.
export function SwapProgressDrawer({
  open,
  onClose,
  steps,
  currentIndex,
  erroredIndex,
  beamIndex,
}: {
  open: boolean;
  onClose: () => void;
  steps: SwapStep[];
  currentIndex: number;
  erroredIndex: number | null;
  beamIndex?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col gap-5 overflow-y-auto border-l border-hairline bg-surface p-5 shadow-xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.25, ease: "easeOut" }}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-normal text-ink">Transaction progress</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:text-ink"
              >
                ✕
              </button>
            </div>

            {/* Closing this drawer never cancels the swap — runSwap() keeps
                running independent of whether this UI is visible; "View
                progress" in SwapPageClient reopens it. */}
            <SwapStepper steps={steps} currentIndex={currentIndex} erroredIndex={erroredIndex} beamIndex={beamIndex} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
