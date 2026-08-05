"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Submits on Enter/button click, not live-as-you-type — deliberate, not a
 * missing debounce. Every keystroke would be a real upstream call against
 * OpenSea's/Tradeport's/Magic Eden's rate-limited APIs (see each vendor's
 * searchCollections doc comment in lib/nft/{opensea,tradeport,magiceden}.ts)
 * — this app has already been burned by underestimating vendor rate limits
 * more than once this project (see the Magic Eden collection-header
 * reliability saga). A plain form submit keeps this to one request per
 * actual search, same principle as every other vendor call in this app.
 *
 * URL-driven (`?q=`), same pattern as NftChainTabs'/EvmChainSubTabs' `family`/
 * `chain` params — the Server Component page (app/nft/page.tsx) does the
 * actual fetch, this component only navigates. `family`/`chain` are passed
 * through unchanged so a search stays scoped to whichever chain tab is
 * currently active.
 */
export function NftSearchBar({ family, chain, initialQuery }: { family: string; chain?: string; initialQuery?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery ?? "");

  function navigate(q: string) {
    const params = new URLSearchParams({ family });
    if (chain) params.set("chain", chain);
    if (q.trim()) params.set("q", q.trim());
    router.push(`/nft?${params.toString()}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        navigate(value);
      }}
      className="relative flex-1"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
        <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search collections by name"
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
