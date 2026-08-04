import { AppHeader } from "@/app/components/AppHeader";
import { NftCollectionsGridSkeleton } from "@/app/components/NftCollectionsGrid";

/**
 * 2026-08-04 — added alongside converting app/nft/page.tsx to a Server
 * Component. Next.js's App Router shows nothing (not the previous page,
 * not a blank flash-free transition) during a slow async page's
 * server-side data fetch unless a loading.tsx exists for that route
 * segment — this is that boundary, reusing the exact skeleton the old
 * client-fetching version showed during its own loading state, so the
 * visual experience during a tab switch is unchanged.
 */
export default function NftBrowseLoading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <NftCollectionsGridSkeleton />
    </main>
  );
}
