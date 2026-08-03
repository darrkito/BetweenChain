import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isTradeportListingStillActive, type TradeportChain } from "@/lib/nft/tradeport";
import { estimateTradeportBuyCostMist } from "@/lib/nft/tradeportBuy";
import { getChangeNowReverseEstimate, ChangeNowAmountOutOfRangeError, type ChangeNowOriginCurrency } from "@/lib/chains/changenow";
import { getEthUsdPrice, getSolUsdPrice, getSuiUsdPrice } from "@/lib/pricing";
import { SOLANA_CHAIN_ID } from "@/lib/chains/relay";
import { SuiInsufficientBalanceError } from "@/lib/chains/sui";
import { TRADEPORT_FEE_SAFETY_MARGIN, CROSS_CHAIN_BRIDGE_BUFFER } from "@/lib/nft/tradeportFee";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { roundUpTo2Decimals } from "@/lib/client/amount";
import { rateLimit, clientKey } from "@/lib/rate-limit";

const QUOTE_TTL_MS = 60_000; // same as the OpenSea NFT quote — see that route's comment

const bodySchema = z.object({
  collectionSlug: z.string().min(1),
  tokenId: z.string().min(1), // Tradeport's nft_id
  listingId: z.string().min(1),
  listingPriceSui: z.string().min(1),
  moveChain: z.enum(["sui", "aptos", "movement"]).default("sui"),
  payWith: z.enum(["sui", "eth", "sol"]),
  // Required when payWith === "eth": who signs the ChangeNOW deposit
  // transfer, and which EVM chain they're paying from (Ethereum mainnet
  // only for now — see NftBuyModalSui.tsx). Not used for "sol" — the
  // Solana signer is always the session's own solanaPubkey (see below),
  // same convention as the OpenSea purchase quote's Solana-origin path.
  originChainId: z.number().int().optional(),
  sourceAddress: z.string().min(1).optional(),
  // The buyer's own Sui wallet — receives the bridged SUI (or already holds
  // it, same-chain) AND signs the Tradeport buy itself in step 2. Same
  // msg.sender-safety role as destAddress on the OpenSea purchase quote.
  destAddress: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:sui:quote"), 15, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  if (input.payWith === "eth" && (!input.originChainId || !input.sourceAddress || !isPlausibleEvmAddress(input.sourceAddress))) {
    return NextResponse.json({ error: "Invalid or missing EVM origin chain/address" }, { status: 400 });
  }
  if (input.payWith === "sol" && !session.solanaPubkey) {
    return NextResponse.json({ error: "Paying from Solana requires a Solana wallet — sign in with Solana to continue." }, { status: 400 });
  }

  try {
    // Real, immediate staleness check — same role as OpenSea's fresh
    // fulfillment_data call on the quote route: a sold/delisted listing
    // fails here before anything is quoted or persisted.
    const stillActive = await isTradeportListingStillActive(input.moveChain as TradeportChain, input.listingId);
    if (!stillActive) return NextResponse.json({ error: "This listing is no longer available." }, { status: 409 });

    const isSameChain = input.payWith === "sui";

    // Same-chain: the buyer's Sui wallet ALREADY holds real funds (no
    // bridging leg at all) — no chicken-and-egg problem, so get the REAL
    // exact cost directly via a dry run instead of an estimate. This is
    // the whole reason the cross-chain paths still need
    // TRADEPORT_FEE_SAFETY_MARGIN: they don't have funds to dry-run
    // against until after bridging. Same-chain never had that excuse.
    let totalSui: number;
    if (isSameChain) {
      try {
        const costMist = await estimateTradeportBuyCostMist({ listingId: input.listingId, walletAddress: input.destAddress });
        totalSui = Number(costMist) / 1e9;
      } catch (err) {
        if (err instanceof SuiInsufficientBalanceError) {
          // Wallet is too underfunded even to resolve the dry run — same
          // "clean, actionable error, not a raw crash" pattern as
          // ChangeNowAmountOutOfRangeError below. Fall back to the
          // safety-margin ESTIMATE just for the error message's "roughly
          // this much" figure, clearly labeled as an estimate.
          const roughEstimate = Number(input.listingPriceSui) * (1 + TRADEPORT_FEE_SAFETY_MARGIN);
          return NextResponse.json(
            { error: `Your wallet doesn't have enough SUI for this purchase (needs roughly ${roundUpTo2Decimals(roughEstimate)} SUI).` },
            { status: 400 },
          );
        }
        throw err;
      }
    } else {
      // Cross-chain: ESTIMATE only, not the authoritative cost — no funds
      // exist yet for a cross-chain buyer until after bridging, so a real
      // dry run isn't possible here. TRADEPORT_FEE_SAFETY_MARGIN sizes the
      // known Tradeport fee; CROSS_CHAIN_BRIDGE_BUFFER adds extra headroom
      // ON TOP specifically because a cross-chain buyer has already
      // committed real funds through an irreversible conversion by the time
      // confirm-deposit's real dry run runs — discovering a shortfall THEN
      // is unacceptable, not just inconvenient (2026-07-22 user
      // requirement), so this path is sized more generously than same-chain
      // needs to be. The confirm-deposit route still runs the REAL dry run
      // once funds have landed and blocks on insufficient funds as a safety
      // net, but this buffer should make that path for insufficient-funds
      // exceptional rather than routine.
      totalSui = Number(input.listingPriceSui) * (1 + TRADEPORT_FEE_SAFETY_MARGIN + CROSS_CHAIN_BRIDGE_BUFFER);
    }

    let bridgeQuote: unknown = null;
    // origin_amount's UNIT differs by path (both fit the numeric column
    // fine, just documenting so a future reader isn't surprised): same-chain
    // stores raw MIST (matches this app's usual "raw atomic units"
    // convention elsewhere); cross-chain stores a plain decimal amount in
    // the origin currency, because ChangeNOW's own API speaks decimals
    // throughout, not atomic units — see lib/chains/changenow.ts's top
    // comment.
    let originAmountForDb: string;
    let originAmountFormatted: string;
    let originAmountUsd: string;
    let originCurrencySymbol: string;
    let originChainSlug: string;
    let originChainId: number | null;
    let originAddress: string | null;

    if (isSameChain) {
      originAmountForDb = Math.ceil(totalSui * 1e9).toString();
      originAmountFormatted = totalSui.toString();
      originCurrencySymbol = "SUI";
      originAmountUsd = (totalSui * (await getSuiUsdPrice())).toString();
      originChainSlug = "sui";
      originChainId = null;
      originAddress = null;
    } else {
      const changeNowCurrency: ChangeNowOriginCurrency = input.payWith === "sol" ? "sol" : "eth";
      // Reverse fixed-rate estimate: exact SUI amount needed -> exact
      // ETH/SOL cost, no safety-margin/leftover math needed (unlike the
      // earlier Squid EXACT_INPUT-only attempt) — see
      // getChangeNowReverseEstimate's doc.
      const estimate = await getChangeNowReverseEstimate({ fromCurrency: changeNowCurrency, toAmountSui: totalSui.toString() });
      bridgeQuote = { rateId: estimate.rateId, validUntil: estimate.validUntil, estimate };
      originAmountForDb = estimate.fromAmount;
      originAmountFormatted = estimate.fromAmount;
      originCurrencySymbol = changeNowCurrency === "sol" ? "SOL" : "ETH";
      originAmountUsd = (Number(estimate.fromAmount) * (await (changeNowCurrency === "sol" ? getSolUsdPrice() : getEthUsdPrice()))).toString();
      originChainSlug = changeNowCurrency;
      originChainId = changeNowCurrency === "sol" ? SOLANA_CHAIN_ID : input.originChainId!;
      originAddress = changeNowCurrency === "sol" ? session.solanaPubkey! : input.sourceAddress!;
    }

    const db = supabaseAdmin();
    const { data: quoteRow, error } = await db
      .from("nft_purchase_quotes")
      .insert({
        user_id: session.userId,
        vendor: "tradeport",
        chain_family: "move",
        collection_slug: input.collectionSlug,
        token_id: input.tokenId,
        listing_price: input.listingPriceSui,
        listing_currency: "SUI",
        origin_chain_slug: originChainSlug,
        origin_chain_id: originChainId,
        origin_currency: originCurrencySymbol,
        origin_address: originAddress,
        dest_address: input.destAddress,
        move_chain: input.moveChain,
        tradeport_listing_id: input.listingId,
        bridge_quote: bridgeQuote,
        origin_amount: originAmountForDb,
        origin_amount_usd: originAmountUsd,
        expires_at: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      })
      .select("id, expires_at")
      .single();
    if (error || !quoteRow) throw new Error(error?.message ?? "Failed to persist Sui NFT purchase quote");

    return NextResponse.json({
      quoteId: quoteRow.id,
      expiresAt: quoteRow.expires_at,
      sameChain: isSameChain,
      listingPriceSui: input.listingPriceSui,
      originAmountFormatted,
      originAmountUsd,
      originCurrencySymbol,
    });
  } catch (err) {
    if (err instanceof ChangeNowAmountOutOfRangeError) {
      // A real business constraint (every exchange has a minimum
      // economical trade size), not a bug — surface it as a clear,
      // actionable 400 rather than a scary unexplained 502. See
      // ChangeNowAmountOutOfRangeError's doc for how the min/max are
      // derived. Also shown in SUI terms (what the buyer actually cares
      // about, since the listing price is in SUI) — both figures rounded
      // UP to 2 decimals so neither ever understates the real minimum.
      const symbol = err.fromCurrency === "sol" ? "SOL" : "ETH";
      const originUsdPrice = await (err.fromCurrency === "sol" ? getSolUsdPrice() : getEthUsdPrice());
      const suiUsdPrice = await getSuiUsdPrice();
      const minAmountSui = (err.minAmount * originUsdPrice) / suiUsdPrice;
      return NextResponse.json(
        {
          error: `This listing is too small to bridge via ${symbol} right now — ChangeNOW requires at least ${roundUpTo2Decimals(err.minAmount)} ${symbol} per exchange (≈${roundUpTo2Decimals(minAmountSui)} SUI). Try "Pay with SUI" instead, or a higher-priced listing.`,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
