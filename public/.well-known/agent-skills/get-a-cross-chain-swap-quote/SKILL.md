---
name: get-a-cross-chain-swap-quote
description: Get a live price preview for swapping between Solana, EVM chains, and Bitcoin/Sui on Blockchains.Click, and hand off to the site for actual execution. Use when someone asks "how much would I get if I swap X for Y" or wants to compare a cross-chain swap before committing.
license: CC-BY-4.0
version: 1.0.0
homepage: https://blockchains.click
---

# Get a cross-chain swap quote

Blockchains.Click's MCP server can preview a swap's expected output — it
cannot execute one. Read `https://blockchains.click/auth.md` for why: actual
execution requires a real wallet signature that no API call can substitute
for.

- MCP server: `https://blockchains.click/api/mcp` (streamable HTTP, no auth)

## Step 1 — identify the chains and tokens

Call `get_chains` for supported chain ids, then `get_tokens` (with a `term`)
on each side to resolve the source and destination tokens to their
mint/contract addresses.

## Step 2 — pick the right preview tool

- **Both sides are Solana and/or an EVM chain** (no Bitcoin, no Sui):
  use `get_swap_quote_preview` with `sourceChainId`, `sourceMint`,
  `sourceAmount` (smallest atomic unit, e.g. lamports or wei, as a digit
  string), `destChainId`, `destToken`.
- **Either side is Bitcoin, or one side is Sui and the other isn't Solana**:
  use `get_btc_sui_quote_preview` instead, with `sourceCurrency`,
  `sourceAmount` (a human-readable decimal string, e.g. `"0.05"`),
  `destCurrency`. These take currency codes (`btc`, `sol`, `eth`, `sui`), not
  chain ids and mint addresses.

Both tools return `destAmountFormatted` and `destAmountUsd` (when a USD price
source exists for that token — some arbitrary SPL/ERC-20 tokens legitimately
come back with `destAmountUsd: null`, which is honest, not a bug).

## Step 3 — tell the user what this is and isn't

State clearly that this is a live price preview, not a locked-in quote and not
an executed trade. Prices move; the actual amount received when they execute
may differ slightly.

## Step 4 — hand off for execution

There is no tool that executes a swap. To actually do the trade, the user
needs to go to `https://blockchains.click/swap`, connect their own wallet, and
sign the transaction themselves. Never imply that calling these tools moved
any funds or that you can complete the swap on their behalf.
