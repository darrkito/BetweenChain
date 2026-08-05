import "server-only";
import { cached } from "@/lib/cache";

// Helius DAS (Digital Asset Standard) — exposed on the same JSON-RPC
// endpoint as regular Solana RPC calls, not a separate URL/key. Uses the
// same dedicated key already configured for wallet/transaction RPC calls
// elsewhere in this app (NEXT_PUBLIC_SOLANA_RPC_URL) — no new credential
// needed. This closes the "total supply" gap flagged since 2026-07-20i:
// Magic Eden's public API has no total-supply field for a collection, only
// listedCount.
const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const TOTAL_SUPPLY_TTL_MS = 60 * 60_000; // a collection's total supply essentially never changes

interface DasRpcResponse<T> {
  result?: T;
  error?: { message: string };
}

async function dasRpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "sbc", method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Helius DAS ${method} failed (${res.status})`);
  const body = (await res.json()) as DasRpcResponse<T>;
  if (body.error) throw new Error(`Helius DAS ${method} error: ${body.error.message}`);
  return body.result as T;
}

/**
 * A Magic Eden collection "symbol"/slug has no relationship to the actual
 * on-chain Metaplex collection mint address DAS needs — the only way to find
 * it is via a known NFT that belongs to the collection. `getAsset`'s
 * `grouping` array gives that for any real mint. Callers should pass a mint
 * from an actual listing (see getMagicEdenListings) — a collection with zero
 * current listings has no cheap way to resolve this, and total supply stays
 * unavailable ("—") for it, same honesty-over-guessing rule as everywhere
 * else in this stats work.
 */
async function getCollectionMintFromSample(sampleMint: string): Promise<string | undefined> {
  // Cached by sampleMint (cheap either way, but avoids re-resolving the same
  // token's grouping on repeat calls within the TTL).
  return cached(`helius:das:grouping:${sampleMint}`, TOTAL_SUPPLY_TTL_MS, async () => {
    const asset = await dasRpc<{ grouping?: Array<{ group_key: string; group_value: string }> }>("getAsset", { id: sampleMint });
    return asset.grouping?.find((g) => g.group_key === "collection")?.group_value;
  });
}

export interface DasAssetSummary {
  mint: string;
  name?: string;
  imageUrl?: string;
  traits?: Array<{ traitType: string; value: string }>;
}

// Real shape confirmed live 2026-08-05 (curl against a real Mad Lads asset)
// — `content.links.image` is the field to use (matches `content.metadata.
// name`/`.attributes` for the other display fields); `content.files` also
// carries the same image URL redundantly but links.image is the documented,
// stable field.
interface RawDasAsset {
  id: string;
  content?: {
    metadata?: { name?: string; attributes?: Array<{ trait_type: string; value: string }> };
    links?: { image?: string };
  };
}

/**
 * Full on-chain collection inventory, page-based (DAS's own pagination
 * shape, unlike Magic Eden's offset-based listings) — regardless of Magic
 * Eden marketplace listing status. Same role as lib/nft/opensea.ts's
 * getOpenSeaAllAssets: powers the "All items" toggle for a vendor with no
 * confirmed native full-inventory endpoint of its own (see
 * lib/nft/magiceden.ts's getMagicEdenAllAssets — Magic Eden's public API
 * genuinely has none, confirmed via extensive doc research, same as the
 * total-supply gap this file already closes). Needs a real sample mint to
 * resolve the on-chain collection address first — same limitation as
 * getCollectionTotalSupply, a collection with zero current listings has no
 * cheap way to resolve this and "All items" simply isn't available for it,
 * same honesty-over-guessing rule as everywhere else in this stats work.
 */
export async function getCollectionAssetsPage(
  sampleMint: string,
  page: number,
  limit: number,
): Promise<{ items: DasAssetSummary[]; hasMore: boolean } | undefined> {
  const collectionMint = await getCollectionMintFromSample(sampleMint);
  if (!collectionMint) return undefined;
  return cached(`helius:das:assetspage:${collectionMint}:${page}:${limit}`, TOTAL_SUPPLY_TTL_MS, async () => {
    const result = await dasRpc<{ items?: RawDasAsset[] }>("getAssetsByGroup", {
      groupKey: "collection",
      groupValue: collectionMint,
      page,
      limit,
    });
    const items = result.items ?? [];
    return {
      items: items.map((a) => ({
        mint: a.id,
        name: a.content?.metadata?.name,
        imageUrl: a.content?.links?.image,
        traits: a.content?.metadata?.attributes?.map((t) => ({ traitType: t.trait_type, value: t.value })),
      })),
      hasMore: items.length === limit,
    };
  });
}

/**
 * Confirmed live 2026-07-20: the plain `total` field in getAssetsByGroup's
 * response is bounded by `limit` (NOT the collection's real size, despite
 * what Helius's own prose docs imply at a skim) — `grand_total` is the real
 * count, and only appears when `options.showGrandTotal: true` is explicitly
 * set (slower query, deliberately not the default). Verified against Okay
 * Bears (~9,858 via DAS, matches the known ~10k supply) before trusting this.
 */
export async function getCollectionTotalSupply(sampleMint: string): Promise<number | undefined> {
  const collectionMint = await getCollectionMintFromSample(sampleMint);
  if (!collectionMint) return undefined;
  // Cached by the resolved collection mint (not the sample mint) so any two
  // listings from the same collection share one cached grand_total lookup,
  // instead of paying for it once per distinct sample.
  return cached(`helius:das:totalsupply:${collectionMint}`, TOTAL_SUPPLY_TTL_MS, async () => {
    const result = await dasRpc<{ grand_total?: number }>("getAssetsByGroup", {
      groupKey: "collection",
      groupValue: collectionMint,
      page: 1,
      limit: 1,
      options: { showGrandTotal: true },
    });
    return result.grand_total;
  });
}
