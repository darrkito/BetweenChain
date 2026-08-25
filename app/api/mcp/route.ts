import { NextResponse } from "next/server";
import { createMcpHandler, McpServer, fromJsonSchema, type McpRequestContext } from "@modelcontextprotocol/server";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { getRelayChains } from "@/lib/chains/relayChains";
import { SWAP_CHAINS, BTC_CHAIN_ID, SUI_CHAIN_INFO } from "@/lib/chains/swapChains";
import { getTokenListForChain } from "@/lib/chains/tokenList";
import { getTrendingForChain } from "@/lib/chains/trending";
import { getSolUsdPrice, getSuiUsdPrice, getEvmNativeUsdPrice, getEvmTokenUsdPrices } from "@/lib/pricing";
import { RELAY_NATIVE_EVM_SENTINEL } from "@/lib/chains/relay";
import { getTokenSafety } from "@/lib/chains/rugcheck";
import { getJupiterTokenStats } from "@/lib/chains/jupiter";
import { NFT_VENDOR_CLIENTS, VENDOR_FOR_FAMILY, isTradeportChain, TRADEPORT_CHAINS } from "@/lib/nft/vendorClients";
import { applyNftImageOverride } from "@/lib/nft/imageOverrides";
import type { NftVendor, NftChainFamily } from "@/lib/nft/types";
import { getPlatformStats } from "@/lib/stats";
import { getAllBlogPosts, getBlogPost, getAllBlogPostsEs, getBlogPostEs } from "@/lib/content/blog";
import { GET as quotePreviewGet } from "@/app/api/quote/preview/route";
import { GET as btcQuotePreviewGet } from "@/app/api/quote/btc/preview/route";

// Real, working MCP server (agent-discoverability pass, 2026-08-25) — modeled
// directly on lemusweddings.com's own /api/mcp after live-inspecting its
// .well-known files (see public/.well-known/mcp/server-card.json's doc
// comment). Every tool below is a thin wrapper around the exact same
// public, unauthenticated, already-rate-limited lib functions the
// equivalent REST routes under app/api/tokens|quote|nft already call — no
// new business logic, no new capability. Deliberately excludes any
// swap/NFT-purchase EXECUTION path: those require a signed wallet
// transaction through the site's own UI and are never exposed to an
// autonomous agent (see public/auth.md).
export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_CHAIN_IDS = new Set<number>([...SWAP_CHAINS.map((c) => c.chainId), BTC_CHAIN_ID]);

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

// Mirrors lib/apiError.ts's safeErrorResponse discipline for MCP tool
// results: the SDK surfaces a thrown error's raw message to the client
// verbatim, so every tool catches its own errors and returns this instead —
// log the real error server-side, never leak internals to the caller.
function toolError(label: string, err: unknown) {
  console.error(`[mcp:${label}]`, err);
  return {
    content: [{ type: "text" as const, text: "Something went wrong fetching this data. Please try again." }],
    isError: true,
  };
}

// quote/preview and quote/btc/preview each contain ~100+ lines of routing
// logic (same-chain vs cross-chain, Jupiter vs Relay vs ChangeNOW) that
// would be risky and wasteful to re-implement here. Instead of an internal
// HTTP round-trip, this calls the route's own exported GET handler directly
// with a synthetic Request — same module, same validation, same caching,
// same error handling, zero duplicated logic. The original request's
// x-forwarded-for is forwarded so the wrapped route's own per-IP rate limit
// bucket lines up with whichever IP the MCP entrypoint already rate-limited.
async function callRoute(handler: (req: Request) => Promise<Response>, originalReq: Request | undefined, path: string, params: Record<string, string>) {
  const url = new URL(path, "http://internal.mcp");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const forwarded = new Request(url, {
    headers: originalReq?.headers.get("x-forwarded-for") ? { "x-forwarded-for": originalReq.headers.get("x-forwarded-for")! } : {},
  });
  const res = await handler(forwarded);
  return res.json();
}

// Schemas are plain JSON Schema, wrapped with the SDK's own fromJsonSchema
// (which validates at runtime via its bundled default validator — real
// input validation, not just documentation) instead of zod. This repo pins
// zod v3 everywhere else; the SDK's registerTool only accepts a
// StandardSchemaWithJSON, which only its own nested zod v4 dependency
// satisfies — rather than fight two incompatible zod major versions in one
// file, JSON Schema is the SDK's own supported dependency-free path.
interface GetTokensArgs {
  chainId: number;
  term?: string;
  trending?: boolean;
}
interface GetTokenPriceArgs {
  symbol?: "sol" | "sui";
  chainId?: number;
  address?: string;
}
interface GetTokenSafetyArgs {
  mint: string;
}
interface GetSwapQuotePreviewArgs {
  sourceChainId: number;
  sourceMint: string;
  sourceAmount: string;
  destChainId: number;
  destToken: string;
  destDecimals?: number;
  autoRefuel?: boolean;
}
interface GetBtcSuiQuotePreviewArgs {
  sourceCurrency: "btc" | "sol" | "eth" | "sui";
  sourceAmount: string;
  destCurrency: "btc" | "sol" | "eth" | "sui";
  sourceChainId?: number;
}
interface GetNftCollectionArgs {
  vendor: "magiceden" | "opensea" | "tradeport";
  slug: string;
  chain?: string;
}
interface BrowseNftCollectionsArgs {
  chainFamily: "solana" | "evm" | "move";
  chain?: string;
}
interface GetBlogPostsArgs {
  category?: string;
  chain?: string;
  lang?: string;
}
interface GetBlogPostDetailArgs {
  slug: string;
  lang?: string;
}

function buildServer(originalReq: Request | undefined) {
  const server = new McpServer({ name: "blockchains-click", version: "1.0.0" });

  server.registerTool(
    "get_chains",
    {
      description: "List the blockchains this app supports for cross-chain swaps (chain id, name, native currency).",
      inputSchema: fromJsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }),
    },
    async () => {
      try {
        const chains = (await getRelayChains()).filter((c) => ALLOWED_CHAIN_IDS.has(c.id));
        return ok({ chains: [...chains, SUI_CHAIN_INFO] });
      } catch (err) {
        return toolError("get_chains", err);
      }
    },
  );

  server.registerTool(
    "get_tokens",
    {
      description: "List tokens available to swap on a given chain, optionally filtered by a search term, or that chain's trending tokens.",
      inputSchema: fromJsonSchema<GetTokensArgs>({
        type: "object",
        properties: {
          chainId: { type: "integer", description: "Chain id, from get_chains" },
          term: { type: "string", description: "Search term to filter by token name/symbol" },
          trending: { type: "boolean", description: "Return trending tokens for this chain instead of the full list" },
        },
        required: ["chainId"],
        additionalProperties: false,
      }),
    },
    async ({ chainId, term, trending }) => {
      try {
        const tokens = trending ? await getTrendingForChain(chainId) : await getTokenListForChain(chainId, term);
        return ok({ tokens });
      } catch (err) {
        return toolError("get_tokens", err);
      }
    },
  );

  server.registerTool(
    "get_token_price",
    {
      description: "Get the current USD price for native SOL, native SUI, or an EVM native/ERC-20 token.",
      inputSchema: fromJsonSchema<GetTokenPriceArgs>({
        type: "object",
        properties: {
          symbol: { type: "string", enum: ["sol", "sui"], description: "Set to get native SOL or SUI price" },
          chainId: { type: "integer", description: "EVM chain id — pass with `address` for an EVM token price" },
          address: { type: "string", description: "EVM token contract address (or the chain's native sentinel address)" },
        },
        additionalProperties: false,
      }),
    },
    async ({ symbol, chainId, address }) => {
      try {
        if (symbol === "sui") return ok({ currency: "SUI", price: await getSuiUsdPrice() });
        if (chainId != null && address) {
          const isNative = address.toLowerCase() === RELAY_NATIVE_EVM_SENTINEL.toLowerCase();
          if (isNative) return ok({ currency: "native", chainId, price: await getEvmNativeUsdPrice(chainId) });
          const prices = await getEvmTokenUsdPrices(chainId, [address]);
          return ok({ currency: address, chainId, price: prices[address.toLowerCase()] ?? null });
        }
        return ok({ currency: "SOL", price: await getSolUsdPrice() });
      } catch (err) {
        return toolError("get_token_price", err);
      }
    },
  );

  server.registerTool(
    "get_token_safety",
    {
      description:
        "Get RugCheck safety data and Jupiter market stats for a Solana token mint. `safety` is null (never fabricated) when RugCheck has no report for the mint.",
      inputSchema: fromJsonSchema<GetTokenSafetyArgs>({
        type: "object",
        properties: { mint: { type: "string", description: "Solana token mint address" } },
        required: ["mint"],
        additionalProperties: false,
      }),
    },
    async ({ mint }) => {
      try {
        const [safety, stats] = await Promise.all([getTokenSafety(mint), getJupiterTokenStats(mint).catch(() => null)]);
        return ok({ safety, stats });
      } catch (err) {
        return toolError("get_token_safety", err);
      }
    },
  );

  server.registerTool(
    "get_swap_quote_preview",
    {
      description:
        'Preview how much a swap would yield on Solana and/or EVM chains (Jupiter/Relay routing). PRICE PREVIEW ONLY: creates nothing and cannot execute a trade. Executing a swap requires a connected wallet signature at https://blockchains.click.',
      inputSchema: fromJsonSchema<GetSwapQuotePreviewArgs>({
        type: "object",
        properties: {
          sourceChainId: { type: "integer", description: "Origin chain id, from get_chains" },
          sourceMint: { type: "string", description: "Origin token mint (Solana) or contract address (EVM)" },
          sourceAmount: { type: "string", pattern: "^\\d+$", description: "Origin amount in the token's smallest atomic unit, as a digit string" },
          destChainId: { type: "integer", description: "Destination chain id, from get_chains" },
          destToken: { type: "string", description: 'Destination token mint/address, or "SOL" for native Solana' },
          destDecimals: { type: "integer", minimum: 0, maximum: 18, description: "Only needed for a non-native Solana destination token" },
          autoRefuel: { type: "boolean", description: "Whether to include a small amount of destination-chain gas in the quote" },
        },
        required: ["sourceChainId", "sourceMint", "sourceAmount", "destChainId", "destToken"],
        additionalProperties: false,
      }),
    },
    async (input) => {
      try {
        const params: Record<string, string> = {
          sourceChainId: String(input.sourceChainId),
          sourceMint: input.sourceMint,
          sourceAmount: input.sourceAmount,
          destChainId: String(input.destChainId),
          destToken: input.destToken,
        };
        if (input.destDecimals != null) params.destDecimals = String(input.destDecimals);
        if (input.autoRefuel != null) params.autoRefuel = String(input.autoRefuel);
        return ok(await callRoute(quotePreviewGet, originalReq, "/api/quote/preview", params));
      } catch (err) {
        return toolError("get_swap_quote_preview", err);
      }
    },
  );

  server.registerTool(
    "get_btc_sui_quote_preview",
    {
      description:
        "Preview a swap involving Bitcoin (ChangeNOW routing) — BTC<->SOL, BTC<->ETH, BTC<->SUI, or any pair involving SUI from a non-Solana chain. PRICE PREVIEW ONLY: creates nothing and cannot execute a trade.",
      inputSchema: fromJsonSchema<GetBtcSuiQuotePreviewArgs>({
        type: "object",
        properties: {
          sourceCurrency: { type: "string", enum: ["btc", "sol", "eth", "sui"] },
          sourceAmount: { type: "string", pattern: "^\\d*\\.?\\d+$", description: 'Human-readable decimal amount, e.g. "0.05"' },
          destCurrency: { type: "string", enum: ["btc", "sol", "eth", "sui"] },
          sourceChainId: { type: "integer", description: "EVM chain id the source currency is coming from, if not mainnet Ethereum" },
        },
        required: ["sourceCurrency", "sourceAmount", "destCurrency"],
        additionalProperties: false,
      }),
    },
    async (input) => {
      try {
        const params: Record<string, string> = {
          sourceCurrency: input.sourceCurrency,
          sourceAmount: input.sourceAmount,
          destCurrency: input.destCurrency,
        };
        if (input.sourceChainId != null) params.sourceChainId = String(input.sourceChainId);
        return ok(await callRoute(btcQuotePreviewGet, originalReq, "/api/quote/btc/preview", params));
      } catch (err) {
        return toolError("get_btc_sui_quote_preview", err);
      }
    },
  );

  server.registerTool(
    "get_nft_collection",
    {
      description: "Get detail for a single NFT collection (floor, description, image) by vendor and slug.",
      inputSchema: fromJsonSchema<GetNftCollectionArgs>({
        type: "object",
        properties: {
          vendor: { type: "string", enum: ["magiceden", "opensea", "tradeport"], description: "NFT marketplace vendor for this collection" },
          slug: { type: "string", description: "Collection slug, as returned by browse_nft_collections" },
          chain: { type: "string", description: 'Tradeport chain (e.g. "sui", "aptos") — only meaningful for vendor "tradeport"' },
        },
        required: ["vendor", "slug"],
        additionalProperties: false,
      }),
    },
    async ({ vendor, slug, chain }) => {
      try {
        if (chain != null && !isTradeportChain(chain)) {
          return toolError("get_nft_collection", new Error(`chain must be one of: ${TRADEPORT_CHAINS.join(", ")}`));
        }
        const client = NFT_VENDOR_CLIENTS[vendor as NftVendor];
        const collection = await client.getCollection(slug, chain ?? "sui");
        if (!collection) return { content: [{ type: "text" as const, text: "Collection not found." }], isError: true };
        return ok({ collection: applyNftImageOverride(vendor as NftVendor, slug, collection) });
      } catch (err) {
        return toolError("get_nft_collection", err);
      }
    },
  );

  server.registerTool(
    "browse_nft_collections",
    {
      description: "Browse NFT collections available on a chain family (Solana, EVM, or a Move chain via Tradeport).",
      inputSchema: fromJsonSchema<BrowseNftCollectionsArgs>({
        type: "object",
        properties: {
          chainFamily: { type: "string", enum: ["solana", "evm", "move"] },
          chain: { type: "string", description: 'Required for chainFamily "move" — a Tradeport chain, e.g. "sui"' },
        },
        required: ["chainFamily"],
        additionalProperties: false,
      }),
    },
    async ({ chainFamily, chain }) => {
      try {
        if (chainFamily === "move" && (!chain || !isTradeportChain(chain))) {
          return toolError("browse_nft_collections", new Error(`chain query param must be one of: ${TRADEPORT_CHAINS.join(", ")}`));
        }
        const client = NFT_VENDOR_CLIENTS[VENDOR_FOR_FAMILY[chainFamily as NftChainFamily]];
        const collections = await client.browseCollections(chain);
        return ok({ collections });
      } catch (err) {
        return toolError("browse_nft_collections", err);
      }
    },
  );

  server.registerTool(
    "get_platform_stats",
    {
      description: "Get Blockchains.Click's real, aggregate platform stats: total completed transactions and total USD volume.",
      inputSchema: fromJsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }),
    },
    async () => {
      try {
        return ok(await getPlatformStats());
      } catch (err) {
        return toolError("get_platform_stats", err);
      }
    },
  );

  server.registerTool(
    "get_blog_posts",
    {
      description: "List Blockchains.Click's real blog posts — security write-ups, how-to swap guides, product deep-dives, NFT ecosystem coverage. Use this to find real content, not just product data. A Spanish subset is available via lang=\"es\" (fewer posts than English — only the ones actually translated).",
      inputSchema: fromJsonSchema<GetBlogPostsArgs>({
        type: "object",
        properties: {
          category: { type: "string", description: "Optional filter, e.g. Guides, Security, Product, NFTs, Games" },
          chain: { type: "string", description: "Optional filter by a SWAP_CHAINS slug this post covers, e.g. solana, sui" },
          lang: { type: "string", description: "Response language: \"en\" (default) or \"es\". Spanish only covers translated posts, a subset of English." },
        },
        additionalProperties: false,
      }),
    },
    async ({ category, chain, lang }) => {
      try {
        const isEs = lang === "es";
        const allPosts = isEs ? getAllBlogPostsEs() : getAllBlogPosts();
        const posts = allPosts
          .filter((p) => !category || p.category.toLowerCase() === category.toLowerCase())
          .filter((p) => !chain || (p.chains ?? []).map((c) => c.toLowerCase()).includes(chain.toLowerCase()))
          .map((p) => ({ slug: p.slug, title: p.title, description: p.description, category: p.category, date: p.date, url: `https://blockchains.click/${isEs ? "es/blog" : "blog"}/${p.slug}` }));
        return ok({ posts });
      } catch (err) {
        return toolError("get_blog_posts", err);
      }
    },
  );

  server.registerTool(
    "get_blog_post_detail",
    {
      description: "Get the full content of one Blockchains.Click blog post by slug. Pass lang=\"es\" for the Spanish slug of a translated post (not every post has one).",
      inputSchema: fromJsonSchema<GetBlogPostDetailArgs>({
        type: "object",
        properties: {
          slug: { type: "string", description: "Blog post slug, from get_blog_posts" },
          lang: { type: "string", description: "\"en\" (default) or \"es\" — must match the language the slug itself came from" },
        },
        required: ["slug"],
        additionalProperties: false,
      }),
    },
    async ({ slug, lang }) => {
      try {
        const post = lang === "es" ? getBlogPostEs(slug) : getBlogPost(slug);
        if (!post) return toolError("get_blog_post_detail", new Error(`Unknown blog post slug: ${slug}`));
        return ok({ slug: post.slug, title: post.title, description: post.description, category: post.category, content: post.content, faq: post.faq, date: post.date });
      } catch (err) {
        return toolError("get_blog_post_detail", err);
      }
    },
  );

  return server;
}

const handler = createMcpHandler((ctx: McpRequestContext) => buildServer(ctx.requestInfo));

export async function POST(req: Request) {
  const rl = await rateLimit(clientKey(req, "mcp"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  return handler.fetch(req);
}

// Browser-based agents issuing a JSON POST trigger a CORS preflight;
// Access-Control-Allow-Origin itself is set globally in next.config.ts for
// this path, alongside the other agent-facing .well-known surfaces.
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
