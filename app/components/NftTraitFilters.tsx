"use client";

import { useMemo, useState } from "react";
import type { NftListing } from "@/lib/nft/types";

export type TraitSelection = Record<string, Set<string>>;

/**
 * Derives the available trait_type -> value options (with counts) from
 * whatever listings are currently loaded. This is a filter over the loaded
 * batch, not a full-collection trait index — the marketplace APIs don't
 * expose a lightweight "all trait values for this collection" endpoint
 * separate from listing data, so the filter options only grow as more
 * listings load. Good enough for browsing a page of listings; not a
 * substitute for a real catalog-wide trait search.
 */
function deriveTraitOptions(listings: NftListing[]): Map<string, Map<string, number>> {
  const byType = new Map<string, Map<string, number>>();
  for (const l of listings) {
    for (const t of l.traits ?? []) {
      const values = byType.get(t.traitType) ?? new Map<string, number>();
      values.set(t.value, (values.get(t.value) ?? 0) + 1);
      byType.set(t.traitType, values);
    }
  }
  return byType;
}

export function matchesTraitSelection(listing: NftListing, selection: TraitSelection): boolean {
  for (const [traitType, values] of Object.entries(selection)) {
    if (values.size === 0) continue;
    const hasMatch = (listing.traits ?? []).some((t) => t.traitType === traitType && values.has(t.value));
    if (!hasMatch) return false; // AND across trait types
  }
  return true;
}

function TraitGroup({
  traitType,
  values,
  selected,
  onToggle,
}: {
  traitType: string;
  values: Map<string, number>;
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-hairline py-2.5 last:border-0">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-ink"
      >
        {traitType}
        <span className={`text-ink-faint transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true">
          ⌄
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1">
          {Array.from(values.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([value, count]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-surface-hover">
                <input
                  type="checkbox"
                  checked={selected.has(value)}
                  onChange={() => onToggle(value)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                <span className="flex-1 truncate text-ink-muted">{value}</span>
                <span className="num text-xs text-ink-faint">{count}</span>
              </label>
            ))}
        </div>
      )}
    </div>
  );
}

export function NftTraitFilters({
  listings,
  selection,
  onChange,
}: {
  listings: NftListing[];
  selection: TraitSelection;
  onChange: (next: TraitSelection) => void;
}) {
  const options = useMemo(() => deriveTraitOptions(listings), [listings]);

  if (options.size === 0) return null;

  function toggle(traitType: string, value: string) {
    const next: TraitSelection = { ...selection };
    const current = new Set(next[traitType] ?? []);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    next[traitType] = current;
    onChange(next);
  }

  const activeCount = Object.values(selection).reduce((n, s) => n + s.size, 0);

  return (
    <div className="flex flex-col rounded-2xl border border-hairline bg-surface p-3.5 shadow-sm">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-sm font-semibold text-ink">Traits</span>
        {activeCount > 0 && (
          <button onClick={() => onChange({})} className="text-xs font-medium text-accent hover:underline">
            Clear ({activeCount})
          </button>
        )}
      </div>
      {Array.from(options.entries()).map(([traitType, values]) => (
        <TraitGroup
          key={traitType}
          traitType={traitType}
          values={values}
          selected={selection[traitType] ?? new Set()}
          onToggle={(value) => toggle(traitType, value)}
        />
      ))}
    </div>
  );
}
