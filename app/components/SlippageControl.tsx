"use client";

import { useState } from "react";

// Real gap fixed 2026-08-03: slippage was hardcoded to 100bps (1%) in
// app/page.tsx's /api/quote request with no UI control at all — every
// serious swap UI exposes this. Presets match common convention (0.5/1/3%);
// custom input allows anything else, clamped to a sane range so a fat-finger
// entry can't request e.g. 50% slippage by accident.
const PRESETS_BPS = [50, 100, 300];
const MIN_BPS = 1; // 0.01%
const MAX_BPS = 5000; // 50% — generous ceiling, still guards against a stray extra zero

export function SlippageControl({ bps, onChange }: { bps: number; onChange: (bps: number) => void }) {
  const isCustomActive = !PRESETS_BPS.includes(bps);
  const [customText, setCustomText] = useState(isCustomActive ? (bps / 100).toString() : "");

  function applyCustom(text: string) {
    setCustomText(text);
    const pct = Number(text);
    if (!Number.isFinite(pct) || pct <= 0) return;
    const clamped = Math.min(MAX_BPS, Math.max(MIN_BPS, Math.round(pct * 100)));
    onChange(clamped);
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-hairline bg-surface p-2">
      <span className="px-1 text-xs text-ink-faint">Slippage</span>
      <div className="flex flex-1 items-center gap-1">
        {PRESETS_BPS.map((preset) => (
          <button
            key={preset}
            onClick={() => {
              setCustomText("");
              onChange(preset);
            }}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              bps === preset ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-hover hover:text-ink"
            }`}
          >
            {preset / 100}%
          </button>
        ))}
        <div className="relative">
          <input
            value={customText}
            onChange={(e) => applyCustom(e.target.value)}
            placeholder="Custom"
            inputMode="decimal"
            className={`num w-16 rounded-lg border px-2 py-1 text-xs outline-none transition-colors ${
              isCustomActive ? "border-accent text-accent" : "border-hairline text-ink-muted focus:border-accent"
            }`}
          />
          <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">%</span>
        </div>
      </div>
    </div>
  );
}
