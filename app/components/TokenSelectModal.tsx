"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TokenIcon } from "@/app/components/TokenIcon";
import { useStarredChains } from "@/lib/client/useStarredChains";
import type { ChainInfo, TokenListItem } from "@/lib/chains/types";

const SOLANA_CHAIN_ID = 792703809;

export interface SelectedToken {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  chainDisplayName: string;
  chainIconUrl: string | null;
  isNative: boolean;
}

export function TokenSelectModal({
  open,
  onClose,
  mode,
  onSelect,
  filterTokens,
}: {
  open: boolean;
  onClose: () => void;
  mode: "solana-only" | "multi-chain";
  onSelect: (token: SelectedToken) => void;
  /** Optional row-level filter, e.g. restricting which tokens are pickable for a given side. */
  filterTokens?: (token: TokenListItem) => boolean;
}) {
  const [chains, setChains] = useState<ChainInfo[]>([]);
  // "All Chains" doesn't aggregate a real cross-chain list yet (fast-follow —
  // Relay/trending sources are all chain-scoped); it currently falls back to
  // the Solana list, which keeps chainIdForFetch always defined and avoids a
  // conditional-empty-fetch effect branch.
  const [selectedChainId, setSelectedChainId] = useState<number>(SOLANA_CHAIN_ID);
  const [allChainsSelected, setAllChainsSelected] = useState(mode !== "solana-only");
  const [chainSearch, setChainSearch] = useState("");
  const [tokenSearch, setTokenSearch] = useState("");
  const [tokens, setTokens] = useState<TokenListItem[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const { starred, toggle } = useStarredChains();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || mode !== "multi-chain") return;
    fetch("/api/tokens/chains")
      .then((r) => r.json())
      .then((d) => setChains(d.chains ?? []))
      .catch(() => setChains([]));
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const handle = setTimeout(() => {
      setLoadingTokens(true);
      const params = new URLSearchParams({ chainId: String(selectedChainId) });
      if (tokenSearch.trim()) params.set("term", tokenSearch.trim());

      fetch(`/api/tokens/list?${params}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => setTokens(d.tokens ?? []))
        .catch((err) => {
          if (err.name !== "AbortError") setTokens([]);
        })
        .finally(() => setLoadingTokens(false));
    }, 250);

    return () => clearTimeout(handle);
  }, [open, mode, selectedChainId, tokenSearch]);

  const filteredChains = useMemo(() => {
    const term = chainSearch.trim().toLowerCase();
    if (!term) return chains;
    return chains.filter((c) => c.displayName.toLowerCase().includes(term));
  }, [chains, chainSearch]);

  const starredChains = useMemo(() => chains.filter((c) => starred.includes(c.id)), [chains, starred]);

  const selectedChain = allChainsSelected ? undefined : chains.find((c) => c.id === selectedChainId);

  const visibleTokens = useMemo(() => (filterTokens ? tokens.filter(filterTokens) : tokens), [tokens, filterTokens]);

  if (!open) return null;

  function pick(token: TokenListItem) {
    const chain = chains.find((c) => c.id === token.chainId);
    onSelect({
      chainId: token.chainId,
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      logoURI: token.logoURI,
      chainDisplayName: chain?.displayName ?? (token.chainId === SOLANA_CHAIN_ID ? "Solana" : String(token.chainId)),
      chainIconUrl: chain?.iconUrl ?? null,
      isNative: token.isNative,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-xl md:flex-row"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/*
          Real bug fixed 2026-08-03: this sidebar was a hardcoded `w-56`
          (224px) sitting *beside* the token list at every viewport width.
          On a ~360-390px phone, after the modal's own `p-4` outer padding,
          that left roughly 100px for the actual token list — unusable.
          Below `md` this now stacks ABOVE the token list instead of beside
          it, full width, with its own height capped (`max-h-40`, scrolls
          internally) so the token list — the part someone's actually
          trying to use — keeps most of the available height. `md:` and up
          is pixel-identical to the original side-by-side desktop layout.
        */}
        {mode === "multi-chain" && (
          <div className="flex max-h-40 shrink-0 flex-col border-b border-hairline p-3 md:max-h-none md:w-56 md:border-b-0 md:border-r">
            <input
              className="mb-2 rounded-lg border border-hairline bg-surface px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent"
              placeholder="Search chains"
              value={chainSearch}
              onChange={(e) => setChainSearch(e.target.value)}
            />
            <div className="flex-1 overflow-y-auto text-sm">
              <button
                onClick={() => {
                  setAllChainsSelected(true);
                  setSelectedChainId(SOLANA_CHAIN_ID);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left font-medium transition-colors hover:bg-surface-hover ${
                  allChainsSelected ? "bg-accent-soft text-accent" : "text-ink"
                }`}
              >
                All Chains
              </button>

              {starredChains.length > 0 && (
                <>
                  <p className="mt-2 px-2 text-xs font-medium uppercase tracking-wide text-ink-faint">Starred</p>
                  {starredChains.map((c) => (
                    <ChainRow
                      key={`starred-${c.id}`}
                      chain={c}
                      active={!allChainsSelected && selectedChainId === c.id}
                      starred
                      onSelect={() => {
                        setAllChainsSelected(false);
                        setSelectedChainId(c.id);
                      }}
                      onToggleStar={() => toggle(c.id)}
                    />
                  ))}
                </>
              )}

              <p className="mt-2 px-2 text-xs font-medium uppercase tracking-wide text-ink-faint">Chains A-Z</p>
              {filteredChains
                .slice()
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .map((c) => (
                  <ChainRow
                    key={c.id}
                    chain={c}
                    active={!allChainsSelected && selectedChainId === c.id}
                    starred={starred.includes(c.id)}
                    onSelect={() => {
                      setAllChainsSelected(false);
                      setSelectedChainId(c.id);
                    }}
                    onToggleStar={() => toggle(c.id)}
                  />
                ))}
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Select token</h2>
            <button onClick={onClose} className="text-ink-faint transition-colors hover:text-ink" aria-label="Close">
              ✕
            </button>
          </div>
          <input
            className="mb-3 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent"
            placeholder="Search for a token or paste address"
            value={tokenSearch}
            onChange={(e) => setTokenSearch(e.target.value)}
          />

          <p className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
            {selectedChain ? `${selectedChain.displayName} tokens` : tokenSearch ? "Search results" : "Popular tokens"}
          </p>

          <div className="flex-1 overflow-y-auto">
            {loadingTokens && <p className="px-1 py-4 text-sm text-ink-faint">Loading…</p>}
            {!loadingTokens && visibleTokens.length === 0 && (
              <p className="px-1 py-4 text-sm text-ink-faint">No tokens found.</p>
            )}
            {visibleTokens.map((t) => {
              const chain = chains.find((c) => c.id === t.chainId);
              return (
                <button
                  key={`${t.chainId}-${t.address}`}
                  onClick={() => pick(t)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-hover"
                >
                  <TokenIcon logoURI={t.logoURI} symbol={t.symbol} chainIconUrl={mode === "multi-chain" ? chain?.iconUrl : undefined} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{t.symbol}</p>
                    <p className="num truncate text-xs text-ink-faint">
                      {chain?.displayName ?? (t.chainId === SOLANA_CHAIN_ID ? "Solana" : t.chainId)}{" "}
                      {t.address.slice(0, 4)}…{t.address.slice(-4)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChainRow({
  chain,
  active,
  starred,
  onSelect,
  onToggleStar,
}: {
  chain: ChainInfo;
  active: boolean;
  starred: boolean;
  onSelect: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div className={`flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-hover ${active ? "bg-accent-soft" : ""}`}>
      <button onClick={onSelect} className="flex flex-1 items-center gap-2 text-left">
        <TokenIcon logoURI={chain.iconUrl ?? ""} symbol={chain.displayName} size={22} />
        <span className={active ? "font-medium text-accent" : "text-ink"}>{chain.displayName}</span>
      </button>
      <button
        onClick={onToggleStar}
        className={`px-1 text-sm transition-colors ${starred ? "text-amber-400" : "text-ink-faint hover:text-ink-muted"}`}
        aria-label={starred ? "Unstar chain" : "Star chain"}
      >
        ★
      </button>
    </div>
  );
}
