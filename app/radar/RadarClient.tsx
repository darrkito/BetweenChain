"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { SOLANA_CHAIN_ID_CLIENT } from "@/lib/client/constants";

interface TrendingToken {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  verified: boolean;
}

interface TokenSafety {
  score: number;
  rugged: boolean;
  mintAuthorityRenounced: boolean;
  freezeAuthorityRenounced: boolean;
  totalHolders: number | null;
  risks: string[];
}

const QUICK_BUY_PRESETS = [10, 50, 100];
const SAFETY_FETCH_CONCURRENCY = 5;

async function fetchSafety(address: string): Promise<TokenSafety | null> {
  try {
    const res = await fetch(`/api/tokens/safety?mint=${address}`);
    if (!res.ok) return null;
    const body: { safety: TokenSafety | null } = await res.json();
    return body.safety;
  } catch {
    return null;
  }
}

function safetyColor(score: number): string {
  if (score >= 70) return "text-emerald-500";
  if (score >= 40) return "text-amber-500";
  return "text-red-500";
}

// Meme Radar (2026-08-07) — trending Solana tokens (reuses the same
// lib/chains/trending.ts data the token-select modal's "trending" rows
// already use, not new fresh-launch detection — see the plan's Context for
// why) with real RugCheck.xyz safety scores. Quick-buy chips hand off to
// /swap with a prefilled mint + USD amount; the real review modal there
// still gates every trade — this page never signs anything itself.
export function RadarClient() {
  const [tokens, setTokens] = useState<TrendingToken[] | null>(null);
  const [safetyByMint, setSafetyByMint] = useState<Record<string, TokenSafety | null>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/tokens/trending?chainId=${SOLANA_CHAIN_ID_CLIENT}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((body: { tokens: TrendingToken[] }) => {
        if (!ignore) setTokens(body.tokens);
      })
      .catch(() => {
        if (!ignore) setError("Couldn't load trending tokens right now.");
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!tokens || tokens.length === 0) return;
    let ignore = false;

    (async () => {
      // Small concurrency cap rather than firing all requests at once —
      // RugCheck's public report endpoint has no documented rate limit but
      // this app has already been burned once this session by an
      // undocumented vendor limit (Magic Eden, mid-research) treating "no
      // limit found" as "no limit exists".
      for (let i = 0; i < tokens.length; i += SAFETY_FETCH_CONCURRENCY) {
        const batch = tokens.slice(i, i + SAFETY_FETCH_CONCURRENCY);
        const results = await Promise.all(batch.map((t) => fetchSafety(t.address).then((s) => [t.address, s] as const)));
        if (ignore) return;
        setSafetyByMint((prev) => {
          const next = { ...prev };
          for (const [address, safety] of results) next[address] = safety;
          return next;
        });
      }
    })();

    return () => {
      ignore = true;
    };
  }, [tokens]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="flex flex-col gap-1 px-1">
        <h1 className="font-display text-2xl font-normal text-ink">Meme Radar</h1>
        <p className="text-sm text-ink-muted">
          Trending Solana tokens, with real safety data from{" "}
          <a href="https://rugcheck.xyz" target="_blank" rel="noopener noreferrer" className="text-accent underline">
            RugCheck.xyz
          </a>
          . Quick-buy still opens the full review step before anything signs.
        </p>
      </div>

      <Link
        href="/dust-sweeper"
        className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted transition-colors hover:border-accent/40"
      >
        🧹 Already own dust from a token like these? <span className="font-semibold text-accent">Sweep it up →</span>
      </Link>

      {error && <p className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">{error}</p>}

      {!tokens && !error && <p className="px-1 text-sm text-ink-faint">Loading trending tokens…</p>}

      {tokens && tokens.length === 0 && (
        <p className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
          No trending tokens available right now.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {tokens?.map((token) => {
          const safety = safetyByMint[token.address];
          const safetyKnown = token.address in safetyByMint;
          return (
            <div
              key={token.address}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-sm"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {token.logoURI ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external, unpredictable token-logo hosts, same as TokenIcon.tsx elsewhere in this app
                  <img src={token.logoURI} alt="" className="h-9 w-9 shrink-0 rounded-full bg-surface-hover" />
                ) : (
                  <div className="h-9 w-9 shrink-0 rounded-full bg-surface-hover" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{token.symbol}</p>
                  <p className="truncate text-xs text-ink-faint">{token.name}</p>
                </div>
              </div>

              <div className="flex min-w-[7rem] flex-col items-start gap-0.5">
                <p className="text-[11px] uppercase tracking-wide text-ink-faint">Safety</p>
                {!safetyKnown ? (
                  <p className="text-xs text-ink-faint">Checking…</p>
                ) : safety == null ? (
                  <p className="text-xs text-ink-faint">Not available</p>
                ) : (
                  <p className={`num text-sm font-semibold ${safetyColor(safety.score)}`}>
                    {safety.rugged ? "Reported rugged" : `${Math.round(safety.score)}/100`}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {QUICK_BUY_PRESETS.map((usd) => (
                  <Link
                    key={usd}
                    href={`/swap?radarMint=${encodeURIComponent(token.address)}&radarUsd=${usd}`}
                    className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold text-accent transition-all hover:border-accent/40 active:scale-95"
                  >
                    ${usd}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-ink-faint">
        Safety scores are RugCheck&apos;s own public data, shown as-is — not a guarantee. Always review the swap
        details before signing.
      </p>
    </main>
  );
}
