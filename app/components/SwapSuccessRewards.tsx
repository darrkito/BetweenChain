"use client";

import { useEffect, useRef, useState } from "react";
import { PushNotificationToggle } from "@/app/components/PushNotificationToggle";

const SITE_URL = "https://blockchains.click";

interface Props {
  isActive: boolean; // a swap attempt is in flight (not idle, not done, not error)
  isDone: boolean;
  swapId: string | null;
}

// Post-swap retention block (2026-08-18) — the success state used to be a
// dead end for the two strongest retention loops this app already has
// built (points, referral): a generic message + a static link to
// /dashboard, no visible reward, no share surface at the moment of
// highest intent. Reuses GET /api/points (app/api/points/route.ts) and
// GET /api/referral (app/api/referral/route.ts) as-is — no new backend
// work, no new tables.
//
// Balance is snapshotted once per swap attempt (`isActive` flipping true)
// so the delta shown on completion reflects this specific swap, not
// "whatever /api/points happens to return right now". The invite link is
// generated but NOT auto-captured/redeemed on landing yet (?ref= handling)
// — that's a deliberate fast-follow, flagged in the 2026-08-18 plan, since
// it touches session/auth flow more than a copy/UI change.
export function SwapSuccessRewards({ isActive, isDone, swapId }: Props) {
  const beforeBalanceRef = useRef<number | null>(null);
  const snapshotSwapIdRef = useRef<string | null>(null);
  const resultSwapIdRef = useRef<string | null>(null);
  const [pointsEarned, setPointsEarned] = useState<number | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isActive || !swapId || snapshotSwapIdRef.current === swapId) return;
    snapshotSwapIdRef.current = swapId;
    fetch("/api/points")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) beforeBalanceRef.current = d.balance;
      })
      .catch(() => {});
  }, [isActive, swapId]);

  useEffect(() => {
    if (!isDone || !swapId || resultSwapIdRef.current === swapId) return;
    resultSwapIdRef.current = swapId;
    setPointsEarned(null);
    setInviteCode(null);
    fetch("/api/points")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && beforeBalanceRef.current !== null) setPointsEarned(Math.max(0, d.balance - beforeBalanceRef.current));
      })
      .catch(() => {});
    fetch("/api/referral")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.code) setInviteCode(d.code);
      })
      .catch(() => {});
  }, [isDone, swapId]);

  if (!isDone) return null;

  async function copyInviteLink() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(`${SITE_URL}/?ref=${inviteCode}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable/blocked — nothing else to fall back to here
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4">
      {pointsEarned !== null && pointsEarned > 0 && <p className="text-sm font-semibold text-success">+{pointsEarned} points earned</p>}
      {inviteCode && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-ink-faint">Know someone who&apos;d use this? Send them your invite link.</p>
          <button
            onClick={copyInviteLink}
            className="self-start rounded-full border border-hairline px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:border-accent/40 hover:text-ink"
          >
            {copied ? "Copied!" : "Copy invite link"}
          </button>
        </div>
      )}
      <PushNotificationToggle />
    </div>
  );
}
