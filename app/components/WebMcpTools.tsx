"use client";

import { useEffect } from "react";

// WebMCP (agent-discoverability pass, 2026-08-25; corrected same day after
// re-scanning) — Chrome shipped this experimentally as
// `navigator.modelContext.provideContext()` in Chrome 146 (Feb 2026); Chrome
// 150 later added `document.modelContext` as the primary surface with
// `registerTool()`/`unregisterTool()` for incremental per-tool management,
// but kept `navigator.modelContext` (and `provideContext`) working as the
// real, still-primary way most sites register a static tool set — this is
// NOT a deprecated alias, it's the one actually referenced across Chrome's
// own docs, the spec authors' own writing, and (confirmed live) what a
// third-party agent-readiness scanner checks for. The first version of this
// file used `document.modelContext.registerTool()` exclusively, which is
// real but apparently not what gets detected — switched to `provideContext`
// as primary, which also happens to be the more appropriate method for our
// case: all three tools are static and known upfront, not something that
// needs incremental registration as app state changes.
//
// Feature-detected the same way as app/components/PushNotificationToggle.tsx's
// `"serviceWorker" in navigator` check: `"modelContext" in navigator`, checked
// in an effect, no-op on any browser without it (Firefox, Safari, non-Chrome).
// Registered once, app-wide, in app/providers.tsx — bulk-set-once via
// provideContext needs no per-tool cleanup/unregister the way registerTool's
// AbortController pattern did, since this is a static set for the app's
// entire lifetime.
//
// Deliberately mirrors three of the read-only tools already exposed over the
// real MCP server (app/api/mcp/route.ts) — get_chains, get_token_price, and
// get_swap_quote_preview — calling the exact same public REST endpoints
// those tools wrap, not new logic. No execution tool exists here either, for
// the same reason stated in public/auth.md: swap execution needs a real
// wallet signature that no browser-agent tool call can substitute for.
export function WebMcpTools() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("modelContext" in navigator)) return;

    const modelContext = (navigator as unknown as { modelContext: WebMcpModelContext }).modelContext;

    modelContext
      .provideContext({
        tools: [
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
        ],
      })
      .catch(() => {});
  }, []);

  return null;
}

// Minimal local typing for the draft WebMCP API — no @types package exists
// for it yet (experimental, unshipped spec).
interface WebMcpTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool inputs vary per tool; each execute callback narrows its own param type
  execute: (input: any) => Promise<unknown>;
}
interface WebMcpModelContext {
  provideContext: (options: { tools: WebMcpTool[] }) => Promise<void>;
}
