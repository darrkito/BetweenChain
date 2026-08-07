import Link from "next/link";

const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  { id: "token", label: "Tokens" },
  { id: "nft-collection", label: "NFT Collections" },
  { id: "community", label: "Community" },
];

// Link-based, URL-driven — same convention as NftChainTabs.tsx (renders
// identically whether driven by a real user click or by a direct link,
// since it's just reflecting the current `?category=` param, not local
// component state).
export function GameCategoryTabs({ active }: { active: string }) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-2xl border border-hairline bg-surface p-1.5 shadow-sm">
      {CATEGORIES.map((c) => {
        const isActive = c.id === active;
        return (
          <Link
            key={c.id}
            href={c.id === "all" ? "/games" : `/games?category=${c.id}`}
            className={`flex-1 rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors ${
              isActive ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-hover hover:text-ink"
            }`}
          >
            {c.label}
          </Link>
        );
      })}
    </div>
  );
}
