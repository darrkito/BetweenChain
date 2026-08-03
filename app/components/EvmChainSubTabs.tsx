import Link from "next/link";
import { EVM_CHAINS } from "@/lib/nft/evmChains";

/**
 * Second-level chain picker, shown only under the "Ethereum" family tab —
 * OpenSea covers many EVM chains under one vendor/family (see
 * lib/nft/types.ts's NftChainFamily), unlike Solana/Move which are each a
 * single chain. Same link-based pattern as NftChainTabs so it works
 * identically on the browse page and (via the `chain` param carried through
 * a collection's own detail link) stays consistent — added 2026-07-21 when
 * Base became the first chain added beyond the original Ethereum-only
 * build. Add more chains in lib/nft/evmChains.ts, not here.
 */
export function EvmChainSubTabs({ active }: { active: string }) {
  if (EVM_CHAINS.length <= 1) return null;
  return (
    <div className="flex gap-1.5">
      {EVM_CHAINS.map((c) => {
        const isActive = c.slug === active;
        return (
          <Link
            key={c.slug}
            href={`/nft?family=evm&chain=${c.slug}`}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-hairline text-ink-muted hover:bg-surface-hover hover:text-ink"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Relay's hosted chain icon assets, same source used site-wide */}
            <img src={c.iconUrl} alt="" width={14} height={14} className="h-3.5 w-3.5 shrink-0 rounded-full" />
            {c.label}
          </Link>
        );
      })}
    </div>
  );
}
