"use client";

import { useEffect } from "react";

// WebMCP (agent-discoverability pass, 2026-08-25) — a real, current W3C
// Community Group draft (webmachinelearning.github.io/webmcp/, 2026-08-19
// revision): `document.modelContext.registerTool(tool, { signal })`, an
// experimental Chrome-only browser API letting an in-page AI agent (e.g. a
// browser's built-in assistant) discover and call page-level JS tools
// directly, no network hop. NOT `navigator.modelContext.provideContext()` —
// that name is stale/incorrect (came from a third-party scanner's own
// out-of-date copy).
//
// Feature-detected exactly like app/components/PushNotificationToggle.tsx's
// own `"serviceWorker" in navigator` check: `"modelContext" in document`,
// checked in an effect, no-op on any browser without it (Firefox, Safari,
// non-Chrome). Registered once, app-wide, in app/providers.tsx — these three
// tools take fully explicit arguments (no implicit "current page state"), so
// they don't need to be scoped to any specific page. Cleanup is registerTool's
// own documented pattern: pass an AbortController's signal, abort() it to
// unregister — there is no separate unregister() method.
//
// Deliberately mirrors three of the read-only tools already exposed over the
// real MCP server (app/api/mcp/route.ts) — get_chains, get_token_price, and
// get_swap_quote_preview — calling the exact same public REST endpoints
// those tools wrap, not new logic. No execution tool exists here either, for
// the same reason stated in public/auth.md: swap execution needs a real
// wallet signature that no browser-agent tool call can substitute for.
export function WebMcpTools() {
  useEffect(() => {
    if (typeof document === "undefined" || !("modelContext" in document)) return;

    const controller = new AbortController();
    const modelContext = (document as unknown as { modelContext: WebMcpModelContext }).modelContext;

    modelContext
      .registerTool(
        {
          name: "get_chains",
          description: "List the blockchains Blockchains.Click supports for cross-chain swaps.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true },
          execute: async () => {
            const res = await fetch("/api/tokens/chains");
            return res.json();
          },
        },
        { signal: controller.signal },
      )
      .catch(() => {});

    modelContext
      .registerTool(
        {
          name: "get_token_price",
          description: "Get the current USD price for native SOL, native SUI, or an EVM native/ERC-20 token.",
          inputSchema: {
            type: "object",
            properties: {
              symbol: { type: "string", enum: ["sol", "sui"], description: "Set to get native SOL or SUI price" },
              chainId: { type: "integer", description: "EVM chain id — pass with `address` for an EVM token price" },
              address: { type: "string", description: "EVM token contract address" },
            },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: async (input: { symbol?: "sol" | "sui"; chainId?: number; address?: string }) => {
            if (input.symbol === "sui") {
              const res = await fetch("/api/tokens/price?symbol=sui");
              return res.json();
            }
            if (input.chainId != null && input.address) {
              const res = await fetch(`/api/tokens/evm-price?chainId=${input.chainId}&address=${encodeURIComponent(input.address)}`);
              return res.json();
            }
            const res = await fetch("/api/tokens/price");
            return res.json();
          },
        },
        { signal: controller.signal },
      )
      .catch(() => {});

    modelContext
      .registerTool(
        {
          name: "get_swap_quote_preview",
          description:
            "Preview how much a swap would yield on Solana and/or EVM chains. PRICE PREVIEW ONLY: creates nothing and cannot execute a trade. Executing a swap requires a connected wallet signature on this site.",
          inputSchema: {
            type: "object",
            properties: {
              sourceChainId: { type: "integer", description: "Origin chain id" },
              sourceMint: { type: "string", description: "Origin token mint (Solana) or contract address (EVM)" },
              sourceAmount: { type: "string", description: "Origin amount in the token's smallest atomic unit, as a digit string" },
              destChainId: { type: "integer", description: "Destination chain id" },
              destToken: { type: "string", description: 'Destination token mint/address, or "SOL" for native Solana' },
              destDecimals: { type: "integer", description: "Only needed for a non-native Solana destination token" },
            },
            required: ["sourceChainId", "sourceMint", "sourceAmount", "destChainId", "destToken"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: async (input: {
            sourceChainId: number;
            sourceMint: string;
            sourceAmount: string;
            destChainId: number;
            destToken: string;
            destDecimals?: number;
          }) => {
            const params: Record<string, string> = {
              sourceChainId: String(input.sourceChainId),
              sourceMint: input.sourceMint,
              sourceAmount: input.sourceAmount,
              destChainId: String(input.destChainId),
              destToken: input.destToken,
            };
            if (input.destDecimals != null) params.destDecimals = String(input.destDecimals);
            const res = await fetch(`/api/quote/preview?${new URLSearchParams(params)}`);
            return res.json();
          },
        },
        { signal: controller.signal },
      )
      .catch(() => {});

    return () => controller.abort();
  }, []);

  return null;
}

// Minimal local typing for the draft WebMCP API — no @types package exists
// for it yet (experimental, unshipped spec).
interface WebMcpModelContext {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema?: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool inputs vary per tool; each execute callback narrows its own param type
      execute: (input: any) => Promise<unknown>;
    },
    options: { signal?: AbortSignal },
  ) => Promise<void>;
}
