"use client";

import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { encodeFunctionData, isAddress } from "viem";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { AppHeader } from "@/app/components/AppHeader";
import { TokenIcon } from "@/app/components/TokenIcon";
import { executeSwapFlow, type SwapFlowPhase } from "@/lib/client/executeSwapFlow";
import { toAtomicAmount } from "@/lib/client/amount";
import { SOLANA_CHAIN_ID_CLIENT, RELAY_NATIVE_SOL_SENTINEL, RELAY_NATIVE_EVM_SENTINEL, normalizeSolanaSourceMint } from "@/lib/client/constants";
import { SWAP_CHAINS } from "@/lib/chains/swapChains";

const EVM_CHAINS_FOR_SCAN = SWAP_CHAINS.filter((c) => c.chainId !== SOLANA_CHAIN_ID_CLIENT);

function isValidDestAddress(address: string, chainId: number): boolean {
  if (!address) return false;
  if (chainId === SOLANA_CHAIN_ID_CLIENT) {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }
  return isAddress(address);
}

interface Holding {
  chainLabel: string;
  chainId: number;
  symbol: string;
  logoURI: string;
  address: string;
  decimals: number;
  balance: string; // human units
  balanceUsd: number;
}

function holdingKey(h: Holding) {
  return `${h.chainId}:${h.address}`;
}

interface ItemResult {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  message?: string;
}

const ERC20_APPROVE_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/**
 * Evac Engine (2026-08-09, v1) — "Evacuate everything" sweeps every
 * detected balance (no dust cap — every real holding this app can price,
 * unlike Dust Sweeper's threshold-bounded scan) to a single safe-haven
 * address in one guided flow. "Revoke an approval" builds a real
 * `approve(spender, 0)` transaction for a token/spender the user already
 * knows about.
 *
 * Deliberately does NOT auto-discover approvals or unwind LP/lending
 * positions — real automatic approval discovery needs a paid indexer
 * (Alchemy/Covalent/Etherscan) this session has no credentials for, and
 * per-protocol LP/lending withdrawal is its own separate integration per
 * protocol. See PLAN_SAFETY_DISCOVERY_FEATURES.md's Evac Engine section.
 */
export function EvacClient() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const evmWallet = useEvmWallet();
  const connectWalletModal = useConnectWalletModal();

  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [safeAddress, setSafeAddress] = useState("");
  const [safeChainId, setSafeChainId] = useState<number>(SOLANA_CHAIN_ID_CLIENT);
  const [evacuating, setEvacuating] = useState(false);
  const [results, setResults] = useState<ItemResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [revokeChainId, setRevokeChainId] = useState<number>(EVM_CHAINS_FOR_SCAN[0]?.chainId ?? 1);
  const [revokeToken, setRevokeToken] = useState("");
  const [revokeSpender, setRevokeSpender] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [revokeMessage, setRevokeMessage] = useState<string | null>(null);

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
        if (lamports > 0) {
          next.push({
            chainLabel: "Solana",
            chainId: SOLANA_CHAIN_ID_CLIENT,
            symbol: "SOL",
            logoURI: "",
            address: RELAY_NATIVE_SOL_SENTINEL,
            decimals: 9,
            balance: (lamports / 1e9).toString(),
            balanceUsd: 0, // display-only estimate omitted here — not needed to select/sweep everything
          });
        }
        const resp = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
        const nonzero = resp.value
          .map((a) => ({
            mint: a.account.data.parsed.info.mint as string,
            amount: a.account.data.parsed.info.tokenAmount.amount as string,
            uiAmount: a.account.data.parsed.info.tokenAmount.uiAmount as number | null,
            decimals: a.account.data.parsed.info.tokenAmount.decimals as number,
          }))
          .filter((t) => t.uiAmount && t.uiAmount > 0);
        for (const t of nonzero) {
          next.push({
            chainLabel: "Solana",
            chainId: SOLANA_CHAIN_ID_CLIENT,
            symbol: t.mint.slice(0, 4),
            logoURI: "",
            address: t.mint,
            decimals: t.decimals,
            balance: t.amount,
            balanceUsd: 0,
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
                    chainLabel: chain.label,
                    chainId: chain.chainId,
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
        next.push(...evmResults.flat().filter((h) => Number(h.balance) > 0));
      }

      setHoldings(next);
      setSelected(new Set(next.map(holdingKey)));
      setScanned(true);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, [publicKey, connection, evmWallet.address]);

  function toggle(h: Holding) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = holdingKey(h);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const selectedHoldings = holdings.filter((h) => selected.has(holdingKey(h)));
  const addressValid = safeAddress ? isValidDestAddress(safeAddress, safeChainId) : false;

  async function evacuateAll() {
    if (selectedHoldings.length === 0 || !addressValid) return;
    setEvacuating(true);
    setMessage(null);
    const destToken = safeChainId === SOLANA_CHAIN_ID_CLIENT ? RELAY_NATIVE_SOL_SENTINEL : RELAY_NATIVE_EVM_SENTINEL;

    const items: ItemResult[] = selectedHoldings.map((h) => ({ key: holdingKey(h), label: `${h.symbol} (${h.chainLabel})`, status: "pending" }));
    setResults(items);

    for (let i = 0; i < selectedHoldings.length; i++) {
      const h = selectedHoldings[i];
      setResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "running" } : r)));
      try {
        const sourceMint = h.chainId === SOLANA_CHAIN_ID_CLIENT ? normalizeSolanaSourceMint(h.address) : h.address;
        const sourceAmount = h.chainId === SOLANA_CHAIN_ID_CLIENT ? h.balance : toAtomicAmount(h.balance, h.decimals);
        await executeSwapFlow(
          {
            sourceChainId: h.chainId,
            sourceMint,
            sourceAmount,
            sourceAddress: h.chainId === SOLANA_CHAIN_ID_CLIENT ? undefined : evmWallet.address!,
            destChainId: safeChainId,
            destToken,
            destAddress: safeAddress,
            slippageBps: 200,
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
    setEvacuating(false);
  }

  async function revokeApproval() {
    if (!evmWallet.address || !isAddress(revokeToken) || !isAddress(revokeSpender)) {
      setRevokeMessage("Enter a valid token and spender address.");
      return;
    }
    setRevoking(true);
    setRevokeMessage(null);
    try {
      await evmWallet.ensureChain(revokeChainId);
      const data = encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [revokeSpender as `0x${string}`, BigInt(0)] });
      await evmWallet.sendStepAndWait({ from: evmWallet.address, to: revokeToken, data, chainId: revokeChainId });
      setRevokeMessage("Revoked — allowance set to 0.");
    } catch (err) {
      setRevokeMessage((err as Error).message);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-1 px-1">
          <h1 className="font-display text-2xl font-normal text-ink">🚨 Evac Engine</h1>
          <p className="text-sm text-ink-muted">
            Move everything in a connected wallet to a safe-haven address in one guided flow, and revoke a token approval you
            no longer trust.
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
              {scanned && holdings.length === 0 && <p className="text-sm text-ink-faint">Nothing found across connected wallets.</p>}
              {holdings.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {holdings.map((h) => (
                    <label key={holdingKey(h)} className="flex cursor-pointer items-center gap-2 rounded-lg border border-hairline p-2 text-sm">
                      <input type="checkbox" checked={selected.has(holdingKey(h))} onChange={() => toggle(h)} className="h-4 w-4 accent-accent" />
                      <TokenIcon logoURI={h.logoURI} symbol={h.symbol} size={20} />
                      <span className="text-ink">{h.symbol}</span>
                      <span className="text-ink-faint">({h.chainLabel})</span>
                      <span className="num ml-auto text-ink-muted">{Number(h.balance).toFixed(4)}</span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            {holdings.length > 0 && (
              <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
                <span className="text-sm font-semibold text-ink">2. Safe-haven destination</span>
                <div className="flex flex-wrap gap-2">
                  {SWAP_CHAINS.map((c) => (
                    <button
                      key={c.chainId}
                      onClick={() => setSafeChainId(c.chainId)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        safeChainId === c.chainId ? "border-accent bg-accent-soft text-accent" : "border-hairline text-ink-muted"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <input
                  className="num rounded-lg border border-hairline bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                  placeholder="Hardware wallet address"
                  value={safeAddress}
                  onChange={(e) => setSafeAddress(e.target.value)}
                />
                {safeAddress && !addressValid && <span className="text-[11px] text-danger">Not a valid address for this chain.</span>}

                <button
                  onClick={evacuateAll}
                  disabled={evacuating || selectedHoldings.length === 0 || !addressValid}
                  className="self-start rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {evacuating ? "Evacuating…" : "⚡ Evacuate everything selected"}
                </button>
                <p className="text-[11px] text-ink-faint">Each token moves in its own signature — not a single atomic transaction.</p>
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

        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
          <span className="text-sm font-semibold text-ink">Revoke a token approval</span>
          <p className="text-xs text-ink-faint">
            Know a contract you no longer trust? Check{" "}
            <a href="https://revoke.cash" target="_blank" rel="noreferrer" className="text-accent hover:underline">
              revoke.cash
            </a>{" "}
            to find the exact token/spender, then revoke it here.
          </p>
          <div className="flex flex-wrap gap-2">
            {EVM_CHAINS_FOR_SCAN.map((c) => (
              <button
                key={c.chainId}
                onClick={() => setRevokeChainId(c.chainId)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  revokeChainId === c.chainId ? "border-accent bg-accent-soft text-accent" : "border-hairline text-ink-muted"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <input
            className="num rounded-lg border border-hairline bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            placeholder="Token contract address (0x…)"
            value={revokeToken}
            onChange={(e) => setRevokeToken(e.target.value)}
          />
          <input
            className="num rounded-lg border border-hairline bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            placeholder="Spender (approved contract) address (0x…)"
            value={revokeSpender}
            onChange={(e) => setRevokeSpender(e.target.value)}
          />
          <button
            onClick={revokeApproval}
            disabled={revoking || !evmWallet.address}
            className="self-start rounded-full border border-danger px-4 py-1.5 text-sm font-semibold text-danger transition-all hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {revoking ? "Revoking…" : "Revoke this approval"}
          </button>
          {revokeMessage && <p className="text-xs text-ink-muted">{revokeMessage}</p>}
        </section>

        {message && <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>}
      </div>
    </main>
  );
}
