"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useEvmWallet } from "@/lib/client/EvmWalletProvider";
import { useConnectWalletModal } from "@/lib/client/ConnectWalletModalProvider";
import { AppHeader } from "@/app/components/AppHeader";
import { TokenIcon } from "@/app/components/TokenIcon";
import { TokenSelectModal, type SelectedToken } from "@/app/components/TokenSelectModal";
import { executeSwapFlow, type SwapFlowPhase } from "@/lib/client/executeSwapFlow";
import { toAtomicAmount } from "@/lib/client/amount";
import { SWAP_CHAINS, SOLANA_SWAP_CHAIN, swapChainForChainId } from "@/lib/chains/swapChains";
import { SOLANA_CHAIN_ID_CLIENT, RELAY_NATIVE_EVM_SENTINEL } from "@/lib/client/constants";

interface OrderRow {
  id: string;
  kind: "limit" | "dca";
  inputSymbol: string;
  outputSymbol: string;
  makingAmount: string | null;
  takingAmount: string | null;
  cycleAmount: string | null;
  cycleFrequencySeconds: number | null;
  destChainId: number | null;
  destAddress: string | null;
  deliveryStatus: "manual" | "pending" | "delivering" | "delivered" | "failed";
  deliveryTxSignature: string | null;
  deliveryError: string | null;
  createdAt: string;
  jupiterStatus: string;
  orderPubkey: string;
  outputMint: string;
  outputDecimals: number;
}

const NATIVE_SOL = "So11111111111111111111111111111111111111112";

// Jupiter's own live-verified floor (2026-08-08) — see
// lib/chains/jupiterTrigger.ts's doc comment: each DCA cycle must be worth
// at least $50 or Jupiter's own API rejects the order outright.
const DCA_MIN_CYCLE_USD = 50;

export function OrdersClient() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const evmWallet = useEvmWallet();
  const connectWalletModal = useConnectWalletModal();

  const [kind, setKind] = useState<"limit" | "dca">("limit");
  const [inputToken, setInputToken] = useState<SelectedToken | null>(null);
  const [outputToken, setOutputToken] = useState<SelectedToken | null>(null);
  const [pickerSide, setPickerSide] = useState<"input" | "output" | null>(null);

  // Limit order fields
  const [sellAmount, setSellAmount] = useState("");
  const [targetPrice, setTargetPrice] = useState(""); // outputToken per 1 inputToken

  // DCA fields
  const [dcaTotal, setDcaTotal] = useState("");
  const [dcaCycles, setDcaCycles] = useState("10");
  const [dcaIntervalHours, setDcaIntervalHours] = useState("24");

  // Optional cross-chain delivery
  const [deliverCrossChain, setDeliverCrossChain] = useState(false);
  const [destChainId, setDestChainId] = useState<number>(SOLANA_CHAIN_ID_CLIENT);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [deliverPhase, setDeliverPhase] = useState<Record<string, SwapFlowPhase | "error">>({});

  const walletReady = Boolean(publicKey);
  const destChain = swapChainForChainId(destChainId) ?? SOLANA_SWAP_CHAIN;

  async function loadOrders() {
    if (!walletReady) return;
    setLoadingOrders(true);
    try {
      const res = await fetch("/api/orders/list");
      const body = await res.json();
      if (res.ok) setOrders(body.orders);
    } finally {
      setLoadingOrders(false);
    }
  }

  useEffect(() => {
    // Deferred via queueMicrotask rather than calling loadOrders()
    // synchronously — loadOrders sets state (setLoadingOrders) before its
    // first await, which the set-state-in-effect rule correctly flags as a
    // same-tick cascading render when called directly from the effect body.
    queueMicrotask(() => {
      loadOrders();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletReady]);

  async function createOrder() {
    if (!walletReady) {
      connectWalletModal.setOpen(true);
      return;
    }
    if (!inputToken || !outputToken) {
      setMessage("Pick both tokens.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      let body: Record<string, unknown>;
      if (kind === "limit") {
        if (!sellAmount || !targetPrice) throw new Error("Enter an amount and a target price.");
        const makingAmount = BigInt(Math.round(Number(sellAmount) * 10 ** inputToken.decimals)).toString();
        const takingAmount = BigInt(Math.round(Number(sellAmount) * Number(targetPrice) * 10 ** outputToken.decimals)).toString();
        body = {
          kind: "limit",
          inputMint: inputToken.address === "SOL" ? NATIVE_SOL : inputToken.address,
          inputSymbol: inputToken.symbol,
          inputDecimals: inputToken.decimals,
          outputMint: outputToken.address === "SOL" ? NATIVE_SOL : outputToken.address,
          outputSymbol: outputToken.symbol,
          outputDecimals: outputToken.decimals,
          makingAmount,
          takingAmount,
          destChainId: deliverCrossChain && destChainId !== SOLANA_CHAIN_ID_CLIENT ? destChainId : undefined,
          destAddress: deliverCrossChain && destChainId !== SOLANA_CHAIN_ID_CLIENT ? evmWallet.address ?? undefined : undefined,
        };
      } else {
        if (!dcaTotal || Number(dcaCycles) < 2) throw new Error("Enter a total amount and at least 2 cycles.");
        const inAmount = BigInt(Math.round(Number(dcaTotal) * 10 ** inputToken.decimals)).toString();
        body = {
          kind: "dca",
          inputMint: inputToken.address === "SOL" ? NATIVE_SOL : inputToken.address,
          inputSymbol: inputToken.symbol,
          inputDecimals: inputToken.decimals,
          outputMint: outputToken.address === "SOL" ? NATIVE_SOL : outputToken.address,
          outputSymbol: outputToken.symbol,
          outputDecimals: outputToken.decimals,
          inAmount,
          numberOfOrders: Number(dcaCycles),
          intervalSeconds: Math.round(Number(dcaIntervalHours) * 3600),
          destChainId: deliverCrossChain && destChainId !== SOLANA_CHAIN_ID_CLIENT ? destChainId : undefined,
          destAddress: deliverCrossChain && destChainId !== SOLANA_CHAIN_ID_CLIENT ? evmWallet.address ?? undefined : undefined,
        };
      }

      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const created = await res.json();
      if (!res.ok) throw new Error(created.error ?? "Order creation failed");

      if (!publicKey || !signTransaction) throw new Error("Solana wallet required.");
      const tx = VersionedTransaction.deserialize(Buffer.from(created.transaction, "base64"));
      const signed = await signTransaction(tx);
      await connection.sendRawTransaction(signed.serialize());

      // Fully-unattended delivery (2026-08-09): a second signature, ONLY
      // when the server built a bounded delegate-approval transaction (it
      // won't, if the relayer isn't configured — the order above still
      // succeeds either way, delivery just falls back to the manual "Deliver
      // now" flow in that case).
      if (created.delegateTransaction) {
        const delegateTx = VersionedTransaction.deserialize(Buffer.from(created.delegateTransaction, "base64"));
        const signedDelegate = await signTransaction(delegateTx);
        await connection.sendRawTransaction(signedDelegate.serialize());
      }

      setMessage(
        kind === "limit"
          ? created.delegateTransaction
            ? "Limit order placed — will deliver automatically once filled."
            : "Limit order placed."
          : created.delegateTransaction
            ? "DCA schedule started — will deliver automatically as it fills."
            : "DCA schedule started.",
      );
      setSellAmount("");
      setTargetPrice("");
      setDcaTotal("");
      await loadOrders();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(id: string) {
    if (!publicKey || !signTransaction) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${id}/cancel`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Cancel failed");
      const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
      const signed = await signTransaction(tx);
      await connection.sendRawTransaction(signed.serialize());
      await fetch(`/api/orders/${id}/cancel`, { method: "PATCH" });
      await loadOrders();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deliverCrossChainNow(order: OrderRow) {
    if (!order.destChainId || !order.destAddress || !publicKey) return;
    setDeliverPhase((p) => ({ ...p, [order.id]: "quoting" }));
    try {
      // The filled order's output landed in this wallet's own token
      // account — read the REAL current balance rather than guessing from
      // the order's original making/taking amounts (a limit order's actual
      // fill price can differ slightly from the trigger price, and a DCA
      // order accumulates across many fills). Same
      // /api/tokens/balances?chainId=&owner= route DustSweeperClient uses
      // for EVM balances; here queried for the Solana output mint.
      const balRes = await fetch(`/api/tokens/balances?chainId=${SOLANA_CHAIN_ID_CLIENT}&owner=${publicKey.toBase58()}`);
      const balBody = await balRes.json();
      const held = (balBody.balances ?? []).find((b: { address: string }) => b.address === order.outputMint);
      if (!held || Number(held.balance) <= 0) throw new Error("No balance found for this order's output token yet.");

      await executeSwapFlow(
        {
          sourceChainId: SOLANA_CHAIN_ID_CLIENT,
          sourceMint: order.outputMint,
          sourceAmount: toAtomicAmount(held.balance, order.outputDecimals),
          destChainId: order.destChainId,
          destToken: RELAY_NATIVE_EVM_SENTINEL,
          destAddress: order.destAddress,
          slippageBps: 100,
        },
        { solanaPublicKey: publicKey, signSolanaTransaction: signTransaction, connection, evmWallet },
        (phase) => setDeliverPhase((p) => ({ ...p, [order.id]: phase })),
      );
    } catch (err) {
      setDeliverPhase((p) => ({ ...p, [order.id]: "error" }));
      setMessage((err as Error).message);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <section className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-normal text-ink">⏱️ Trigger Orders</h1>
          <p className="text-sm text-ink-muted">
            Set a Solana price target or a recurring DCA schedule — filled automatically by Jupiter&apos;s own on-chain program and
            keeper network, even while you&apos;re offline. Non-custodial: your tokens stay in a Jupiter-controlled escrow, never with
            us.
          </p>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
          <div className="flex gap-2">
            {(["limit", "dca"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ${
                  kind === k ? "border-accent bg-accent-soft text-accent" : "border-hairline text-ink-muted"
                }`}
              >
                {k === "limit" ? "Limit order" : "DCA (recurring)"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPickerSide("input")}
              className="flex flex-1 items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-sm text-ink"
            >
              {inputToken ? <TokenIcon logoURI={inputToken.logoURI} symbol={inputToken.symbol} size={18} /> : null}
              {inputToken?.symbol ?? "Sell token"}
            </button>
            <span className="text-ink-faint">→</span>
            <button
              onClick={() => setPickerSide("output")}
              className="flex flex-1 items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-sm text-ink"
            >
              {outputToken ? <TokenIcon logoURI={outputToken.logoURI} symbol={outputToken.symbol} size={18} /> : null}
              {outputToken?.symbol ?? "Buy token"}
            </button>
          </div>

          {kind === "limit" ? (
            <>
              <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
                Amount to sell ({inputToken?.symbol ?? "…"})
                <input
                  className="num rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  placeholder="0.00"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
                Trigger price ({outputToken?.symbol ?? "…"} per {inputToken?.symbol ?? "…"})
                <input
                  className="num rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  placeholder="0.00"
                />
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
                Total to invest ({inputToken?.symbol ?? "…"})
                <input
                  className="num rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  value={dcaTotal}
                  onChange={(e) => setDcaTotal(e.target.value)}
                  placeholder="0.00"
                />
              </label>
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1.5 text-sm text-ink-muted">
                  Cycles
                  <input
                    className="num rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    value={dcaCycles}
                    onChange={(e) => setDcaCycles(e.target.value)}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1.5 text-sm text-ink-muted">
                  Every (hours)
                  <input
                    className="num rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    value={dcaIntervalHours}
                    onChange={(e) => setDcaIntervalHours(e.target.value)}
                  />
                </label>
              </div>
              <p className="text-[11px] text-ink-faint">Each cycle must be worth at least ${DCA_MIN_CYCLE_USD} — Jupiter&apos;s own floor.</p>
            </>
          )}

          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={deliverCrossChain} onChange={(e) => setDeliverCrossChain(e.target.checked)} />
            Deliver to another chain once filled — automatic where available, otherwise one click after fill
          </label>
          {deliverCrossChain && (
            <div className="flex flex-wrap gap-2">
              {SWAP_CHAINS.filter((c) => c.chainId !== SOLANA_CHAIN_ID_CLIENT).map((c) => (
                <button
                  key={c.chainId}
                  onClick={() => setDestChainId(c.chainId)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    destChainId === c.chainId ? "border-accent bg-accent-soft text-accent" : "border-hairline text-ink-muted"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={createOrder}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {!walletReady ? "Connect wallet" : busy ? "Working…" : kind === "limit" ? "Place limit order" : "Start DCA"}
          </button>
          {message && <p className="rounded-xl border border-hairline bg-surface-hover px-3 py-2 text-sm text-ink-muted">{message}</p>}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Your orders</h2>
          {loadingOrders && <p className="text-sm text-ink-faint">Loading…</p>}
          {!loadingOrders && orders.length === 0 && <p className="text-sm text-ink-faint">No orders yet.</p>}
          {orders.map((o) => {
            const isCrossChain = Boolean(o.destChainId && o.destChainId !== SOLANA_CHAIN_ID_CLIENT);
            const filled = o.jupiterStatus.toLowerCase() === "completed" && isCrossChain;
            const phase = deliverPhase[o.id];
            const orderDestChain = o.destChainId ? swapChainForChainId(o.destChainId) : null;
            return (
              <div key={o.id} className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">
                    {o.inputSymbol} → {o.outputSymbol} · {o.kind === "limit" ? "Limit" : "DCA"}
                  </span>
                  <span className="text-xs text-ink-faint">{o.jupiterStatus}</span>
                </div>

                {isCrossChain && o.deliveryStatus !== "manual" && (
                  <p className="text-xs text-ink-faint">
                    {o.deliveryStatus === "pending" && `Waiting for fill — will auto-deliver to ${orderDestChain?.label ?? "destination"}.`}
                    {o.deliveryStatus === "delivering" && "Delivering automatically…"}
                    {o.deliveryStatus === "delivered" && `Delivered automatically to ${orderDestChain?.label ?? "destination"} ✅`}
                    {o.deliveryStatus === "failed" && `Automatic delivery failed: ${o.deliveryError ?? "unknown error"}`}
                  </p>
                )}

                {filled && (o.deliveryStatus === "manual" || o.deliveryStatus === "failed") && (
                  <button
                    onClick={() => deliverCrossChainNow(o)}
                    disabled={Boolean(phase) && phase !== "error"}
                    className="rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent"
                  >
                    {phase && phase !== "error" ? "Delivering…" : `Deliver to ${orderDestChain?.label ?? destChain.label} now`}
                  </button>
                )}
                {!filled && o.jupiterStatus.toLowerCase() !== "cancelled" && (
                  <button onClick={() => cancelOrder(o.id)} disabled={busy} className="self-start text-xs font-medium text-red-500">
                    Cancel
                  </button>
                )}
              </div>
            );
          })}
        </section>
      </div>

      {pickerSide && (
        <TokenSelectModal
          open
          onClose={() => setPickerSide(null)}
          mode="solana-only"
          onSelect={(t) => {
            if (pickerSide === "input") setInputToken(t);
            else setOutputToken(t);
            setPickerSide(null);
          }}
        />
      )}
    </main>
  );
}
