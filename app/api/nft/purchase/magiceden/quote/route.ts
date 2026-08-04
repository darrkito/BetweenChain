import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getMagicEdenBuyInstructions } from "@/lib/nft/magiceden";
import { getRelayCallQuote, SOLANA_CHAIN_ID, RELAY_NATIVE_SOL_SENTINEL, RELAY_NATIVE_EVM_SENTINEL } from "@/lib/chains/relay";
import { getSolUsdPrice } from "@/lib/pricing";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { EVM_CHAINS } from "@/lib/nft/evmChains";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftListing } from "@/lib/nft/types";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const QUOTE_TTL_MS = 60_000; // same as every other NFT purchase quote — see app/api/nft/purchase/quote/route.ts

// EVM origins offered for the cross-chain path — Ethereum, Base, Arbitrum
// (2026-08-03 addition, was Ethereum-only). Must match
// NftBuyModalMagicEden.tsx's MAGICEDEN_EVM_ORIGIN_SLUGS exactly. Pulled from
// the shared EVM_CHAINS registry rather than a second hardcoded list — see
// lib/nft/evmChains.ts's file comment.
const MAGICEDEN_EVM_ORIGIN_CHAIN_IDS = new Set(
  EVM_CHAINS.filter((c) => ["ethereum", "base", "arbitrum"].includes(c.slug)).map((c) => c.chainId),
);

const bodySchema = z.object({
  collectionSlug: z.string().min(1),
  tokenId: z.string().min(1), // Magic Eden's tokenMint
  pdaAddress: z.string().min(1),
  auctionHouse: z.string().min(1),
  seller: z.string().min(1),
  tokenATA: z.string().min(1),
  listingPriceSol: z.string().min(1),
  payWith: z.enum(["sol", "eth"]),
  originChainId: z.number().int().optional(), // EVM origin chain id for the "eth" path — see MAGICEDEN_EVM_ORIGIN_CHAIN_IDS
  sourceAddress: z.string().min(1).optional(), // EVM signer for the "eth" origin deposit
  // The buyer's own Solana wallet — pays directly (same-chain) or receives
  // the bridged SOL AND signs the Magic Eden buy_now tx itself (cross-chain,
  // same two-signature msg.sender-safety role as destAddress everywhere
  // else in this app, see migration 0006's comment).
  destAddress: z.string().min(1),
});

/**
 * Mirrors app/api/nft/purchase/sui/quote/route.ts's structure — same-chain
 * (payWith="sol") vs cross-chain (payWith="eth") branching, quote persisted
 * to the shared nft_purchase_quotes table. Unlike Sui, Relay natively
 * delivers plain SOL to a Solana destination address (SOLANA_CHAIN_ID
 * already exists in lib/chains/relay.ts, used elsewhere in this app) — no
 * ChangeNOW needed here, the ETH-origin leg reuses the EXISTING
 * relay_quote/getRelayCallQuote path already built for OpenSea's EVM
 * cross-chain flow (migration 0006's two-signature design: Relay delivers
 * exact SOL to the buyer's OWN wallet, that same wallet then separately
 * signs the Magic Eden buy itself).
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:magiceden:quote"), 15, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  const isSameChain = input.payWith === "sol";
  if (isSameChain && session.solanaPubkey !== input.destAddress) {
    return NextResponse.json({ error: "Paying with SOL requires signing in with the same Solana wallet." }, { status: 400 });
  }
  if (!isSameChain && (!input.sourceAddress || !isPlausibleEvmAddress(input.sourceAddress))) {
    return NextResponse.json({ error: "Invalid or missing EVM source address" }, { status: 400 });
  }
  if (!isSameChain && (!input.originChainId || !MAGICEDEN_EVM_ORIGIN_CHAIN_IDS.has(input.originChainId))) {
    return NextResponse.json({ error: "Unsupported EVM origin chain" }, { status: 400 });
  }

  const listingRaw = {
    pdaAddress: input.pdaAddress,
    auctionHouse: input.auctionHouse,
    seller: input.seller,
    tokenAddress: input.tokenATA,
    tokenMint: input.tokenId,
    price: Number(input.listingPriceSol),
  };

  try {
    const listing: NftListing = {
      vendor: "magiceden",
      chainFamily: "solana",
      collectionSlug: input.collectionSlug,
      tokenId: input.tokenId,
      listed: true,
      raw: listingRaw,
    };
    // Early availability check — getMagicEdenBuyInstructions is an
    // unsigned-instruction builder with no on-chain side effects, so calling
    // it here AND again fresh at execute/confirm-deposit time (the real,
    // late staleness check right before signing) is safe and free, same
    // double-check pattern as OpenSea's getOpenSeaBuyCall.
    await getMagicEdenBuyInstructions({ buyer: input.destAddress, listing });

    let originAmountFormatted: string;
    let originAmountUsd: string;
    let originCurrencySymbol: string;
    let relayQuote: unknown = null;
    let originChainId: number;
    let originAddress: string | null;

    if (isSameChain) {
      originAmountFormatted = input.listingPriceSol;
      originAmountUsd = (Number(input.listingPriceSol) * (await getSolUsdPrice())).toString();
      originCurrencySymbol = "SOL";
      originChainId = SOLANA_CHAIN_ID;
      originAddress = null;
    } else {
      const quote = await getRelayCallQuote({
        originChainId: input.originChainId!,
        originCurrency: RELAY_NATIVE_EVM_SENTINEL,
        userOriginAddress: input.sourceAddress!,
        destChainId: SOLANA_CHAIN_ID,
        destCurrency: RELAY_NATIVE_SOL_SENTINEL,
        destAmount: Math.round(Number(input.listingPriceSol) * 1e9).toString(),
        recipient: input.destAddress,
      });
      relayQuote = quote.quote;
      originAmountFormatted = quote.originAmountFormatted;
      originAmountUsd = quote.originAmountUsd;
      // All three supported EVM origins (Ethereum, Base, Arbitrum) are
      // natively ETH-denominated — no per-chain symbol lookup needed.
      originCurrencySymbol = "ETH";
      originChainId = input.originChainId!;
      originAddress = input.sourceAddress!;
    }

    const db = supabaseAdmin();
    const { data: quoteRow, error } = await db
      .from("nft_purchase_quotes")
      .insert({
        user_id: session.userId,
        vendor: "magiceden",
        chain_family: "solana",
        collection_slug: input.collectionSlug,
        token_id: input.tokenId,
        listing_price: input.listingPriceSol,
        listing_currency: "SOL",
        origin_chain_id: originChainId,
        origin_currency: originCurrencySymbol,
        origin_address: originAddress,
        dest_address: input.destAddress,
        relay_quote: relayQuote,
        magiceden_listing: listingRaw,
        origin_amount: originAmountFormatted,
        origin_amount_usd: originAmountUsd,
        expires_at: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      })
      .select("id, expires_at")
      .single();
    if (error || !quoteRow) throw new Error(error?.message ?? "Failed to persist Magic Eden NFT purchase quote");

    return NextResponse.json({
      quoteId: quoteRow.id,
      expiresAt: quoteRow.expires_at,
      sameChain: isSameChain,
      originAmountFormatted,
      originAmountUsd,
      originCurrencySymbol,
    });
  } catch (err) {
    return safeErrorResponse("nft/purchase/magiceden/quote", err, 502);
  }
}
