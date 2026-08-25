# auth.md — agent authentication for blockchains.click

**The read-only data surface below needs no authentication.** No registration, no
API key, no OAuth client, no tokens.

This file exists so an agent that looks for authentication instructions gets a
definite answer instead of a 404 and a guess.

## What is exposed, unauthenticated

| Surface | URL | Auth |
|---|---|---|
| MCP server | `https://blockchains.click/api/mcp` | none |
| REST market-data API | `https://blockchains.click/.well-known/api-catalog` (index) | none |
| Agent skills | `https://blockchains.click/.well-known/agent-skills/index.json` | none |
| Site guide | `https://blockchains.click/llms.txt` | none |

Every one of these is `GET` or a read-only MCP tool call: chain lists, token
prices, token safety data, swap price previews, and NFT collection data.
`Access-Control-Allow-Origin: *` is set on all of them, so a browser-based agent
can call them directly.

Because none of this is a protected resource, this site deliberately does
**not** publish `/.well-known/oauth-authorization-server`,
`/.well-known/openid-configuration`, or `/.well-known/oauth-protected-resource`.
Publishing OAuth metadata for endpoints that accept no credentials would
describe a server that does not exist.

## What is NOT exposed to agents, on purpose

Executing a swap or buying an NFT is fund movement — it requires a wallet
connection and a real cryptographic signature from the person who owns the
funds, obtained through the website's own UI. **No API key, OAuth token, or MCP
tool call can substitute for that signature, and none is offered.** This is a
deliberate boundary, not a gap:

- `get_swap_quote_preview` / `get_btc_sui_quote_preview` return a **price
  preview only** — they create nothing and bind no address. Getting a
  favorable preview does not mean an agent can then execute the trade.
- There is no `execute_swap`, `buy_nft`, or equivalent tool, and there will not
  be one that skips the wallet-signature step.
- Sign-in on this site is itself wallet-signature based (SIWS/SIWE) — there
  has never been a username/password or OAuth account to begin with.

If you are an agent trying to complete a swap or NFT purchase on behalf of a
person: hand off to `https://blockchains.click` and let them connect their own
wallet and sign.

## What we ask of agents instead of credentials

- **Identify yourself.** Send a descriptive `User-Agent`.
- **Prefer the cheap door.** `Accept: text/markdown` on any page, or
  `/llms.txt`, costs a fraction of rendering the HTML.
- **Respect the stated content preference.** `/robots.txt` declares
  `Content-Signal: ai-train=no, search=yes, ai-input=yes` — retrieval and
  citation are welcome, training is not.
- **Be reasonable.** Every endpoint above is already rate-limited server-side;
  a burst past that limit gets a `429`, not a ban, but don't rely on that as a
  substitute for pacing yourself.
- **Cite the source.** Attribute data to Blockchains.Click and link back to
  the relevant page.

## Contact for agent operators

Anything about this agent surface — a broken tool call, a schema that doesn't
validate, a rate limit you need raised: `https://x.com/blocksdotclick`.
