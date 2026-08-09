"use client";

import { useCallback, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { createCloseAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { AppHeader } from "@/app/components/AppHeader";
import { TokenIcon } from "@/app/components/TokenIcon";
import {
  filterZeroBalanceAccounts,
  sumReclaimableLamports,
  batchAccounts,
  type TokenAccountInfo,
} from "@/lib/client/dustAccounts";
import { filterDustHoldings, sumDustUsd, excludeTarget, DEFAULT_DUST_THRESHOLD, type DustHolding } from "@/lib/dust/detect";
import { executeSwapFlow, type SwapFlowPhase } from "@/lib/client/executeSwapFlow";
import { toAtomicAmount } from "@/lib/client/amount";
import { SOLANA_CHAIN_ID_CLIENT, WRAPPED_SOL_MINT, RELAY_NATIVE_EVM_SENTINEL } from "@/lib/client/constants";
import { SWAP_CHAINS } from "@/lib/chains/swapChains";
import { SUI_ICON_URL } from "@/lib/nft/labels";

const BASE_CHAIN_ID = 8453;

type TargetKind = "sol" | "eth-base" | "usdc-base";

const TARGET_OPTIONS: Array<{ key: TargetKind; label: string; chainId: number }> = [
  { key: "sol", label: "SOL on Solana", chainId: SOLANA_CHAIN_ID_CLIENT },
  { key: "eth-base", label: "ETH on Base", chainId: BASE_CHAIN_ID },
  { key: "usdc-base", label: "USDC on Base", chainId: BASE_CHAIN_ID },
];

const EVM_CHAINS_FOR_SCAN = SWAP_CHAINS.filter((c) => c.slug !== "solana");

function holdingKey(h: DustHolding): string {
  return `${h.chainId}:${h.address}`;
}

function lamportsToSol(lamports: number): string {
  return (lamports / 1e9).toFixed(5);
}

interface ItemResult {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  message?: string;
}

export function DustSweeperClient() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const evmWallet = useEvmWallet();
  const suiAccount = useCurrentAccount();
  const connectWalletModal = useConnectWalletModal();

  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [zeroAccounts, setZeroAccounts] = useState<TokenAccountInfo[]>([]);
  const [dustHoldings, setDustHoldings] = useState<DustHolding[]>([]);
  const [suiNative, setSuiNative] = useState<{ balance: string; balanceUsd: string | null } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<TargetKind>("sol");
  const [usdcOnBaseAddress, setUsdcOnBaseAddress] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [vacuuming, setVacuuming] = useState(false);
  const [vacuumMessage, setVacuumMessage] = useState<string | null>(null);
  const [results, setResults] = useState<ItemResult[]>([]);
  const [rentReclaimed, setRentReclaimed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const anyWalletConnected = Boolean(publicKey || evmWallet.address || suiAccount);

  const scan = useCallback(async () => {
    setScanning(true);
    setMessage(null);
    setResults([]);
    setScanned(false);
    try {
      const nextDust: DustHolding[] = [];
      let nextZero: TokenAccountInfo[] = [];

      if (publicKey) {
        const resp = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
        const accounts: TokenAccountInfo[] = resp.value.map((a) => ({
          pubkey: a.pubkey.toBase58(),
          mint: a.account.data.parsed.info.mint,
          amount: a.account.data.parsed.info.tokenAmount.amount,
          lamports: a.account.lamports,
        }));
        nextZero = filterZeroBalanceAccounts(accounts);

        // Nonzero SPL accounts — priced via Jupiter (arbitrary mints, not
        // this app's own curated list — see lib/pricing.ts's
        // getJupiterMintUsdPrices doc) since real dust is disproportionately
        // unlisted/rug tokens.
        const nonzero = resp.value
          .map((a) => ({
            mint: a.account.data.parsed.info.mint as string,
            amount: a.account.data.parsed.info.tokenAmount.amount as string,
            uiAmount: a.account.data.parsed.info.tokenAmount.uiAmount as number | null,
            decimals: a.account.data.parsed.info.tokenAmount.decimals as number,
          }))
          .filter((t) => t.uiAmount && t.uiAmount > 0 && t.mint !== WRAPPED_SOL_MINT);

        if (nonzero.length > 0) {
          const mints = nonzero.map((t) => t.mint);
          const priceRes = await fetch(`/api/tokens/mint-prices?mints=${mints.join(",")}`).catch(() => null);
          const priceBody = priceRes && priceRes.ok ? await priceRes.json() : { prices: {} };
          const prices: Record<string, number> = priceBody.prices ?? {};
          for (const t of nonzero) {
            const price = prices[t.mint];
            if (!price) continue; // no known price — never guessed, never swept
            nextDust.push({
              chainLabel: "Solana",
              chainSlug: "solana",
              chainId: SOLANA_CHAIN_ID_CLIENT,
              symbol: t.mint.slice(0, 4),
              logoURI: "",
              address: t.mint,
              decimals: t.decimals,
              balance: t.amount,
              balanceUsd: (t.uiAmount ?? 0) * price,
              isNative: false,
            });
          }
        }
      }

      if (evmWallet.address) {
        const evmResults = await Promise.all(
          EVM_CHAINS_FOR_SCAN.map((chain) =>
            fetch(`/api/tokens/balances?chainId=${chain.chainId}&owner=${evmWallet.address}`)
              .then((r) => (r.ok ? r.json() : { balances: [] }))
              .then((body: { balances?: Array<{ address: string; symbol: string; logoURI: string; decimals: number; balance: string; balanceUsd: string | null; isNative: boolean }> }) =>
                (body.balances ?? []).map((b) => ({
                  chainLabel: chain.label,
                  chainSlug: chain.slug,
                  chainId: chain.chainId,
                  symbol: b.symbol,
                  logoURI: b.logoURI,
                  address: b.address,
                  decimals: b.decimals,
                  balance: b.balance,
                  balanceUsd: b.balanceUsd ? Number(b.balanceUsd) : 0,
                  isNative: b.isNative,
                })),
              )
              .catch(() => [] as DustHolding[]),
          ),
        );
        nextDust.push(...evmResults.flat());
      }

      if (suiAccount) {
        const res = await fetch(`/api/tokens/sui-balance?owner=${suiAccount.address}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (res && Number(res.balance) > 0) setSuiNative(res);
      }

      setZeroAccounts(nextZero);
      const dust = filterDustHoldings(nextDust, DEFAULT_DUST_THRESHOLD);
      setDustHoldings(dust);
      setSelected(new Set(dust.map(holdingKey)));
      setScanned(true);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, [publicKey, connection, evmWallet.address, suiAccount]);

  const sweepableDust = useMemo(() => {
    const targetOpt = TARGET_OPTIONS.find((t) => t.key === target)!;
    const targetAddress =
      target === "sol" ? WRAPPED_SOL_MINT : target === "eth-base" ? RELAY_NATIVE_EVM_SENTINEL : (usdcOnBaseAddress ?? "");
    return excludeTarget(dustHoldings, { chainId: targetOpt.chainId, address: targetAddress });
  }, [dustHoldings, target, usdcOnBaseAddress]);

  const selectedHoldings = sweepableDust.filter((h) => selected.has(holdingKey(h)));
  const totalDustUsd = sumDustUsd(sweepableDust);
  const selectedUsd = sumDustUsd(selectedHoldings);
  const rentReclaimableSol = zeroAccounts.length > 0 ? lamportsToSol(sumReclaimableLamports(zeroAccounts)) : null;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function ensureUsdcOnBase(): Promise<string | null> {
    if (usdcOnBaseAddress) return usdcOnBaseAddress;
    const res = await fetch(`/api/tokens/list?chainId=${BASE_CHAIN_ID}`).catch(() => null);
    if (!res || !res.ok) return null;
    const body: { tokens?: Array<{ symbol: string; address: string }> } = await res.json();
    const usdc = body.tokens?.find((t) => t.symbol === "USDC");
    if (usdc) setUsdcOnBaseAddress(usdc.address);
    return usdc?.address ?? null;
  }

  async function reclaimRent() {
    if (!publicKey || !signTransaction || zeroAccounts.length === 0) return;
    const batches = batchAccounts(zeroAccounts);
    for (const batch of batches) {
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash });
      for (const account of batch) {
        tx.add(createCloseAccountInstruction(new PublicKey(account.pubkey), publicKey, publicKey, [], TOKEN_PROGRAM_ID));
      }
      const signed = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(signature, "confirmed");
    }
    setRentReclaimed(lamportsToSol(sumReclaimableLamports(zeroAccounts)));
    setZeroAccounts([]);
  }

  async function sweepAll() {
    if (selectedHoldings.length === 0 && zeroAccounts.length === 0) return;
    setSweeping(true);
    setMessage(null);

    let destToken = target === "sol" ? "SOL" : target === "eth-base" ? RELAY_NATIVE_EVM_SENTINEL : usdcOnBaseAddress;
    if (target === "usdc-base" && !destToken) destToken = await ensureUsdcOnBase();
    const targetOpt = TARGET_OPTIONS.find((t) => t.key === target)!;

    const destAddress = target === "sol" ? publicKey?.toBase58() : evmWallet.address;
    if (!destToken || !destAddress) {
      setMessage(
        target === "sol"
          ? "Connect a Solana wallet to sweep into SOL."
          : "Connect an EVM wallet to sweep into a Base token.",
      );
      setSweeping(false);
      return;
    }

    if (zeroAccounts.length > 0) {
      try {
        await reclaimRent();
      } catch (err) {
        setMessage(`Rent reclaim failed: ${(err as Error).message}`);
      }
    }

    const items: ItemResult[] = selectedHoldings.map((h) => ({ key: holdingKey(h), label: `${h.symbol} (${h.chainLabel})`, status: "pending" }));
    setResults(items);

    for (let i = 0; i < selectedHoldings.length; i++) {
      const h = selectedHoldings[i];
      setResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "running" } : r)));
      try {
        const sourceAmount = h.chainId === SOLANA_CHAIN_ID_CLIENT ? h.balance : toAtomicAmount(h.balance, h.decimals);
        await executeSwapFlow(
          {
            sourceChainId: h.chainId!,
            sourceMint: h.address,
            sourceAmount,
            sourceAddress: h.chainId === SOLANA_CHAIN_ID_CLIENT ? undefined : evmWallet.address!,
            destChainId: targetOpt.chainId,
            destToken,
            destAddress,
            slippageBps: 150, // dust sweeps use a wider default tolerance — low-value, illiquid tokens often need more slippage room than a normal swap
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

    setSweeping(false);
    setDustHoldings((prev) => prev.filter((h) => !selectedHoldings.some((s) => holdingKey(s) === holdingKey(h))));
  }

  const selectedSolanaDust = selectedHoldings.filter((h) => h.chainId === SOLANA_CHAIN_ID_CLIENT);

  // OmniDust Vacuum (2026-08-09, v1 Solana-only) — one signature covering
  // every selected Solana dust token, delegating a bounded relayer
  // (lib/relayer/*.ts) to sweep + convert to native SOL, delivered back to
  // this SAME wallet on the next daily cron run (Vercel Hobby plan only
  // allows a daily schedule — see STATE.md). Falls back cleanly if the
  // relayer isn't configured: /api/dust-sweeper/authorize returns
  // transaction:null and this just tells the user to use the manual sweep
  // above instead.
  async function vacuumSolanaDust() {
    if (!publicKey || !signTransaction || selectedSolanaDust.length === 0) return;
    setVacuuming(true);
    setVacuumMessage(null);
    try {
      const res = await fetch("/api/dust-sweeper/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokens: selectedSolanaDust.map((h) => ({ mint: h.address, symbol: h.symbol, decimals: h.decimals, amountAtomic: h.balance })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Authorization failed");
      if (!body.transaction) {
        setVacuumMessage("Automatic vacuum isn't available right now — use the manual sweep above instead.");
        return;
      }
      const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
      const signed = await signTransaction(tx);
      await connection.sendRawTransaction(signed.serialize());
      setVacuumMessage(`Authorized — ${selectedSolanaDust.length} token(s) will be swept to SOL and sent back to your wallet on the next daily run.`);
      setDustHoldings((prev) => prev.filter((h) => !selectedSolanaDust.some((s) => holdingKey(s) === holdingKey(h))));
    } catch (err) {
      setVacuumMessage((err as Error).message);
    } finally {
      setVacuuming(false);
    }
  }

  const swept = results.filter((r) => r.status === "done");
  const sweptUsd = selectedHoldings
    .filter((h) => swept.some((r) => r.key === holdingKey(h)))
    .reduce((sum, h) => sum + h.balanceUsd, 0);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-1 px-1">
          <h1 className="font-display text-2xl font-normal text-ink">🧹 Dust Sweeper</h1>
          <p className="text-sm text-ink-muted">
            Find small stranded token balances on Solana and EVM chains, and consolidate them into one token in a
            guided flow. Also reclaims real rent SOL from empty Solana token accounts.
          </p>
        </div>

        {!anyWalletConnected ? (
          <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
            <p className="text-sm text-ink-muted">Connect a wallet to scan for dust.</p>
            <button
              onClick={() => connectWalletModal.setOpen(true)}
              className="self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Connect wallet
            </button>
          </section>
        ) : !scanned ? (
          <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
            <button
              onClick={scan}
              disabled={scanning}
              className="self-start rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-semibold text-accent transition-all hover:border-accent/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {scanning ? "Scanning your connected wallets…" : "Scan for dust"}
            </button>
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Detected dust</p>
                <p className="num text-sm text-ink">${totalDustUsd.toFixed(2)}</p>
              </div>

              {sweepableDust.length === 0 ? (
                <p className="text-sm text-ink-faint">No dust under $50 found in the chains this app tracks.</p>
              ) : (
                <div className="flex flex-col gap-1.5 rounded-2xl border border-hairline bg-surface p-1.5">
                  {sweepableDust.map((h) => {
                    const key = holdingKey(h);
                    return (
                      <label key={key} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-hover">
                        <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} className="h-4 w-4 accent-accent" />
                        <TokenIcon logoURI={h.logoURI} symbol={h.symbol} size={28} />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium text-ink">{h.symbol}</span>
                          <span className="text-xs text-ink-faint">{h.chainLabel}</span>
                        </div>
                        <span className="num shrink-0 text-sm text-ink-muted">${h.balanceUsd.toFixed(2)}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {rentReclaimableSol && (
                <p className="text-xs text-ink-faint">
                  + {zeroAccounts.length} empty Solana account{zeroAccounts.length === 1 ? "" : "s"} (~{rentReclaimableSol} SOL rent)
                </p>
              )}

              {suiNative && (
                <div className="flex items-center gap-3 rounded-xl border border-hairline px-3 py-2">
                  <TokenIcon logoURI={SUI_ICON_URL} symbol="SUI" size={24} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm text-ink">{suiNative.balance} SUI</span>
                    <span className="text-xs text-ink-faint">Sui — sweep coming soon, no swap route yet</span>
                  </div>
                  <span className="num text-sm text-ink-muted">{suiNative.balanceUsd ? `$${suiNative.balanceUsd}` : "—"}</span>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Consolidate all into</p>
              <div className="flex flex-col gap-2">
                {TARGET_OPTIONS.map((opt) => (
                  <label key={opt.key} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                    <input type="radio" name="target" checked={target === opt.key} onChange={() => setTarget(opt.key)} className="h-4 w-4 accent-accent" />
                    {opt.label}
                  </label>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-muted">Selected to sweep</span>
                <span className="num text-ink">${selectedUsd.toFixed(2)}</span>
              </div>
              <p className="text-xs text-ink-faint">
                Each token is swept in its own guided step — you approve one signature per token, same as a normal
                swap. Sweeps are not a single atomic transaction.
              </p>
              <button
                onClick={sweepAll}
                disabled={sweeping || (selectedHoldings.length === 0 && zeroAccounts.length === 0)}
                className="self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sweeping ? "Sweeping…" : "⚡ Sweep all dust"}
              </button>

              {selectedSolanaDust.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5 border-t border-hairline pt-3">
                  <p className="text-xs text-ink-faint">
                    🌀 Or vacuum {selectedSolanaDust.length} Solana token{selectedSolanaDust.length === 1 ? "" : "s"} with ONE
                    signature — a relayer sweeps + converts to SOL and sends it back to this wallet automatically (up to once
                    daily).
                  </p>
                  <button
                    onClick={vacuumSolanaDust}
                    disabled={vacuuming}
                    className="self-start rounded-full border border-accent px-4 py-1.5 text-xs font-semibold text-accent transition-all hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {vacuuming ? "Authorizing…" : "🌀 Vacuum with 1 signature"}
                  </button>
                  {vacuumMessage && <p className="text-xs text-ink-muted">{vacuumMessage}</p>}
                </div>
              )}
            </section>

            {results.length > 0 && (
              <section className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
                {results.map((r) => (
                  <div key={r.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink">{r.label}</span>
                    <span
                      className={
                        r.status === "done" ? "text-emerald-500" : r.status === "failed" ? "text-red-500" : "text-ink-faint"
                      }
                    >
                      {r.status === "pending" ? "Waiting…" : r.status === "running" ? r.message ?? "Working…" : r.status === "done" ? "Swept ✓" : r.message ?? "Failed"}
                    </span>
                  </div>
                ))}
                {!sweeping && swept.length > 0 && (
                  <a
                    href={`/dust-sweeper/share?amount=${sweptUsd.toFixed(2)}&count=${swept.length}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 self-start rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-semibold text-accent transition-all hover:border-accent/40"
                  >
                    Share your dust recovered →
                  </a>
                )}
              </section>
            )}
          </>
        )}

        {rentReclaimed && !scanned && (
          <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">
            Reclaimed ~{rentReclaimed} SOL in rent.
          </p>
        )}

        {message && <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>}
      </div>
    </main>
  );
}
