import "server-only";
import { cached } from "@/lib/cache";

const RUGCHECK_API = "https://api.rugcheck.xyz/v1";
const RUGCHECK_TTL_MS = 300_000;

// Live-verified public/keyless report fields (2026-08-07, against a real
// mint) — RugCheck's basic report endpoint needs no API key. Only the
// fields this app actually surfaces are typed here; the real response has
// more (topHolders detail, lockers, markets, etc).
interface RugcheckReport {
  mint: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  totalHolders?: number;
  totalMarketLiquidity?: number;
  rugged: boolean;
  score: number;
  score_normalised: number;
  risks?: Array<{ name: string; description: string; level: string }>;
}

export interface TokenSafety {
  mint: string;
  score: number; // score_normalised, 0-100, higher = safer (RugCheck's own scale)
  rugged: boolean;
  mintAuthorityRenounced: boolean;
  freezeAuthorityRenounced: boolean;
  totalHolders: number | null;
  risks: string[];
}

// Solana-only — RugCheck has no EVM coverage. Returns null on any failure
// (unknown mint, rate limit, etc) rather than a fabricated/default score —
// callers must render "Not available", never a guessed number.
export async function getTokenSafety(mint: string): Promise<TokenSafety | null> {
  try {
    return await cached(`rugcheck:${mint}`, RUGCHECK_TTL_MS, async () => {
      const res = await fetch(`${RUGCHECK_API}/tokens/${mint}/report`, { cache: "no-store" });
      if (!res.ok) return null;
      const report = (await res.json()) as RugcheckReport;
      return {
        mint: report.mint,
        score: report.score_normalised,
        rugged: report.rugged,
        mintAuthorityRenounced: report.mintAuthority == null,
        freezeAuthorityRenounced: report.freezeAuthority == null,
        totalHolders: report.totalHolders ?? null,
        risks: (report.risks ?? []).map((r) => r.name),
      };
    });
  } catch {
    return null;
  }
}
