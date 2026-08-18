import "server-only";
import { createPublicClient, http, parseEther, type Chain } from "viem";
import { mainnet, base, polygon, arbitrum, optimism, avalanche, robinhood } from "viem/chains";
import {
  abstract,
  apeChain,
  arbitrumNova,
  b3,
  berachain,
  blast,
  bob,
  boba,
  bsc,
  celo,
  cronos,
  degen,
  gnosis,
  gunz,
  ink,
  katana,
  linea,
  lisk,
  manta,
  mantle,
  megaeth,
  mode,
  monad,
  morph,
  plasma,
  plumeMainnet,
  ronin,
  scroll,
  sei,
  shape,
  somnia,
  soneium,
  sonic,
  stable,
  superseed,
  unichain,
  worldchain,
  zircuit,
  zksync,
  zora,
} from "viem/chains";

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
  // Robinhood Chain added 2026-08-08, matching lib/nft/evmChains.ts's
  // addition — fallback is their own official RPC (no publicnode.com
  // mirror exists for this chain yet), confirmed live via a raw
  // eth_chainId call returning 0x1237 (4663), same discipline as every
  // other fallback URL in this file.
  4663: { chain: robinhood, envVar: "ROBINHOOD_RPC_URL", fallbackRpc: "https://rpc.mainnet.chain.robinhood.com" },

  // 39 swap-only chains added 2026-08-18 (lib/chains/swapOnlyEvmChains.ts)
  // — every fallback below confirmed live via a raw eth_chainId call
  // returning the expected chain id, same discipline as every entry
  // above. Metis, Mythos, AnimeChain, and Doma were deliberately held out
  // (no working RPC / no viem/chains definition at add-time) — see that
  // file's own comment.
  25: { chain: cronos, envVar: "CRONOS_RPC_URL", fallbackRpc: "https://evm.cronos.org" },
  56: { chain: bsc, envVar: "BSC_RPC_URL", fallbackRpc: "https://56.rpc.thirdweb.com" },
  100: { chain: gnosis, envVar: "GNOSIS_RPC_URL", fallbackRpc: "https://rpc.gnosischain.com" },
  130: { chain: unichain, envVar: "UNICHAIN_RPC_URL", fallbackRpc: "https://mainnet.unichain.org" },
  143: { chain: monad, envVar: "MONAD_RPC_URL", fallbackRpc: "https://rpc.monad.xyz" },
  146: { chain: sonic, envVar: "SONIC_RPC_URL", fallbackRpc: "https://rpc.soniclabs.com" },
  169: { chain: manta, envVar: "MANTA_PACIFIC_RPC_URL", fallbackRpc: "https://pacific-rpc.manta.network/http" },
  288: { chain: boba, envVar: "BOBA_RPC_URL", fallbackRpc: "https://mainnet.boba.network" },
  324: { chain: zksync, envVar: "ZKSYNC_RPC_URL", fallbackRpc: "https://mainnet.era.zksync.io" },
  360: { chain: shape, envVar: "SHAPE_RPC_URL", fallbackRpc: "https://mainnet.shape.network" },
  480: { chain: worldchain, envVar: "WORLD_CHAIN_RPC_URL", fallbackRpc: "https://worldchain-mainnet.g.alchemy.com/public" },
  988: { chain: stable, envVar: "STABLE_RPC_URL", fallbackRpc: "https://rpc.stable.xyz" },
  1135: { chain: lisk, envVar: "LISK_RPC_URL", fallbackRpc: "https://rpc.api.lisk.com" },
  1329: { chain: sei, envVar: "SEI_RPC_URL", fallbackRpc: "https://evm-rpc.sei-apis.com" },
  1868: { chain: soneium, envVar: "SONEIUM_RPC_URL", fallbackRpc: "https://rpc.soneium.org" },
  2020: { chain: ronin, envVar: "RONIN_RPC_URL", fallbackRpc: "https://api.roninchain.com/rpc" },
  2741: { chain: abstract, envVar: "ABSTRACT_RPC_URL", fallbackRpc: "https://api.mainnet.abs.xyz" },
  2818: { chain: morph, envVar: "MORPH_RPC_URL", fallbackRpc: "https://rpc.morphl2.io" },
  4326: { chain: megaeth, envVar: "MEGAETH_RPC_URL", fallbackRpc: "https://mainnet.megaeth.com/rpc" },
  5000: { chain: mantle, envVar: "MANTLE_RPC_URL", fallbackRpc: "https://rpc.mantle.xyz" },
  5031: { chain: somnia, envVar: "SOMNIA_RPC_URL", fallbackRpc: "https://api.infra.mainnet.somnia.network" },
  5330: { chain: superseed, envVar: "SUPERSEED_RPC_URL", fallbackRpc: "https://mainnet.superseed.xyz" },
  8333: { chain: b3, envVar: "B3_RPC_URL", fallbackRpc: "https://mainnet-rpc.b3.fun/http" },
  9745: { chain: plasma, envVar: "PLASMA_RPC_URL", fallbackRpc: "https://rpc.plasma.to" },
  33139: { chain: apeChain, envVar: "APECHAIN_RPC_URL", fallbackRpc: "https://rpc.apechain.com/http" },
  34443: { chain: mode, envVar: "MODE_RPC_URL", fallbackRpc: "https://mainnet.mode.network" },
  42170: { chain: arbitrumNova, envVar: "ARBITRUM_NOVA_RPC_URL", fallbackRpc: "https://nova.arbitrum.io/rpc" },
  42220: { chain: celo, envVar: "CELO_RPC_URL", fallbackRpc: "https://forno.celo.org" },
  43419: {
    chain: gunz,
    envVar: "GUNZ_RPC_URL",
    fallbackRpc: "https://rpc.gunzchain.io/ext/bc/2M47TxWHGnhNtq6pM5zPXdATBtuqubxn5EPFgFmEawCQr9WFML/rpc",
  },
  48900: { chain: zircuit, envVar: "ZIRCUIT_RPC_URL", fallbackRpc: "https://mainnet.zircuit.com" },
  57073: { chain: ink, envVar: "INK_RPC_URL", fallbackRpc: "https://rpc-gel.inkonchain.com" },
  59144: { chain: linea, envVar: "LINEA_RPC_URL", fallbackRpc: "https://rpc.linea.build" },
  60808: { chain: bob, envVar: "BOB_RPC_URL", fallbackRpc: "https://rpc.gobob.xyz" },
  80094: { chain: berachain, envVar: "BERACHAIN_RPC_URL", fallbackRpc: "https://rpc.berachain.com" },
  81457: { chain: blast, envVar: "BLAST_RPC_URL", fallbackRpc: "https://rpc.blast.io" },
  98866: { chain: plumeMainnet, envVar: "PLUME_RPC_URL", fallbackRpc: "https://rpc.plume.org" },
  534352: { chain: scroll, envVar: "SCROLL_RPC_URL", fallbackRpc: "https://rpc.scroll.io" },
  747474: { chain: katana, envVar: "KATANA_RPC_URL", fallbackRpc: "https://rpc.katana.network" },
  7777777: { chain: zora, envVar: "ZORA_RPC_URL", fallbackRpc: "https://rpc.zora.energy" },
  666666666: { chain: degen, envVar: "DEGEN_RPC_URL", fallbackRpc: "https://rpc.degen.tips" },
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

/**
 * 2026-08-04 — SECURITY FIX (real fraud bug, found in a security audit, not
 * live-exploited but confirmed exploitable): confirm-buy routes used to call
 * an `isEvmTxSuccessful` helper (removed, this replaced its only caller)
 * that just checked a tx succeeded on-chain — nothing tied it to a SPECIFIC
 * purchase. An attacker could create unlimited cheap purchase rows via the
 * normal quote flow, then confirm every one of them with the SAME unrelated
 * valid tx hash (even a trivial 0-value self-transfer), crediting points
 * unboundedly. This closes that: verifies the tx was actually SENT BY the
 * buyer's own wallet, TO the exact Seaport/marketplace contract the fresh
 * buy call targeted, carrying the exact payment value — all three bound to
 * one specific purchase at confirm-deposit time (see
 * app/api/nft/purchase/confirm-deposit/route.ts), not re-derived from
 * anything client-supplied at confirm-buy time. Paired with a unique
 * constraint on nft_purchases.dest_tx_hash (migration 0015) so even a tx
 * that DOES match one purchase's expected to/value can't also be replayed
 * against a different purchase with the same shape.
 */
export async function verifyEvmBuyTx(params: {
  txHash: `0x${string}`;
  chainId: number;
  expectedFrom: string;
  expectedTo: string;
  expectedValueWei: string;
}): Promise<boolean> {
  const client = getPublicClient(params.chainId);
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash: params.txHash }),
    client.getTransaction({ hash: params.txHash }),
  ]);
  return evaluateEvmBuyTx({
    receiptStatus: receipt.status,
    txFrom: tx.from,
    txTo: tx.to,
    txValue: tx.value,
    expectedFrom: params.expectedFrom,
    expectedTo: params.expectedTo,
    expectedValueWei: params.expectedValueWei,
  });
}

/**
 * Pure comparison logic split out of verifyEvmBuyTx (2026-08-04, reliability
 * pass) specifically so it's unit-testable without mocking viem's client —
 * this is the actual security-critical decision (does this tx really pay
 * for THIS purchase), separated from the network I/O that fetches its
 * inputs. See lib/chains/evm.test.ts.
 */
export function evaluateEvmBuyTx(params: {
  receiptStatus: "success" | "reverted";
  txFrom: string;
  txTo: string | null | undefined;
  txValue: bigint;
  expectedFrom: string;
  expectedTo: string;
  expectedValueWei: string;
}): boolean {
  if (params.receiptStatus !== "success") return false;
  if (params.txFrom.toLowerCase() !== params.expectedFrom.toLowerCase()) return false;
  if (!params.txTo || params.txTo.toLowerCase() !== params.expectedTo.toLowerCase()) return false;
  if (params.txValue !== BigInt(params.expectedValueWei)) return false;
  return true;
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
