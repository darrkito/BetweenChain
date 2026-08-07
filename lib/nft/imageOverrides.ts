import type { NftCollection } from "@/lib/nft/types";

// Manual per-collection image overrides (2026-08-07) — real, user-supplied
// URLs, used when a vendor's own served image is broken/unavailable
// (Popkins/Tradeport, confirmed by the user directly) or when a better
// official banner exists than what the vendor's API returns (Claynosaurz/
// Saga). Every URL here was verified live (`curl -sI`, real 200) before
// being added. Keyed by `${vendor}:${slug}` — the same addressing this app
// already uses for `/nft/[vendor]/[slug]`.
const NFT_IMAGE_OVERRIDES: Record<string, { imageUrl?: string; bannerImageUrl?: string }> = {
  "magiceden:claynosaurz": {
    bannerImageUrl: "https://static.fwimg.io/img/feed/d0b29929c535f22d2862c7a11cb340b5.jpg",
  },
  "magiceden:saga": {
    bannerImageUrl: "https://pbs.twimg.com/media/FzUpgb1aYAAty7J.jpg",
  },
  "tradeport:0xb908f3c6fea6865d32e2048c520cdfe3b5c5bbcebb658117c41bad70f52b7ccc::popkins_nft::Popkins": {
    imageUrl: "https://pbs.twimg.com/media/GqbmT3IWQAA2LhE.jpg",
    bannerImageUrl: "https://assets.games.gg/Claynosaurz_Popkins_NF_Ts_Launching_on_Sui_3d02b5b31d.png",
  },
};

export function applyNftImageOverride(vendor: string, slug: string, collection: NftCollection): NftCollection {
  const override = NFT_IMAGE_OVERRIDES[`${vendor}:${slug}`];
  if (!override) return collection;
  return {
    ...collection,
    imageUrl: override.imageUrl ?? collection.imageUrl,
    bannerImageUrl: override.bannerImageUrl ?? collection.bannerImageUrl,
  };
}
