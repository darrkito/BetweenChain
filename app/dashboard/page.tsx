"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/app/components/AppHeader";
import { PointsCalculator } from "@/app/components/PointsCalculator";
import { TierBadge } from "@/app/components/TierBadge";
import { DustBurner } from "@/app/components/DustBurner";

export default function DashboardPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [referralCount, setReferralCount] = useState<number | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/points")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        setBalance(d.balance);
        setReferralCount(d.referralCount);
      })
      .catch(() => setMessage("Sign in on the swap page to see your points."));

    fetch("/api/referral")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setInviteCode(d.code))
      .catch(() => {});
  }, []);

  async function redeem() {
    const res = await fetch("/api/referral", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: redeemCode }),
    });
    const body = await res.json();
    setMessage(res.ok ? "Invite code applied." : body.error);
  }

  return (
    // Widened to match the same max-w-5xl AppHeader convention every other
    // page uses (same fix as blog/faq — real user report: some pages
    // rendered a visibly narrower header/nav than others).
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <h1 className="font-display px-1 text-2xl font-normal text-ink">Dashboard</h1>

        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
          <p className="text-sm text-ink-muted">Points balance <span className="text-ink-faint">($1 volume = 1 point)</span></p>
          <p className="num text-4xl font-semibold text-ink">{balance ?? "—"}</p>
          <TierBadge balance={balance} />
          <p className="num text-sm text-ink-muted">{referralCount ?? "—"} referrals</p>
        </section>

        <PointsCalculator />

        <DustBurner />

        <section className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
          <p className="text-sm text-ink-muted">Your invite code</p>
          <p className="num text-lg font-medium text-accent">{inviteCode ?? "—"}</p>
          <p className="text-xs text-ink-faint">Referrals earn you 20% of their swap volume as points; they get a 10% bonus.</p>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
          <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
            Have an invite code?
            <input
              className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value)}
            />
          </label>
          <button
            onClick={redeem}
            className="self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98]"
          >
            Apply code
          </button>
        </section>

        {message && (
          <p className="rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">{message}</p>
        )}
      </div>
    </main>
  );
}
