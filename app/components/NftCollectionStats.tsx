import { TRADEPORT_FEE_SAFETY_MARGIN } from "@/lib/nft/tradeportFee";
import { magicEdenBuyerTotal } from "@/lib/nft/magicedenFee";
import { roundUpTo3Decimals } from "@/lib/client/amount";
import type { NftCollection } from "@/lib/nft/types";

function Stat({ label, value, title, emphasize }: { label: string; value: string; title?: string; emphasize?: boolean }) {
  return (
    <div
      className={`flex min-w-[92px] flex-1 flex-col gap-0.5 rounded-xl px-3 py-2 sm:flex-none ${emphasize ? "bg-accent-soft" : ""}`}
      title={title}
    >
      <span className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
      <span className={`num text-[15px] font-semibold ${emphasize ? "text-accent" : "text-ink"}`}>{value}</span>
    </div>
  );
}

export interface ListedCountInfo {
  count: number;
  approximate: boolean;
  loading: boolean;
  floorPrice?: string;
  floorPriceCurrency?: string;
  // Magic Eden only (see app/api/nft/listed-count/route.ts) — its
  // per-collection endpoint exposes 7d volume, not 24h, at zero extra call
  // cost since it's already in the same response used for floor/listedCount.
  volume?: string;
  volumeCurrency?: string;
  volumePeriodDays?: number;
}

export interface TotalSupplyInfo {
  value: number | null; // null = looked up but genuinely unavailable (e.g. no listings to resolve a sample mint from)
  loading: boolean;
}

/**
 * Renders whatever the vendor actually gives us — fields are NOT symmetric
 * across vendors (confirmed live 2026-07-20): Magic Eden's public API gives
 * listedCount but no totalSupply; OpenSea gives totalSupply + floor + 24hr
 * volume but no cheap listedCount. Every value here is real vendor data or
 * "—", never computed/guessed to fill a gap — see lib/nft/types.ts's
 * NftCollection comment for the full breakdown of what's available where.
 * 24hr floor-price-change isn't exposed by any researched vendor, so that
 * column is permanently "—" until one adds it, not silently dropped.
 *
 * `listedCountInfo` overrides `collection.listedCount` when present — used
 * for OpenSea, where the count isn't free (see lib/nft/opensea.ts's
 * countOpenSeaListedItems) and is fetched separately/lazily by the caller
 * rather than baked into the collection object itself. `totalSupplyInfo` is
 * the Magic Eden equivalent in the other direction — ME gives listedCount
 * for free but no total supply; resolved via Helius DAS (lib/chains/
 * heliusDas.ts, needs a sample mint from an active listing to find the
 * on-chain collection address at all — a collection with zero listings has
 * no cheap way to resolve it, surfaced as `value: null`, not silently "—"
 * with no explanation).
 */
export function NftCollectionStats({
  collection,
  listedCountInfo,
  totalSupplyInfo,
  magicEdenRoyaltyBps,
}: {
  collection: NftCollection;
  listedCountInfo?: ListedCountInfo;
  totalSupplyInfo?: TotalSupplyInfo;
  // Real royalty rate (sellerFeeBasisPoints) from a currently-loaded
  // listing in this same collection — Metaplex sets this per-collection,
  // so any loaded listing's rate is representative, not just the exact
  // floor listing's. Undefined falls back to magicEdenBuyerTotal's own
  // default (see that function's doc).
  magicEdenRoyaltyBps?: number;
}) {
  const totalSupply = totalSupplyInfo?.value ?? collection.totalSupply;
  const listedCount = listedCountInfo?.count ?? collection.listedCount;
  const hasListedRatio = listedCount != null && totalSupply != null;
  const listedPct = hasListedRatio ? `${((listedCount! / totalSupply!) * 100).toFixed(1)}%` : "—";
  const approximatePrefix = listedCountInfo?.approximate ? "≈" : "";

  // Explains WHY it's missing, not just that it is — this genuinely differs
  // by vendor (see the file-top comment) rather than being a bug, and a bare
  // "—" reads as broken without the reason.
  const listedGapTitle =
    collection.vendor === "magiceden" && totalSupply == null
      ? "Couldn't determine this collection's total supply — it may have no active listings to resolve it from"
      : undefined;

  const totalSupplyValue = totalSupplyInfo?.loading ? "…" : totalSupply != null ? totalSupply.toLocaleString() : "—";

  const listedValue = listedCountInfo?.loading || totalSupplyInfo?.loading
    ? "counting…"
    : listedCount != null
      ? `${approximatePrefix}${listedCount.toLocaleString()} / ${totalSupply?.toLocaleString() ?? "—"}`
      : "—";

  // Prefer the floor computed live from actual listings (see
  // lib/nft/opensea.ts's countOpenSeaListedItems) over collection.floorPrice
  // (OpenSea's /stats field) — confirmed live 2026-07-20 the two can
  // genuinely disagree (stats reported a stale/lower floor than any listing
  // OpenSea's own listings endpoint actually returns). Magic Eden's
  // collection.floorPrice has no such discrepancy — untouched here.
  const floorPrice = listedCountInfo?.floorPrice ?? collection.floorPrice;
  const floorPriceCurrency = listedCountInfo?.floorPriceCurrency ?? collection.floorPriceCurrency;
  // Real bug found live 2026-07-22 (Tradeport), extended 2026-08-05 (Magic
  // Eden, real user report): the raw floor field is accurate against each
  // vendor's own listings table, but the listing GRID cards show a
  // fee-inclusive price (displayedListingPrice) while this stat kept
  // showing the raw, un-marked-up number — the two no longer agreed on
  // "the price of the cheapest asset," reading as a wrong floor. Apply the
  // same total here for both vendors that need it — OpenSea's raw price
  // genuinely already is the full cost, untouched.
  const floorPriceDisplay =
    floorPrice == null
      ? null
      : collection.vendor === "tradeport"
        ? roundUpTo3Decimals(Number(floorPrice) * (1 + TRADEPORT_FEE_SAFETY_MARGIN))
        : collection.vendor === "magiceden"
          ? roundUpTo3Decimals(magicEdenBuyerTotal(Number(floorPrice), magicEdenRoyaltyBps))
          : Number(floorPrice).toFixed(3);

  // listedCountInfo.volume (Magic Eden, 7d) takes priority when present,
  // same override pattern as floorPrice above — collection.volume24hr is
  // OpenSea's true 24h figure, sourced directly on the collection object
  // instead since OpenSea doesn't need a deferred second call for it.
  const volumeValue = listedCountInfo?.volume ?? collection.volume24hr;
  const volumeCurrency = listedCountInfo?.volumeCurrency ?? collection.volume24hrCurrency;
  const volumePeriodDays = listedCountInfo?.volumePeriodDays ?? collection.volumePeriodDays ?? 1;
  const volumeLabel = volumePeriodDays === 1 ? "24hr Volume" : `${volumePeriodDays}d Volume`;

  return (
    <div className="flex flex-wrap gap-1.5 overflow-x-auto rounded-2xl border border-hairline bg-surface p-2 shadow-sm sm:flex-nowrap">
      <Stat
        label="Floor Price"
        value={floorPriceDisplay != null ? `${floorPriceDisplay} ${floorPriceCurrency ?? ""}` : "—"}
        // OpenSea's floorPrice is computed live from actual listings (see
        // countOpenSeaListedItems) and can genuinely disagree with its own
        // /stats endpoint. Magic Eden's is now fetched via a separate
        // deferred call too (2026-08-04, see getMagicEdenCollectionStats)
        // but it's still literally the SAME /stats endpoint value as
        // before, just no longer bundled into the main collection fetch —
        // the OpenSea-specific "can disagree" caveat doesn't apply to it.
        title={
          collection.vendor === "opensea" && listedCountInfo?.floorPrice != null
            ? "Computed from the cheapest currently-listed item, not OpenSea's stats endpoint (the two can disagree)"
            : undefined
        }
        emphasize
      />
      <Stat
        label={volumeLabel}
        value={volumeValue != null ? `${Number(volumeValue).toFixed(2)} ${volumeCurrency ?? ""}` : "—"}
      />
      <Stat
        label="Listed / Total"
        value={listedValue}
        title={listedCountInfo?.approximate ? "Counted the first 2,000 active listings — this collection has more than that" : listedGapTitle}
      />
      <Stat
        label="Listed %"
        value={listedCountInfo?.loading ? "…" : listedPct}
        title={hasListedRatio ? undefined : listedGapTitle}
      />
      <Stat label="Total Assets" value={totalSupplyValue} />
      <Stat label="24hr Change" value="—" title="Not exposed by this collection's data source yet" />
    </div>
  );
}
