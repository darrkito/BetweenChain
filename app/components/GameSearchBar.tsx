"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Same submit-on-Enter/click pattern as NftSearchBar.tsx — unlike that
// component this filters a small static in-repo array (no vendor rate
// limit to protect), but URL-driven filtering stays the established
// convention for this app's server-rendered listing pages, so kept
// consistent rather than switching to live-as-you-type here alone.
export function GameSearchBar({ category, genre, initialQuery }: { category?: string; genre?: string; initialQuery?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery ?? "");

  function navigate(q: string) {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (genre) params.set("genre", genre);
    if (q.trim()) params.set("q", q.trim());
    router.push(`/games?${params.toString()}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        navigate(value);
      }}
      className="relative flex-1"
    >
      <button
        type="submit"
        aria-label="Search"
        className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-faint transition-colors hover:text-ink"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search games"
        className="w-full rounded-xl border border-hairline bg-surface py-2.5 pl-10 pr-16 text-sm text-ink outline-none transition-colors focus:border-accent"
      />
      {initialQuery && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            navigate("");
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-ink-faint hover:text-ink"
        >
          Clear
        </button>
      )}
    </form>
  );
}
