import { NextResponse } from "next/server";
import { getRelayChains } from "@/lib/chains/relayChains";
import { SWAP_CHAINS, BTC_CHAIN_ID, SUI_CHAIN_INFO } from "@/lib/chains/swapChains";
import { RELAY_FEE_BPS, JUPITER_FEE_BPS, RELAY_FEE_RECIPIENT, JUPITER_FEE_ACCOUNT } from "@/lib/fees";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// Rule-based A2A agent (agent-discoverability pass, 2026-08-25) — deliberately
// NOT LLM-backed. This app has no LLM API key anywhere, and wiring one up
// would put real per-request cost behind a public, unauthenticated endpoint.
// Instead this keyword-matches a fixed, small set of real intents, each
// answered from the exact same live data the MCP server (app/api/mcp/route.ts)
// already exposes — never a fabricated free-text answer. Anything unmatched
// gets an honest fallback pointing elsewhere, matching public/auth.md's
// "cite the source, don't fabricate" stance.
export const maxDuration = 20;

const ALLOWED_CHAIN_IDS = new Set<number>([...SWAP_CHAINS.map((c) => c.chainId), BTC_CHAIN_ID]);

interface A2ATextPart {
  kind?: string;
  text?: string;
}
interface A2AMessage {
  parts?: A2ATextPart[];
}

function extractText(message: A2AMessage | undefined): string {
  if (!message?.parts) return "";
  return message.parts
    .filter((p) => !p.kind || p.kind === "text")
    .map((p) => p.text ?? "")
    .join(" ")
    .trim();
}

function textMessage(text: string) {
  return {
    role: "agent",
    parts: [{ kind: "text", text }],
    kind: "message",
    messageId: crypto.randomUUID(),
  };
}

async function chainsAnswer(): Promise<string> {
  const chains = (await getRelayChains()).filter((c) => ALLOWED_CHAIN_IDS.has(c.id));
  const names = [...chains.map((c) => c.name), SUI_CHAIN_INFO.name, "Bitcoin"];
  return `Blockchains.Click supports cross-chain swaps across: ${names.join(", ")}. Full machine-readable list: https://blockchains.click/api/mcp (tool get_chains), or https://blockchains.click/.well-known/api-catalog.`;
}

function feesAnswer(): string {
  const relayActive = Boolean(RELAY_FEE_RECIPIENT);
  const jupiterActive = Boolean(JUPITER_FEE_ACCOUNT);
  if (!relayActive && !jupiterActive) {
    return "Blockchains.Click currently charges no platform fee on swaps — you only pay the underlying network/DEX gas. (Configured default rate, if enabled, is 0.25% per leg.) See https://blockchains.click/faq for the current, authoritative fee policy.";
  }
  const parts: string[] = [];
  if (relayActive) parts.push(`${(RELAY_FEE_BPS / 100).toFixed(2)}% on cross-chain (Relay) legs`);
  if (jupiterActive) parts.push(`${(JUPITER_FEE_BPS / 100).toFixed(2)}% on Solana (Jupiter) legs`);
  return `Blockchains.Click's platform fee: ${parts.join(", ")}, on top of normal network gas. See https://blockchains.click/faq for the current, authoritative fee policy.`;
}

function howToSwapAnswer(): string {
  return "To swap on Blockchains.Click: 1) go to https://blockchains.click/swap, 2) connect a wallet for your source chain, 3) pick your Sell and Buy tokens and an amount, 4) review the live quote preview, then confirm and sign in your wallet. There is no execution path available to agents directly — a real wallet signature from the person who owns the funds is always required.";
}

function nftAnswer(): string {
  return "Blockchains.Click's NFT marketplace aggregates listings across Magic Eden (Solana), OpenSea (EVM chains), and Tradeport (Sui/Aptos/Movement). Browse at https://blockchains.click/nft, or query collection/listing data programmatically via https://blockchains.click/api/mcp (tools get_nft_collection, browse_nft_collections).";
}

function fallbackAnswer(): string {
  return "I can answer questions about supported chains, fees, how to swap, and the NFT marketplace. For anything else, see https://blockchains.click/faq, the full site guide at https://blockchains.click/llms.txt, or query structured data directly via the MCP server at https://blockchains.click/api/mcp.";
}

async function answerFor(text: string): Promise<string> {
  const lower = text.toLowerCase();
  if (/\bnfts?\b/.test(lower)) return nftAnswer();
  if (/\b(fee|fees|cost|charge|charges)\b/.test(lower)) return feesAnswer();
  if (/\b(chain|chains|network|networks|support|supported)\b/.test(lower)) return chainsAnswer();
  if (/\b(how|start|swap|use|begin)\b/.test(lower)) return howToSwapAnswer();
  return fallbackAnswer();
}

export async function POST(req: Request) {
  const rl = await rateLimit(clientKey(req, "a2a"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { jsonrpc?: string; id?: string | number | null; method?: string; params?: { message?: A2AMessage } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  if (body.method !== "message/send") {
    return NextResponse.json(
      { jsonrpc: "2.0", id: body.id ?? null, error: { code: -32601, message: "Method not found — only message/send is supported (non-streaming, no auth)." } },
      { status: 400 },
    );
  }

  try {
    const text = extractText(body.params?.message);
    const answer = text ? await answerFor(text) : fallbackAnswer();
    return NextResponse.json({ jsonrpc: "2.0", id: body.id ?? null, result: textMessage(answer) });
  } catch (err) {
    return safeErrorResponse("a2a", err, 502);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
