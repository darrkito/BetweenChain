import "server-only";
import { createPublicClient, http, parseEther, type Chain } from "viem";
import { mainnet, base, polygon, arbitrum, optimism, avalanche } from "viem/chains";

// Server-side EVM RPC — distinct from lib/client/useEvmWallet.ts's client,
// which only ever talks through the browser's injected provider. This one
// exists specifically to independently VERIFY a client-reported transaction
// hash actually succeeded on-chain before crediting anything (same "never
// trust client-reported data" principle already applied to the Relay
// settlement check in /api/bridge/confirm — see SECURITY.md's resolved gap
// #1), and to estimate gas for a not-yet-signed buy call.
//
// Fallback URLs are explicit, NOT viem's own built-ins — a real bug found
// live 2026-07-20: viem's default mainnet RPC (eth.merkle.io) now 401s
// ("invalid key") with no URL configured, which would have silently broken
// EVERYTHING using this client. publicnode.com confirmed live working for
// both chains below. Same known limitation as the Solana side's
// NEXT_PUBLIC_SOLANA_RPC_URL default either way — get a dedicated provider
// (Alchemy, Infura) before real traffic.
//
// One client per chain (2026-07-21, added for Base) — every call in this
// file that touches on-chain state MUST use the client matching the
// listing's actual chain, or gas/fee estimates and receipt lookups are
// silently meaningless (computed against/looked up on the wrong network
// entirely, not just wrong numbers). Keyed by numeric chain id, same ids
// lib/nft/evmChains.ts's EVM_CHAINS already uses.
//
// Polygon/Arbitrum/Optimism/Avalanche added 2026-08-03, matching the same
// additions to EVM_CHAINS (see that file's comment for why the rest of
// PLAN.md's ~20-chain OpenSea list isn't here yet). Every publicnode.com
// fallback below was confirmed live via a raw eth_chainId call returning
// the expected chain id before being committed — same discipline as the
// original mainnet/base entries' fallback-URL bug writeup above.
const CHAIN_CONFIG: Record<number, { chain: Chain; envVar: string; fallbackRpc: string }> = {
  1: { chain: mainnet, envVar: "EVM_RPC_URL", fallbackRpc: "https://ethereum.publicnode.com" },
  8453: { chain: base, envVar: "BASE_RPC_URL", fallbackRpc: "https://base.publicnode.com" },
  137: { chain: polygon, envVar: "POLYGON_RPC_URL", fallbackRpc: "https://polygon-bor-rpc.publicnode.com" },
  42161: { chain: arbitrum, envVar: "ARBITRUM_RPC_URL", fallbackRpc: "https://arbitrum-one-rpc.publicnode.com" },
  10: { chain: optimism, envVar: "OPTIMISM_RPC_URL", fallbackRpc: "https://optimism-rpc.publicnode.com" },
  43114: { chain: avalanche, envVar: "AVALANCHE_RPC_URL", fallbackRpc: "https://avalanche-c-chain-rpc.publicnode.com" },
};

const clientCache = new Map<number, ReturnType<typeof createPublicClient>>();

export function getPublicClient(chainId: number) {
  const cached = clientCache.get(chainId);
  if (cached) return cached;
  const config = CHAIN_CONFIG[chainId];
  if (!config) throw new Error(`No RPC configured for EVM chain id ${chainId}`);
  const client = createPublicClient({ chain: config.chain, transport: http(process.env[config.envVar] || config.fallbackRpc) });
  clientCache.set(chainId, client);
  return client;
}

export async function isEvmTxSuccessful(txHash: `0x${string}`, chainId: number): Promise<boolean> {
  const receipt = await getPublicClient(chainId).getTransactionReceipt({ hash: txHash });
  return receipt.status === "success";
}

// Applied on top of the already-conservative maxFeePerGas estimate — the
// buyer's step-1 deposit can take real minutes to bridge/settle before they
// ever sign step 2, and gas prices can move meaningfully in that window.
// 3/2 (1.5x) is a deliberate safety margin, not a precise prediction — BigInt
// has no decimal literals (and this project's ES2017 target doesn't support
// BigInt literal syntax at all, only the BigInt() call — matching the
// existing convention elsewhere in this codebase), so this is done as an
// integer numerator/denominator pair rather than a float multiplier.
const GAS_SAFETY_NUMERATOR = BigInt(3);
const GAS_SAFETY_DENOMINATOR = BigInt(2);

// A quote is built BEFORE step 1's bridge delivers any funds — the buyer's
// destination wallet genuinely has 0 ETH at this point. Confirmed live
// 2026-07-20 that estimateGas rejects a value-transferring call from a
// zero-balance account outright ("The total cost ... exceeds the balance of
// the account"), and that zeroing `value` instead just makes the Seaport
// call itself revert (it requires the real payment). The fix is a
// `stateOverride` that fakes a large balance for gas-estimation purposes
// only — confirmed live to return a real, sane estimate (~188k gas) for the
// exact same call that fails without it. Purely local to this one RPC call;
// changes nothing on-chain.
const GAS_ESTIMATION_BALANCE_OVERRIDE = parseEther("1000");

/**
 * How much ETH a buyer's wallet needs in total to both PAY for an NFT (the
 * call's `value`) AND cover gas for submitting that same call — a real gap
 * found live 2026-07-20: the original quote only delivered the exact
 * listing price, which would have left the buyer's wallet with zero ETH for
 * gas, guaranteeing step 2 fails with "insufficient funds for gas" every
 * single time. This is what the quote step should request from Relay
 * instead of the bare listing price.
 */
export async function estimateBuyCallTotalCostWei(
  call: { to: string; value: string; data: string },
  from: string,
  chainId: number,
): Promise<string> {
  const account = from as `0x${string}`;
  const client = getPublicClient(chainId);
  const [gasEstimate, fees] = await Promise.all([
    client.estimateGas({
      account,
      to: call.to as `0x${string}`,
      data: call.data as `0x${string}`,
      value: BigInt(call.value),
      stateOverride: [{ address: account, balance: GAS_ESTIMATION_BALANCE_OVERRIDE }],
    }),
    client.estimateFeesPerGas(),
  ]);
  const gasCostWei = (gasEstimate * fees.maxFeePerGas * GAS_SAFETY_NUMERATOR) / GAS_SAFETY_DENOMINATOR;
  return (BigInt(call.value) + gasCostWei).toString();
}
