import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getOpenSeaBuyCall, OpenSeaListingUnavailableError } from "@/lib/nft/opensea";
import { getRelayCallQuote, SOLANA_CHAIN_ID, RELAY_NATIVE_EVM_SENTINEL, OPENSEA_CHAIN_SLUG_TO_RELAY_ID } from "@/lib/chains/relay";
import { estimateBuyCallTotalCostWei } from "@/lib/chains/evm";
import { getEthUsdPrice, weiToUsd } from "@/lib/pricing";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftListing } from "@/lib/nft/types";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const QUOTE_TTL_MS = 60_000; // longer than the token-swap quote's 30s — an NFT
// buy needs the user to review a price before committing, and step 2's fresh
// re-check (not this quote) is what actually guards against staleness.

const bodySchema = z.object({
  collectionSlug: z.string().min(1),
  tokenId: z.string().min(1),
  orderHash: z.string().min(1),
  chainSlug: z.string().min(1), // OpenSea's chain slug, e.g. "ethereum" — from listing.raw.chain
  protocolAddress: z.string().min(1), // from listing.raw.protocol_address
  originChainId: z.number().int(),
  originCurrency: z.string().min(1),
  sourceAddress: z.string().min(1).optional(), // required when origin isn't Solana, mirrors /api/quote
  // The buyer's OWN EVM wallet — receives the bridged ETH in step 1 AND must
  // sign the Seaport buy itself in step 2 (see migration 0006's comment on
  // why this can't be an arbitrary third-party address the way token-swap
  // destinations can).
  destAddress: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:quote"), 15, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;
  const isSolanaOrigin = input.originChainId === SOLANA_CHAIN_ID;

  const relayDestChainId = OPENSEA_CHAIN_SLUG_TO_RELAY_ID[input.chainSlug];
  if (!relayDestChainId) {
    return NextResponse.json({ error: `Unsupported OpenSea chain for purchase: ${input.chainSlug}` }, { status: 400 });
  }
  // Same-chain: the buyer already holds ETH on the NFT's own chain — no
  // Relay leg at all, just one direct signature (see STATE.md 2026-07-21 for
  // the full reasoning). Cross-chain still needs sourceAddress (who signs
  // the origin-chain deposit); same-chain doesn't, since destAddress IS the
  // one wallet doing everything.
  const isSameChain = !isSolanaOrigin && input.originChainId === relayDestChainId;

  if (!isSolanaOrigin && !isSameChain && (!input.sourceAddress || !isPlausibleEvmAddress(input.sourceAddress))) {
    return NextResponse.json({ error: "Invalid or missing EVM source address" }, { status: 400 });
  }
  if (!isPlausibleEvmAddress(input.destAddress)) {
    return NextResponse.json({ error: "Invalid EVM destination address" }, { status: 400 });
  }
  if (isSameChain && input.originCurrency !== RELAY_NATIVE_EVM_SENTINEL) {
    // Same-chain ERC20-to-ETH conversion would need Relay's same-chain swap
    // routing, which is explicitly out of scope everywhere else in this
    // codebase (SECURITY.md: "same-chain EVM-to-EVM swaps aren't supported
    // yet") — same-chain NFT purchases stay native-ETH-only for the same
    // reason, not a new restriction invented here.
    return NextResponse.json({ error: "Same-chain purchases must be paid in the chain's native currency" }, { status: 400 });
  }

  try {
    // A fresh, real fulfillment_data call — this both gets the current price
    // AND doubles as the first listing-staleness check (a sold/cancelled
    // listing fails here, before anything is quoted or persisted). The
    // SECOND, authoritative check happens right before step 2's signature,
    // since step 1's bridging delay is the real risk window.
    const listingForLookup: NftListing = {
      vendor: "opensea",
      chainFamily: "evm",
      collectionSlug: input.collectionSlug,
      tokenId: input.tokenId,
      listed: true,
      raw: { order_hash: input.orderHash, chain: input.chainSlug, protocol_address: input.protocolAddress },
    };
    const call = await getOpenSeaBuyCall({ listing: listingForLookup, fulfillerAddress: input.destAddress });
    const listingPriceWei = call.value;

    // Total price + gas headroom, not just the bare price — a real gap found
    // live 2026-07-20: since step 1 (bridge) and step 2 (buy) are two
    // separate transactions in the cross-chain case, delivering exactly the
    // listing price would leave the buyer's wallet with zero ETH left over
    // for step 2's own gas cost, guaranteeing "insufficient funds for gas"
    // every time. Same-chain has no delivery step, but this total is still
    // the honest "you need at least this much in your wallet" figure to show
    // the buyer before they sign. See lib/chains/evm.ts's
    // estimateBuyCallTotalCostWei for the 1.5x safety margin reasoning.
    const totalCostWei = await estimateBuyCallTotalCostWei(call, input.destAddress, relayDestChainId);

    // Same-chain: no Relay leg exists to attach a fee to at all (see
    // STATE.md 2026-07-21 and PLAN.md's queued fee-model note) — deliberate
    // decision to charge nothing extra here, since we're not providing any
    // cross-chain value in this path. The buyer pays exactly totalCostWei,
    // no markup. USD volume for points still needs a price, which Relay
    // would normally supply — lib/pricing.ts's getEthUsdPrice() fills that
    // gap the same way getSolUsdPrice() already does for same-chain Solana
    // token swaps in app/api/bridge/confirm.
    if (isSolanaOrigin && !session.solanaPubkey) {
      // isSolanaOrigin was already validated against SOLANA_CHAIN_ID above,
      // so reaching here without a Solana session means an EVM-only session
      // (migration 0008_evm_standalone_signin.sql) tried to pay from
      // Solana without ever connecting a Solana wallet.
      return NextResponse.json({ error: "Paying from Solana requires a Solana wallet — sign in with Solana to continue." }, { status: 400 });
    }

    const rq = isSameChain
      ? null
      : await getRelayCallQuote({
          originChainId: input.originChainId,
          originCurrency: input.originCurrency,
          userOriginAddress: isSolanaOrigin ? session.solanaPubkey! : input.sourceAddress!,
          destChainId: relayDestChainId,
          destCurrency: RELAY_NATIVE_EVM_SENTINEL,
          destAmount: totalCostWei,
          recipient: input.destAddress,
        });

    const originAmount = rq ? rq.originAmount : totalCostWei;
    const originAmountUsd = rq ? rq.originAmountUsd : weiToUsd(totalCostWei, await getEthUsdPrice()).toString();
    const originCurrencySymbol = rq
      ? (rq.quote as { details?: { currencyIn?: { currency?: { symbol?: string } } } })?.details?.currencyIn?.currency?.symbol
      : "ETH";
    // Relay already formats its own currencyIn to the right decimals for
    // whatever origin currency/chain it is (SOL is 9 decimals, not 18) — a
    // flat /1e18 here would be wrong for that case. Same-chain always means
    // wei (18 decimals), since it's ETH-only (validated above).
    const originAmountFormatted = rq ? rq.originAmountFormatted : (Number(originAmount) / 1e18).toString();

    const db = supabaseAdmin();
    const { data: quoteRow, error } = await db
      .from("nft_purchase_quotes")
      .insert({
        user_id: session.userId,
        vendor: "opensea",
        chain_family: "evm",
        collection_slug: input.collectionSlug,
        token_id: input.tokenId,
        listing_price: (Number(listingPriceWei) / 1e18).toString(),
        listing_currency: "ETH",
        origin_chain_id: input.originChainId,
        origin_currency: input.originCurrency,
        dest_address: input.destAddress,
        relay_quote: rq?.quote ?? null,
        origin_amount: originAmount,
        origin_amount_usd: originAmountUsd,
        order_hash: input.orderHash,
        chain_slug: input.chainSlug,
        protocol_address: input.protocolAddress,
        expires_at: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      })
      .select("id, expires_at")
      .single();
    if (error || !quoteRow) throw new Error(error?.message ?? "Failed to persist NFT purchase quote");

    return NextResponse.json({
      quoteId: quoteRow.id,
      expiresAt: quoteRow.expires_at,
      sameChain: isSameChain,
      listingPriceEth: (Number(listingPriceWei) / 1e18).toString(),
      originAmountFormatted,
      originAmountUsd,
      originCurrencySymbol,
    });
  } catch (err) {
    if (err instanceof OpenSeaListingUnavailableError) {
      return NextResponse.json({ error: "This listing is no longer available." }, { status: 409 });
    }
    return safeErrorResponse("nft/purchase/quote", err, 502);
  }
}
