"use client";

import { useCallback, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { AppHeader } from "@/app/components/AppHeader";
import { TokenIcon } from "@/app/components/TokenIcon";
import { TokenSelectModal, type SelectedToken } from "@/app/components/TokenSelectModal";
import { executeSwapFlow, type SwapFlowPhase } from "@/lib/client/executeSwapFlow";
import { toAtomicAmount } from "@/lib/client/amount";
import { SOLANA_CHAIN_ID_CLIENT, WRAPPED_SOL_MINT, RELAY_NATIVE_SOL_SENTINEL, RELAY_NATIVE_EVM_SENTINEL, normalizeSolanaSourceMint } from "@/lib/client/constants";
import { SWAP_CHAINS } from "@/lib/chains/swapChains";
import { computeRebalanceDeltas, splitSellAcrossBuys } from "@/lib/rebalance/computeDeltas";

const EVM_CHAINS_FOR_SCAN = SWAP_CHAINS.filter((c) => c.chainId !== SOLANA_CHAIN_ID_CLIENT);

interface Holding {
  key: string;
  chainId: number;
  chainLabel: string;
  symbol: string;
  logoURI: string;
  address: string; // mint / contract address; WRAPPED_SOL_MINT for native SOL, RELAY_NATIVE_EVM_SENTINEL for native ETH etc.
  decimals: number;
  balance: string; // human units
  balanceUsd: number;
}

function holdingKey(chainId: number, address: string): string {
  return `${chainId}:${address}`;
}

interface LegResult {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  message?: string;
}

/**
 * Portfolio Rebalancer (2026-08-09, v1) — set target percentages across
 * currently-held (or newly added) assets, computes real USD-value deltas
 * against a live scan, and executes the sell→buy sequence as ordinary
 * guided swaps (same "one signature per leg, not one atomic transaction"
 * model as Evac Engine/Dust Sweeper — a true 1-signature relayer-batched
 * version is a real, scoped follow-up, see PLAN_ROUTE_QUALITY_FEATURES.md).
 * Solana + EVM only — no Sui execution path exists anywhere in this app yet.
 */
export function RebalanceClient() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const evmWallet = useEvmWallet();
  const connectWalletModal = useConnectWalletModal();

  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [targets, setTargets] = useState<Record<string, number>>({}); // key -> target pct
  const [extraTargets, setExtraTargets] = useState<Holding[]>([]); // targets picked via modal that aren't currently held
  const [pickerOpen, setPickerOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<LegResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const anyWalletConnected = Boolean(publicKey || evmWallet.address);

  const scan = useCallback(async () => {
    setScanning(true);
    setMessage(null);
    setResults([]);
    setScanned(false);
    try {
      const next: Holding[] = [];

      if (publicKey) {
        const lamports = await connection.getBalance(publicKey);
        let solUsd = 0;
        const resp = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
        const nonzero = resp.value
          .map((a) => ({
            mint: a.account.data.parsed.info.mint as string,
            amount: a.account.data.parsed.info.tokenAmount.amount as string,
            uiAmount: a.account.data.parsed.info.tokenAmount.uiAmount as number | null,
            decimals: a.account.data.parsed.info.tokenAmount.decimals as number,
          }))
          .filter((t) => t.uiAmount && t.uiAmount > 0);

        const mintsToPrice = Array.from(new Set([WRAPPED_SOL_MINT, ...nonzero.map((t) => t.mint)]));
        const priceRes = await fetch(`/api/tokens/mint-prices?mints=${mintsToPrice.join(",")}`).catch(() => null);
        const priceBody = priceRes && priceRes.ok ? await priceRes.json() : { prices: {} };
        const prices: Record<string, number> = priceBody.prices ?? {};
        solUsd = prices[WRAPPED_SOL_MINT] ?? 0;

        if (lamports > 0) {
          const uiSol = lamports / 1e9;
          next.push({
            key: holdingKey(SOLANA_CHAIN_ID_CLIENT, WRAPPED_SOL_MINT),
            chainId: SOLANA_CHAIN_ID_CLIENT,
            chainLabel: "Solana",
            symbol: "SOL",
            logoURI: "",
            address: WRAPPED_SOL_MINT,
            decimals: 9,
            balance: uiSol.toString(),
            balanceUsd: uiSol * solUsd,
          });
        }
        for (const t of nonzero) {
          const price = prices[t.mint];
          if (!price) continue; // no known price — never guessed, never included in delta math
          next.push({
            key: holdingKey(SOLANA_CHAIN_ID_CLIENT, t.mint),
            chainId: SOLANA_CHAIN_ID_CLIENT,
            chainLabel: "Solana",
            symbol: t.mint.slice(0, 4),
            logoURI: "",
            address: t.mint,
            decimals: t.decimals,
            balance: t.amount,
            balanceUsd: (t.uiAmount ?? 0) * price,
          });
        }
      }

      if (evmWallet.address) {
        const evmResults = await Promise.all(
          EVM_CHAINS_FOR_SCAN.map((chain) =>
            fetch(`/api/tokens/balances?chainId=${chain.chainId}&owner=${evmWallet.address}`)
              .then((r) => (r.ok ? r.json() : { balances: [] }))
              .then(
                (body: { balances?: Array<{ address: string; symbol: string; logoURI: string; decimals: number; balance: string; balanceUsd: string | null }> }) =>
                  (body.balances ?? []).map((b) => ({
                    key: holdingKey(chain.chainId, b.address),
                    chainId: chain.chainId,
                    chainLabel: chain.label,
                    symbol: b.symbol,
                    logoURI: b.logoURI,
                    address: b.address,
                    decimals: b.decimals,
                    balance: b.balance,
                    balanceUsd: b.balanceUsd ? Number(b.balanceUsd) : 0,
                  })),
              ),
          ),
        );
        next.push(...evmResults.flat().filter((h) => Number(h.balance) > 0 && h.balanceUsd > 0));
      }

      setHoldings(next);
      // Default target = current weight, so an untouched scan starts "already balanced"
      const total = next.reduce((s, h) => s + h.balanceUsd, 0);
      const nextTargets: Record<string, number> = {};
      for (const h of next) nextTargets[h.key] = total > 0 ? (h.balanceUsd / total) * 100 : 0;
      setTargets(nextTargets);
      setExtraTargets([]);
      setScanned(true);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, [publicKey, connection, evmWallet.address]);

  function setTargetPct(key: string, pct: number) {
    setTargets((prev) => ({ ...prev, [key]: Math.max(0, Math.min(100, pct)) }));
  }

  function addBuyTarget(token: SelectedToken) {
    const key = holdingKey(token.chainId, token.address);
    if (holdings.some((h) => h.key === key) || extraTargets.some((h) => h.key === key)) {
      setPickerOpen(false);
      return;
    }
    setExtraTargets((prev) => [...prev, { key, chainId: token.chainId, chainLabel: token.chainDisplayName, symbol: token.symbol, logoURI: token.logoURI, address: token.address, decimals: token.decimals, balance: "0", balanceUsd: 0 }]);
    setTargets((prev) => ({ ...prev, [key]: 0 }));
    setPickerOpen(false);
  }

  const allRows = useMemo(() => [...holdings, ...extraTargets], [holdings, extraTargets]);
  const targetSum = allRows.reduce((s, h) => s + (targets[h.key] ?? 0), 0);
  const targetSumValid = Math.abs(targetSum - 100) < 0.5;

  const plan = useMemo(() => {
    if (!targetSumValid || allRows.length === 0) return null;
    return computeRebalanceDeltas(
      allRows.map((h) => ({ key: h.key, usdValue: h.balanceUsd })),
      allRows.map((h) => ({ key: h.key, targetPct: targets[h.key] ?? 0 })),
    );
  }, [allRows, targets, targetSumValid]);

  function rowFor(key: string): Holding | undefined {
    return allRows.find((h) => h.key === key);
  }

  async function executePlan() {
    if (!plan || plan.sells.length === 0 || plan.buys.length === 0) return;
    setExecuting(true);
    setMessage(null);

    // For each sell, split its ATOMIC amount across buys (proportional to deficit share) and execute each split as its own swap.
    const items: LegResult[] = [];
    const execLegs: Array<{ sellHolding: Holding; buyHolding: Holding; atomicAmount: string }> = [];
    for (const sell of plan.sells) {
      const sellHolding = rowFor(sell.key);
      if (!sellHolding) continue;
      const isNativeSol = sellHolding.chainId === SOLANA_CHAIN_ID_CLIENT && sellHolding.address === WRAPPED_SOL_MINT;
      const totalAtomic = isNativeSol ? Math.floor(Number(sellHolding.balance) * 1e9).toString() : toAtomicAmount(sellHolding.balance, sellHolding.decimals);
      const sellFraction = sell.excessUsd / sellHolding.balanceUsd;
      const sellAtomicForThisLeg = (BigInt(Math.floor(Number(totalAtomic) * sellFraction))).toString();
      const splits = splitSellAcrossBuys(sellAtomicForThisLeg, plan.buys);
      for (const s of splits) {
        const buyHolding = rowFor(s.key);
        if (!buyHolding) continue;
        if (BigInt(s.atomicAmount) <= BigInt(0)) continue;
        execLegs.push({ sellHolding, buyHolding, atomicAmount: s.atomicAmount });
        items.push({ key: `${sellHolding.key}->${buyHolding.key}`, label: `${sellHolding.symbol} → ${buyHolding.symbol}`, status: "pending" });
      }
    }
    setResults(items);

    for (let i = 0; i < execLegs.length; i++) {
      const { sellHolding, buyHolding, atomicAmount } = execLegs[i];
      setResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "running" } : r)));
      try {
        const sellIsSolana = sellHolding.chainId === SOLANA_CHAIN_ID_CLIENT;
        const buyIsSolana = buyHolding.chainId === SOLANA_CHAIN_ID_CLIENT;
        const sourceMint = sellIsSolana ? (sellHolding.address === WRAPPED_SOL_MINT ? RELAY_NATIVE_SOL_SENTINEL : sellHolding.address) : sellHolding.address;
        const destToken = buyIsSolana ? (buyHolding.address === WRAPPED_SOL_MINT ? RELAY_NATIVE_SOL_SENTINEL : buyHolding.address) : buyHolding.address === RELAY_NATIVE_EVM_SENTINEL ? RELAY_NATIVE_EVM_SENTINEL : buyHolding.address;
        const destAddress = buyIsSolana ? publicKey?.toBase58() ?? "" : evmWallet.address ?? "";
        await executeSwapFlow(
          {
            sourceChainId: sellHolding.chainId,
            sourceMint: normalizeSolanaSourceMint(sourceMint),
            sourceAmount: atomicAmount,
            sourceAddress: sellIsSolana ? undefined : evmWallet.address!,
            destChainId: buyHolding.chainId,
            destToken,
            destAddress,
            slippageBps: 100,
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
          <h1 className="font-display text-2xl font-normal text-ink">⚖️ Portfolio Rebalancer</h1>
          <p className="text-sm text-ink-muted">
            Set target percentages across what you hold, and it computes the real USD deltas and swaps into place — as a
            guided sequence of ordinary swaps, not one atomic transaction.
          </p>
        </div>

        {!anyWalletConnected ? (
          <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
            <p className="text-sm text-ink-muted">Connect a wallet to scan.</p>
            <button
              onClick={() => connectWalletModal.setOpen(true)}
              className="self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Connect wallet
            </button>
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">1. Scan balances</span>
                <button
                  onClick={scan}
                  disabled={scanning}
                  className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {scanning ? "Scanning…" : scanned ? "Rescan" : "Scan wallet"}
                </button>
              </div>
              {scanned && holdings.length === 0 && <p className="text-sm text-ink-faint">No priceable holdings found across connected wallets.</p>}
            </section>

            {allRows.length > 0 && (
              <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">2. Set target allocations</span>
                  <button onClick={() => setPickerOpen(true)} className="text-xs font-semibold text-accent hover:underline">
                    + Add buy target
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  {allRows.map((h) => (
                    <div key={h.key} className="flex items-center gap-2 rounded-lg border border-hairline p-2 text-sm">
                      <TokenIcon logoURI={h.logoURI} symbol={h.symbol} size={20} />
                      <span className="text-ink">{h.symbol}</span>
                      <span className="text-ink-faint">({h.chainLabel})</span>
                      <span className="num ml-auto text-ink-faint">${h.balanceUsd.toFixed(2)}</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round((targets[h.key] ?? 0) * 10) / 10}
                        onChange={(e) => setTargetPct(h.key, Number(e.target.value))}
                        className="num w-16 rounded-lg border border-hairline bg-surface px-2 py-1 text-right text-sm text-ink outline-none focus:border-accent"
                      />
                      <span className="text-ink-faint">%</span>
                    </div>
                  ))}
                </div>
                <p className={`text-xs ${targetSumValid ? "text-ink-faint" : "text-danger"}`}>Targets sum to {targetSum.toFixed(1)}% — must total 100%.</p>
              </section>
            )}

            {plan && (plan.sells.length > 0 || plan.buys.length > 0) && (
              <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
                <span className="text-sm font-semibold text-ink">3. Rebalance plan</span>
                <div className="flex flex-col gap-1 text-sm">
                  {plan.sells.map((s) => (
                    <div key={s.key} className="flex justify-between text-danger">
                      <span>Sell {rowFor(s.key)?.symbol ?? s.key}</span>
                      <span className="num">-${s.excessUsd.toFixed(2)}</span>
                    </div>
                  ))}
                  {plan.buys.map((b) => (
                    <div key={b.key} className="flex justify-between text-accent">
                      <span>Buy {rowFor(b.key)?.symbol ?? b.key}</span>
                      <span className="num">+${b.deficitUsd.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={executePlan}
                  disabled={executing}
                  className="self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {executing ? "Rebalancing…" : "⚖️ Execute rebalance"}
                </button>
                <p className="text-[11px] text-ink-faint">Each leg below is its own signature — not a single atomic transaction.</p>
              </section>
            )}

            {results.length > 0 && (
              <section className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
                {results.map((r) => (
                  <div key={r.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink">{r.label}</span>
                    <span className={r.status === "done" ? "text-accent" : r.status === "failed" ? "text-danger" : "text-ink-faint"}>
                      {r.status === "running" ? (r.message ?? "working…") : r.status}
                    </span>
                  </div>
                ))}
              </section>
            )}
          </>
        )}

        {message && <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>}
      </div>

      <TokenSelectModal open={pickerOpen} onClose={() => setPickerOpen(false)} mode="multi-chain" onSelect={addBuyTarget} />
    </main>
  );
}
