"use client";

import type { Connection, PublicKey } from "@solana/web3.js";
import { VersionedTransaction } from "@solana/web3.js";
import { buildRelayDepositTransaction } from "@/lib/client/relayTransaction";
import { SOLANA_CHAIN_ID_CLIENT } from "@/lib/client/constants";
import type { useEvmWallet } from "@/lib/client/EvmWalletProvider";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SwapFlowPhase = "quoting" | "leg1_signing" | "leg1_confirming" | "leg2_pending" | "done";

export interface SwapFlowParams {
  sourceChainId: number;
  sourceMint: string;
  sourceAmount: string; // atomic units
  sourceAddress?: string; // required for a non-Solana origin — the connected EVM wallet's own address
  destChainId: number;
  destToken: string;
  destAddress: string;
  slippageBps: number;
  autoRefuel?: boolean;
}

interface SwapFlowWallets {
  solanaPublicKey: PublicKey | null;
  signSolanaTransaction: ((tx: VersionedTransaction) => Promise<VersionedTransaction>) | undefined;
  connection: Connection;
  evmWallet: ReturnType<typeof useEvmWallet>;
}

/**
 * The exact quote -> swap -> confirm -> (bridge -> confirm) sequence
 * app/swap/SwapPageClient.tsx's `runSwap()` already runs for a single
 * manual swap, pulled out here so the Dust Sweeper (which needs to run this
 * same sequence once per selected dust asset, in a loop) doesn't reimplement
 * the signing/polling logic a second time and risk it drifting out of sync.
 * `runSwap()` itself is intentionally left as-is rather than refactored to
 * call this too — it's the highest-traffic money-moving page in the app,
 * and rewiring it under an unrelated feature push isn't worth the
 * regression risk. Same step ids/sequencing as that function; keep them in
 * sync if either changes.
 */
export async function executeSwapFlow(
  params: SwapFlowParams,
  wallets: SwapFlowWallets,
  onProgress: (phase: SwapFlowPhase, message?: string) => void,
): Promise<{ swapId: string }> {
  onProgress("quoting");
  const quoteRes = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!quoteRes.ok) throw new Error((await quoteRes.json()).error ?? "Quote failed");
  const { quoteId } = await quoteRes.json();

  return executeQuotedSwap({ quoteId, sourceChainId: params.sourceChainId, destChainId: params.destChainId }, wallets, onProgress);
}

/**
 * The leg1_signing-onward tail of executeSwapFlow, pulled out so a caller
 * that already created its own swap_quotes row through a DIFFERENT quote
 * endpoint (2026-08-08, ClickPay — app/api/pay/[id]/quote creates a quote
 * with invoice-fixed destination terms instead of caller-supplied ones)
 * doesn't have to duplicate the sign/poll sequence a second time. Every
 * step from here on is already quote-id-generic — the /api/swap,
 * /api/swap/confirm, /api/bridge, /api/bridge/confirm routes don't care
 * which endpoint created the quote they're consuming.
 */
export async function executeQuotedSwap(
  params: { quoteId: string; sourceChainId: number; destChainId: number },
  wallets: SwapFlowWallets,
  onProgress: (phase: SwapFlowPhase, message?: string) => void,
): Promise<{ swapId: string }> {
  const { solanaPublicKey, signSolanaTransaction, connection, evmWallet } = wallets;
  const { quoteId, sourceChainId, destChainId } = params;
  const sellIsSolana = sourceChainId === SOLANA_CHAIN_ID_CLIENT;
  const isCrossChain = destChainId !== sourceChainId;

  onProgress("leg1_signing");
  const swapRes = await fetch("/api/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteId }),
  });
  if (!swapRes.ok) throw new Error((await swapRes.json()).error ?? "Swap build failed");
  const { swapId, status, unsignedTransaction } = await swapRes.json();

  let needsLeg2 = false;

  if (unsignedTransaction) {
    if (!sellIsSolana || !solanaPublicKey || !signSolanaTransaction) {
      throw new Error("A Solana signature is required for this leg but no Solana wallet is connected.");
    }
    const tx = VersionedTransaction.deserialize(Buffer.from(unsignedTransaction, "base64"));
    const signed = await signSolanaTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize());

    onProgress("leg1_confirming");
    const confirmRes = await fetch("/api/swap/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ swapId, signature }),
    });
    if (!confirmRes.ok) throw new Error((await confirmRes.json()).error ?? "Confirm failed");
    const confirmed = await confirmRes.json();
    if (confirmed.status === "complete") {
      onProgress("done");
      return { swapId };
    }
    needsLeg2 = isCrossChain;
  } else if (status === "leg1_confirmed") {
    // Real bug found 2026-08-08 (ClickPay same-chain-EVM payments surfaced
    // it): this used to be `isCrossChain || params.destChainId !==
    // params.sourceChainId` — literally `isCrossChain || isCrossChain`,
    // always false for a same-chain trade regardless of origin. Reached
    // whenever a non-Solana origin's /api/swap call returns
    // `unsignedTransaction: null` (true for EVERY EVM origin — no Jupiter
    // leg ever exists there — see that route's own doc), which for a
    // same-chain EVM trade (isCrossChain false) meant this silently
    // reported "done" WITHOUT ever calling /api/bridge to build/sign the
    // real Relay swap transaction — nothing was actually swapped. Matches
    // app/swap/SwapPageClient.tsx's own correct `needsRelayLeg2 =
    // isCrossChain || !sellIsSolana` now: leg2 is needed for any
    // non-Solana origin, same-chain or not — only same-chain Solana never
    // needs it (Jupiter alone already delivered the correct token there).
    needsLeg2 = isCrossChain || !sellIsSolana;
  } else {
    onProgress("done");
    return { swapId };
  }

  if (!needsLeg2) {
    onProgress("done");
    return { swapId };
  }

  onProgress("leg2_pending", isCrossChain ? "Preparing bridge deposit…" : "Preparing swap…");
  const bridgeRes = await fetch("/api/bridge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ swapId }),
  });
  if (!bridgeRes.ok) throw new Error((await bridgeRes.json()).error ?? "Bridge init failed");
  const { steps } = await bridgeRes.json();

  if (sellIsSolana) {
    if (!solanaPublicKey || !signSolanaTransaction) throw new Error("Solana wallet required for this leg.");
    const depositItem = steps?.[0]?.items?.[0];
    if (!depositItem?.data?.instructions) throw new Error("Bridge step did not include deposit instructions");
    onProgress("leg2_pending", "Confirm the bridge deposit transaction in your wallet…");
    const depositTx = await buildRelayDepositTransaction({
      connection,
      payer: solanaPublicKey,
      instructions: depositItem.data.instructions,
      addressLookupTableAddresses: depositItem.data.addressLookupTableAddresses,
    });
    const signedDeposit = await signSolanaTransaction(depositTx);
    await connection.sendRawTransaction(signedDeposit.serialize());
  } else {
    if (!evmWallet.address) throw new Error("EVM wallet required for this leg.");
    await evmWallet.ensureChain(params.sourceChainId);
    for (let i = 0; i < steps.length; i++) {
      const item = steps[i]?.items?.[0];
      if (!item?.data) throw new Error(`Swap step "${steps[i]?.id}" did not include transaction data`);
      const label = steps[i].id === "approve" ? "Approve token spend" : isCrossChain ? "Confirm deposit" : "Confirm swap";
      onProgress("leg2_pending", `Step ${i + 1} of ${steps.length}: ${label} in your wallet…`);
      await evmWallet.sendStepAndWait(item.data);
    }
  }

  onProgress("leg2_pending", isCrossChain ? "Waiting for the bridge to settle…" : "Waiting for the swap to confirm…");
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(3000);
    const confirmRes = await fetch("/api/bridge/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ swapId }),
    });
    if (!confirmRes.ok) throw new Error((await confirmRes.json()).error ?? "Confirm failed");
    const confirmed = await confirmRes.json();
    if (confirmed.status === "complete") {
      onProgress("done");
      return { swapId };
    }
    if (confirmed.status === "leg2_failed") {
      throw new Error("Settlement failed — safe to retry, funds were not lost mid-flow.");
    }
  }
  throw new Error("Taking longer than expected — check back shortly, it may still settle.");
}
