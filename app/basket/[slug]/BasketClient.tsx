"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { AppHeader } from "@/app/components/AppHeader";
import { TokenIcon } from "@/app/components/TokenIcon";
import { TokenSelectModal, type SelectedToken } from "@/app/components/TokenSelectModal";
import { executeSwapFlow, type SwapFlowPhase } from "@/lib/client/executeSwapFlow";
import { splitAmount, normalizePercentages } from "@/lib/baskets/split";
import { toAtomicAmount } from "@/lib/client/amount";
import { normalizeSolanaSourceMint, SOLANA_CHAIN_ID_CLIENT } from "@/lib/client/constants";
import type { BasketMeta } from "@/lib/content/baskets";

interface ItemResult {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  message?: string;
}

function isSolana(chainId: number): boolean {
  return chainId === SOLANA_CHAIN_ID_CLIENT;
}

export function BasketClient({ basket }: { basket: BasketMeta }) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const evmWallet = useEvmWallet();
  const connectWalletModal = useConnectWalletModal();

  const [sourceToken, setSourceToken] = useState<SelectedToken | null>(null);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [sourceAmount, setSourceAmount] = useState("");
  const [percentages, setPercentages] = useState<number[]>(basket.allocations.map((a) => a.percentage));
  const [previews, setPreviews] = useState<Array<string | null>>(basket.allocations.map(() => null));
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<ItemResult[]>([]);

  const needsEvmWallet = basket.allocations.some((a) => !isSolana(a.chainId)) || (sourceToken && !isSolana(sourceToken.chainId));
  const needsSolanaWallet = basket.allocations.some((a) => isSolana(a.chainId)) || (sourceToken && isSolana(sourceToken.chainId));
  const walletsReady = Boolean((!needsSolanaWallet || publicKey) && (!needsEvmWallet || evmWallet.address));

  const amount = Number(sourceAmount);
  const hasValidInput = Boolean(sourceToken && sourceAmount && Number.isFinite(amount) && amount > 0);

  function setPercentage(index: number, value: number) {
    setPercentages((prev) => {
      const next = [...prev];
      next[index] = value;
      return normalizePercentages(next);
    });
  }

  // Live per-leg preview — reuses the same public /api/quote/preview
  // SwapPanel.tsx already calls, one request per allocation (small N, no
  // batching endpoint needed for 2-3 legs).
  useEffect(() => {
    if (!hasValidInput || !sourceToken) {
      setPreviews(basket.allocations.map(() => null));
      return;
    }
    let ignore = false;
    const handle = setTimeout(() => {
      const atomicAmounts = splitAmount(toAtomicAmount(sourceAmount, sourceToken.decimals), percentages.map((p) => ({ percentage: p })));
      Promise.all(
        basket.allocations.map((alloc, i) => {
          const params = new URLSearchParams({
            sourceChainId: String(sourceToken.chainId),
            sourceMint: normalizeSolanaSourceMint(sourceToken.address),
            sourceAmount: atomicAmounts[i],
            destChainId: String(alloc.chainId),
            destToken: alloc.address,
            destDecimals: String(alloc.decimals),
          });
          return fetch(`/api/quote/preview?${params}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d?.destAmountFormatted ?? null)
            .catch(() => null);
        }),
      ).then((next) => {
        if (!ignore) setPreviews(next);
      });
    }, 400);
    return () => {
      ignore = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasValidInput, sourceToken, sourceAmount, percentages]);

  async function executeBasket() {
    if (!sourceToken || !hasValidInput) return;
    if (!walletsReady) {
      connectWalletModal.setOpen(true);
      return;
    }

    setExecuting(true);
    const atomicAmounts = splitAmount(toAtomicAmount(sourceAmount, sourceToken.decimals), percentages.map((p) => ({ percentage: p })));
    const items: ItemResult[] = basket.allocations.map((a) => ({ key: `${a.chainId}:${a.address}`, label: `${a.symbol} (${a.percentage.toFixed(0)}%)`, status: "pending" }));
    setResults(items);

    for (let i = 0; i < basket.allocations.length; i++) {
      const alloc = basket.allocations[i];
      const destAddress = isSolana(alloc.chainId) ? publicKey?.toBase58() : evmWallet.address;
      setResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "running" } : r)));
      if (!destAddress) {
        setResults((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: "failed", message: "No wallet connected for this chain" } : r)),
        );
        continue;
      }
      try {
        await executeSwapFlow(
          {
            sourceChainId: sourceToken.chainId,
            sourceMint: normalizeSolanaSourceMint(sourceToken.address),
            sourceAmount: atomicAmounts[i],
            sourceAddress: isSolana(sourceToken.chainId) ? undefined : evmWallet.address!,
            destChainId: alloc.chainId,
            destToken: alloc.isNative && isSolana(alloc.chainId) ? "SOL" : alloc.address,
            destAddress,
            slippageBps: 150, // baskets skew toward lower-liquidity meme/community tokens — a wider default than a plain blue-chip swap
          },
          { solanaPublicKey: publicKey, signSolanaTransaction: signTransaction, connection, evmWallet },
          (_phase: SwapFlowPhase, msg?: string) => {
            if (msg) setResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, message: msg } : r)));
          },
        );
        setResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "done" } : r)));
      } catch (err) {
        setResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "failed", message: (err as Error).message } : r)));
      }
    }
    setExecuting(false);
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-1 px-1">
          <h1 className="font-display text-2xl font-normal text-ink">
            {basket.icon} {basket.name}
          </h1>
          <p className="text-sm text-ink-muted">{basket.description}</p>
        </div>

        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-sm">
          <p className="mb-1 text-sm text-ink-faint">Split from</p>
          <button
            onClick={() => setSourceModalOpen(true)}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-hairline bg-surface-hover px-3 py-2 transition-all hover:border-accent/40"
          >
            {sourceToken ? (
              <span className="flex items-center gap-2">
                <TokenIcon logoURI={sourceToken.logoURI} symbol={sourceToken.symbol} chainIconUrl={sourceToken.chainIconUrl} size={28} />
                <span className="text-sm font-semibold text-ink">
                  {sourceToken.symbol} <span className="text-ink-faint">on {sourceToken.chainDisplayName}</span>
                </span>
              </span>
            ) : (
              <span className="text-sm text-ink-faint">Select source token</span>
            )}
            <span className="text-ink-faint">›</span>
          </button>
          <input
            className="num rounded-lg border border-hairline bg-surface px-3 py-2 text-lg font-semibold text-ink outline-none focus:border-accent"
            placeholder="0.00"
            inputMode="decimal"
            value={sourceAmount}
            onChange={(e) => setSourceAmount(e.target.value)}
          />
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Allocation</p>
          {basket.allocations.map((alloc, i) => (
            <div key={`${alloc.chainId}:${alloc.address}`} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm text-ink">
                  <TokenIcon logoURI={alloc.logoURI} symbol={alloc.symbol} size={22} />
                  {alloc.symbol} <span className="text-xs text-ink-faint">({alloc.name})</span>
                </span>
                <span className="num text-sm font-semibold text-ink">{percentages[i].toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={percentages[i]}
                onChange={(e) => setPercentage(i, Number(e.target.value))}
                className="h-1.5 w-full accent-accent"
              />
              {previews[i] && (
                <p className="num text-right text-xs text-ink-faint">≈ {previews[i]} {alloc.symbol}</p>
              )}
            </div>
          ))}
        </section>

        <button
          onClick={executeBasket}
          disabled={executing || !hasValidInput}
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {!walletsReady && hasValidInput ? "Connect wallets" : executing ? "Executing…" : "⚡ Execute basket"}
        </button>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Each token in the basket is its own swap, signed one at a time — this isn&apos;t a single atomic
          transaction. If one leg fails, the others still complete; failed legs are shown below and can be retried
          individually by adjusting the allocation and running again.
        </p>

        {results.length > 0 && (
          <section className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-4 shadow-sm">
            {results.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-ink">{r.label}</span>
                <span className={r.status === "done" ? "text-emerald-500" : r.status === "failed" ? "text-red-500" : "text-ink-faint"}>
                  {r.status === "pending" ? "Waiting…" : r.status === "running" ? r.message ?? "Working…" : r.status === "done" ? "Done ✓" : r.message ?? "Failed"}
                </span>
              </div>
            ))}
          </section>
        )}
      </div>

      <TokenSelectModal open={sourceModalOpen} onClose={() => setSourceModalOpen(false)} mode="multi-chain" onSelect={setSourceToken} />
    </main>
  );
}
