import Image from "next/image";
import { NftImage } from "@/app/components/NftImage";
import { proxiedImageUrl } from "@/lib/client/imageProxy";
import type { NftCollection } from "@/lib/nft/types";

/**
 * Magic-Eden-style collection header — full-width banner with a circular
 * avatar cut into its bottom edge, replacing the old flat icon+name bar
 * (2026-08-03 visual pass). `bannerImageUrl` is only populated for OpenSea
 * collections today (see lib/nft/opensea.ts) — Magic Eden/Tradeport
 * collections have no banner field in their public API, so they fall back to
 * a blurred, oversized crop of the avatar image itself as the banner, a
 * common trick (Spotify/Twitter use it for the same reason) that reads as
 * intentional rather than "missing image."
 */
export function NftCollectionHero({ collection }: { collection: NftCollection }) {
  const bannerSrc = collection.bannerImageUrl ?? collection.imageUrl;

  return (
    <div className="flex flex-col">
      <div className="relative h-32 w-full overflow-hidden rounded-2xl border border-hairline bg-surface sm:h-48">
        {bannerSrc ? (
          // Routed through /api/img (2026-08-04) — see lib/client/imageProxy.ts
          <Image
            src={proxiedImageUrl(bannerSrc)}
            alt=""
            aria-hidden="true"
            fill
            sizes="(max-width: 640px) 100vw, 768px"
            className={`object-cover ${collection.bannerImageUrl ? "" : "scale-125 blur-2xl"}`}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-accent-soft via-surface to-accent-soft" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface/70 via-transparent to-black/10" />
      </div>

      <div className="flex items-end gap-4 px-1">
        <div className="-mt-10 shrink-0 rounded-full ring-4 ring-canvas sm:-mt-12">
          <NftImage src={collection.imageUrl} alt={collection.name} className="h-20 w-20 rounded-full sm:h-24 sm:w-24" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pb-1 pt-2">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-bold tracking-tight text-ink sm:text-2xl">{collection.name}</h1>
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-accent">
              {collection.vendor}
            </span>
          </div>
          {collection.description && (
            <p className="line-clamp-2 max-w-2xl text-sm text-ink-muted">{collection.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function NftCollectionHeroSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="skeleton h-32 w-full rounded-2xl sm:h-48" />
      <div className="flex items-end gap-4 px-1">
        <div className="-mt-10 shrink-0 rounded-full ring-4 ring-canvas sm:-mt-12">
          <div className="skeleton h-20 w-20 rounded-full sm:h-24 sm:w-24" />
        </div>
        <div className="flex flex-1 flex-col gap-2 pb-2 pt-4">
          <div className="skeleton h-5 w-40 rounded" />
          <div className="skeleton h-3.5 w-64 rounded" />
        </div>
      </div>
    </div>
  );
}
