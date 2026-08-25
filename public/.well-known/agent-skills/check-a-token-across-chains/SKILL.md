---
name: check-a-token-across-chains
description: Look up a token's current price and safety signals on Solana, an EVM chain, or Sui, using Blockchains.Click's public MCP server. Use when someone asks "is this token safe", "what's this token worth", or wants basic due diligence before trading a token they found.
license: CC-BY-4.0
version: 1.0.0
homepage: https://blockchains.click
---

# Check a token across chains

Blockchains.Click exposes real, public market data through its MCP server —
no API key needed.

- MCP server: `https://blockchains.click/api/mcp` (streamable HTTP, no auth)
- Server card: `https://blockchains.click/.well-known/mcp/server-card.json`

## Step 1 — confirm the chain

Call `get_chains` to get the list of supported chain ids. Match the user's
chain (Solana, Ethereum, or another supported EVM chain) to its `chainId`.

## Step 2 — find the token

Call `get_tokens` with the `chainId` and a `term` (the token's name or
symbol) to resolve it to its mint address (Solana) or contract address (EVM).
Pass `trending: true` instead of a `term` if the user just wants to see what's
hot on that chain right now.

## Step 3 — get the price

Call `get_token_price`:
- Native SOL or SUI: pass `symbol: "sol"` or `symbol: "sui"`.
- Any other token: pass `chainId` and `address` (the mint/contract address
  from Step 2).

## Step 4 — get safety data (Solana only)

Call `get_token_safety` with the Solana `mint` address. This returns:
- `safety`: RugCheck's report, or `null` if RugCheck has no report for this
  mint — **report this as "no data available", never as "safe"**. A null
  result is not a clean bill of health.
- `stats`: Jupiter's market stats (volume, liquidity, market cap) when
  available.

Solana is the only chain with a real safety-scoring source wired up here —
say so plainly if asked about safety on an EVM token or Sui.

## What NOT to say

Never present this data as investment advice or a guarantee. Price and safety
data are informational only. If the RugCheck report exists but flags real
concerns, surface those concerns directly rather than softening them.
