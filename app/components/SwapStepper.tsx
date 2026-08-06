export interface SwapStep {
  key: string;
  label: string;
}

/**
 * Replaces the old single-line, overwritten-in-place status message for a
 * multi-minute (especially cross-chain) swap — a user who looked away mid-flow
 * had no way to tell which stage they were actually at. `steps` is built by
 * the caller based on the flow shape (same-chain vs cross-chain — see
 * app/page.tsx), `currentIndex` is which one is active right now, `erroredIndex`
 * (if set) marks the one that failed instead of completing.
 */
export function SwapStepper({
  steps,
  currentIndex,
  erroredIndex,
  beamIndex,
}: {
  steps: SwapStep[];
  currentIndex: number;
  erroredIndex: number | null;
  /** Index of the Relay/bridge-leg step, if this flow has one — while that
   * step is active (not done, not errored), the connector leading out of it
   * animates as an "in flight" beam instead of the plain pending fill. See
   * app/globals.css's .step-beam (2026-08-06 visual pass). */
  beamIndex?: number;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-hairline bg-surface p-3">
      {steps.map((s, i) => {
        const isError = erroredIndex === i;
        const isDone = erroredIndex === null && i < currentIndex;
        const isActive = erroredIndex === null && i === currentIndex;
        const isBeaming = isActive && beamIndex === i;
        return (
          <div key={s.key} className="flex flex-1 items-center gap-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  isError
                    ? "bg-danger text-white"
                    : isDone
                      ? "bg-success text-white"
                      : isActive
                        ? "animate-pulse bg-accent text-accent-ink"
                        : "bg-surface-hover text-ink-faint"
                }`}
              >
                {isError ? "✕" : isDone ? "✓" : i + 1}
              </div>
              <span
                className={`whitespace-nowrap text-[11px] font-medium ${
                  isError ? "text-danger" : isActive ? "text-ink" : isDone ? "text-ink-muted" : "text-ink-faint"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 flex-1 rounded-full ${isBeaming ? "step-beam" : isDone ? "bg-success" : "bg-hairline"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
