import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { erc20Abi, isAddress } from "viem";
import { getTokenListForChain } from "@/lib/chains/tokenList";
import { getPublicClient } from "@/lib/chains/evm";
import { SOLANA_CHAIN_ID } from "@/lib/chains/relay";
import { getConnection } from "@/lib/solana";
import { getSolUsdPrice, getEthUsdPrice, getEvmTokenUsdPrices } from "@/lib/pricing";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";
import type { TokenListItem } from "@/lib/chains/types";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// The standard SPL Token program id — hardcoded rather than pulling in
// @solana/spl-token (not currently a dependency) just for one constant.
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export interface TokenBalance {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  isNative: boolean;
  balance: string; // human units, e.g. "1.5"
  balanceUsd: string | null; // null when no price was available — never fabricated
}

function sortByUsdDesc(a: TokenBalance, b: TokenBalance): number {
  const au = a.balanceUsd != null ? Number(a.balanceUsd) : -1;
  const bu = b.balanceUsd != null ? Number(b.balanceUsd) : -1;
  return bu - au;
}

/**
 * Wallet holdings for the token picker's "Your tokens" section
 * (TokenSelectModal.tsx) — real user request 2026-08-06. Deliberately
 * scoped to tokens this app ALREADY knows about via getTokenListForChain
 * (the exact list the picker itself shows) rather than a full arbitrary
 * wallet scan — one batched balance check per chain, no new indexer
 * dependency. Public/unauthenticated (same as /api/tokens/list) — a wallet
 * address and its public on-chain balances aren't secret.
 */
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:balances"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const chainIdRaw = url.searchParams.get("chainId");
  const owner = url.searchParams.get("owner");
  const chainId = Number(chainIdRaw);

  if (!chainIdRaw || !Number.isInteger(chainId)) {
    return NextResponse.json({ error: "chainId query param is required" }, { status: 400 });
  }
  if (!owner) {
    return NextResponse.json({ error: "owner query param is required" }, { status: 400 });
  }

  try {
    const tokens = await getTokenListForChain(chainId);
    if (tokens.length === 0) return NextResponse.json({ balances: [] });

    const balances = chainId === SOLANA_CHAIN_ID ? await getSolanaBalances(owner, tokens) : await getEvmBalances(chainId, owner, tokens);

    return NextResponse.json({ balances: balances.sort(sortByUsdDesc) });
  } catch (err) {
    return safeErrorResponse("tokens/balances", err, 502);
  }
}

async function getSolanaBalances(owner: string, tokens: TokenListItem[]): Promise<TokenBalance[]> {
  let ownerKey: PublicKey;
  try {
    ownerKey = new PublicKey(owner);
  } catch {
    return []; // not a valid Solana address — nothing to show, not an error
  }

  const connection = getConnection();
  const byMint = new Map(tokens.map((t) => [t.address, t]));

  const [lamports, tokenAccounts] = await Promise.all([
    connection.getBalance(ownerKey),
    connection.getParsedTokenAccountsByOwner(ownerKey, { programId: TOKEN_PROGRAM_ID }),
  ]);

  const held: Array<{ token: TokenListItem; amount: number }> = [];

  const nativeToken = tokens.find((t) => t.isNative);
  if (nativeToken && lamports > 0) {
    held.push({ token: nativeToken, amount: lamports / 1e9 });
  }

  for (const { account } of tokenAccounts.value) {
    const info = account.data.parsed?.info;
    const mint: string | undefined = info?.mint;
    const uiAmount: number | undefined = info?.tokenAmount?.uiAmount;
    if (!mint || !uiAmount || uiAmount <= 0) continue;
    const token = byMint.get(mint);
    if (!token) continue; // only surface tokens already in this app's own list
    held.push({ token, amount: uiAmount });
  }

  if (held.length === 0) return [];

  const solUsdPrice = await getSolUsdPrice().catch(() => null);
  // Only native SOL is priced today — Jupiter's price/v3 covers arbitrary
  // SPL mints too, but this app's existing getSolUsdPrice helper is
  // SOL-only; extending it to arbitrary mints is a straightforward
  // follow-up, not done here to keep this change scoped to what was asked.
  return held.map(({ token, amount }) => ({
    chainId: token.chainId,
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    logoURI: token.logoURI,
    isNative: token.isNative,
    balance: amount.toString(),
    balanceUsd: token.isNative && solUsdPrice ? (amount * solUsdPrice).toFixed(2) : null,
  }));
}

async function getEvmBalances(chainId: number, owner: string, tokens: TokenListItem[]): Promise<TokenBalance[]> {
  if (!isAddress(owner)) return []; // not a valid EVM address — nothing to show, not an error

  let client;
  try {
    client = getPublicClient(chainId);
  } catch {
    return []; // no RPC configured for this chain — same "nothing to show" treatment
  }

  const nativeToken = tokens.find((t) => t.isNative);
  const erc20Tokens = tokens.filter((t) => !t.isNative && isAddress(t.address));

  const [nativeBalance, erc20Results] = await Promise.all([
    nativeToken ? client.getBalance({ address: owner as `0x${string}` }) : Promise.resolve(BigInt(0)),
    erc20Tokens.length > 0
      ? client.multicall({
          contracts: erc20Tokens.map((t) => ({
            address: t.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner as `0x${string}`],
          })),
          allowFailure: true,
        })
      : Promise.resolve([]),
  ]);

  const held: Array<{ token: TokenListItem; amount: number }> = [];
  if (nativeToken && nativeBalance > BigInt(0)) {
    held.push({ token: nativeToken, amount: Number(nativeBalance) / 10 ** nativeToken.decimals });
  }
  erc20Results.forEach((result, i) => {
    if (result.status !== "success") return;
    const raw = result.result as bigint;
    if (raw <= BigInt(0)) return;
    const token = erc20Tokens[i];
    held.push({ token, amount: Number(raw) / 10 ** token.decimals });
  });

  if (held.length === 0) return [];

  // CoinGecko's token_price-by-contract endpoint only covers real ERC20
  // contracts, not the native asset (address 0x00...00 isn't a listed
  // "contract"). Ethereum/Base/Arbitrum/Optimism all share ETH as their
  // native currency, already priced elsewhere (getEthUsdPrice) — reused
  // rather than a second lookup. Polygon (MATIC) and Avalanche (AVAX)
  // aren't covered by any existing price helper — their native balance
  // shows with no $ figure rather than a guessed one, same "null when
  // unavailable, never fabricated" rule the rest of this route follows.
  const ETH_NATIVE_CHAIN_IDS = new Set([1, 8453, 42161, 10]);
  const [ethUsdPrice, contractPrices] = await Promise.all([
    nativeToken && ETH_NATIVE_CHAIN_IDS.has(chainId) ? getEthUsdPrice().catch(() => null) : Promise.resolve(null),
    getEvmTokenUsdPrices(
      chainId,
      erc20Tokens.map((t) => t.address),
    ),
  ]);

  return held.map(({ token, amount }) => {
    const price = token.isNative ? (ethUsdPrice ?? undefined) : contractPrices[token.address.toLowerCase()];
    return {
      chainId: token.chainId,
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      logoURI: token.logoURI,
      isNative: token.isNative,
      balance: amount.toString(),
      balanceUsd: price != null ? (amount * price).toFixed(2) : null,
    };
  });
}
