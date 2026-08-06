"use client";

import { useState } from "react";
import { REFERRER_SHARE, REFERRED_BONUS } from "@/lib/pointsConstants";

// Interactive preview for the dashboard (2026-08-06 UX audit pass) — pure
// client-side math off the same real constants lib/points.ts actually credits
// with (via lib/pointsConstants.ts, not a second hardcoded copy). No API
// call: this is a "what would X be worth" preview, not a real balance.
const MIN_VOLUME = 0;
const MAX_VOLUME = 50_000;
const DEFAULT_VOLUME = 5_000;

export function PointsCalculator() {
  const [volume, setVolume] = useState(DEFAULT_VOLUME);

  const ownPoints = Math.floor(volume);
  const referrerBonusPoints = Math.floor(volume * REFERRER_SHARE);
  const referredBonusPoints = Math.floor(volume * REFERRED_BONUS);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
      <p className="text-sm text-ink-muted">Points calculator</p>
      <label className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-faint">Your monthly trading volume</span>
          <span className="num text-sm font-semibold text-ink">${volume.toLocaleString()}</span>
        </div>
        <input
          type="range"
          min={MIN_VOLUME}
          max={MAX_VOLUME}
          step={100}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
      </label>
      <div className="flex flex-col gap-2 rounded-xl bg-surface-hover px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-muted">Points you&apos;d earn</span>
          <span className="num text-sm font-semibold text-ink">{ownPoints.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-muted">If a friend traded this much (your referral bonus)</span>
          <span className="num text-sm font-semibold text-ink">{referrerBonusPoints.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-muted">Their bonus for being referred by you</span>
          <span className="num text-sm font-semibold text-ink">{referredBonusPoints.toLocaleString()}</span>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-faint">
        Illustrative only — 1 point per $1 of real trading volume, referral bonuses shown separately since they apply
        to different people&apos;s volume, not stacked on top of your own.
      </p>
    </section>
  );
}
