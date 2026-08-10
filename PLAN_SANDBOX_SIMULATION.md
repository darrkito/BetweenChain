# Pre-Flight Sandbox Simulation Engine — research (2026-08-10)

**Update 2026-08-10, later same day**: the two "build now" items in the
recommended v1 scope below are shipped. Solana: `lib/client/simulateSolanaTx.ts`
+ wired into `app/swap/SwapPageClient.tsx`'s `runSwap()` — simulates the real
built transaction before requesting a signature, blocks with a clear error on
a simulation `err` (catches a doomed tx before wasting a wallet popup), and
surfaces the real expected destination-token amount. Live-verified against a
real Jupiter-built swap transaction (0.01 SOL → USDC): simulated delta matched
the real on-chain result exactly (WSOL account closing to 0, +0.758788 USDC
received). EVM: `lib/goplus/security.ts`'s `TokenSecurityFlags` gained
`isOpenSource` — turned out to be a field GoPlus's existing token_security
response (already fetched for Burner Shield) was returning all along and just
not being read, so this needed zero new API calls. Surfaced in
`app/burner-shield/BurnerShieldClient.tsx` and folded into its risk flag.
Full EVM multi-call bundle preview (item 3) is still not built — still needs
the Tenderly-paid-plan-vs-self-hosted-Anvil decision below.

Pitch: preview token balance changes, slippage, gas, and hidden risks (transfer
taxes, unverified contracts) for a multi-step tx sequence before the user signs
anything. Pitched as "client-side WASM fork (Anvil)" — that specific framing
does not hold up under research; a real, buildable version does, just not the
way the pitch describes it.

## Reality check on "client-side WASM fork"

A full EVM state fork needs live access to every storage slot/account a
transaction might touch — that's a stream of JSON-RPC calls to a real node
regardless of where the *interpreter* runs. Running the interpreter in-browser
(revm-wasm, ethereumjs-vm) does not remove the network dependency, it just
moves compute to a slower runtime while still hitting the same RPC per state
read. There is no real "offline, fully local" fork — "client-side WASM
simulation" is marketing framing, not an architecture with a genuine
advantage over calling a simulation RPC directly. Treat any future pitch that
leans on "runs entirely in the browser" as a claim to verify, not a given.

## What's real, per chain

**Solana — buildable now, free, no new infra.** `simulateTransaction` is a
standard JSON-RPC method on any RPC (confirmed live via docs: works against
public/free RPC, no key required beyond what we already have — the dedicated
Helius RPC already configured in `.env.local`). Returns real `preTokenBalances`
/`postTokenBalances`, `preBalances`/`postBalances`, and fully parsed
`innerInstructions` for multi-instruction transactions (CPI included) — this
covers a bundled approve→swap→deposit sequence natively since Solana
transactions are already atomic multi-instruction by construction. This is a
straight win: build the real transaction client-side exactly as it will be
signed, simulate it, show the real resulting balances, THEN request the
signature. No new vendor, no new cost, no custody question at all (read-only).

**EVM — two honest paths, both free, differ in effort:**
- **Cheap now, single-step only**: this app already has the core technique —
  `lib/chains/evm.ts`'s `estimateBuyCallTotalCostWei` does `eth_estimateGas`
  with a `stateOverride` (fake balance) against a plain public RPC, no paid
  API. The same pattern (`eth_call` with state overrides) can simulate ONE
  call's balance delta for free today. Doesn't natively chain a sequence
  (approve → swap → deposit) into one atomic preview the way Solana's native
  multi-instruction tx does.
- **Real bundle preview needs a bundle-capable simulator.** Checked the two
  obvious vendors live, both are dead ends as originally assumed:
  - **Alchemy Simulate API** (`simulateAssetChangesBundle`) — bundle
    simulation is gated to paid Growth/Enterprise tiers (free tier gets
    single-tx simulation only), AND **Alchemy is deprecating its entire
    Transaction Simulation API line on 2026-09-30** — do not build on it,
    it will stop existing within weeks of shipping.
  - **Tenderly Simulate API** — self-serve signup with no credit card, but
    **API access itself requires a paid plan** (confirmed: "no API access on
    the Free tier"). Real, capable, supports bundled sequential simulation
    with full asset-change/gas/event output — but this is a real recurring
    cost, a business decision, not something to provision unattended.
  - **No free/self-serve vendor found that does atomic multi-call EVM
    simulation with balance-change output.**
  - **Third option, not a vendor**: self-host an ephemeral Foundry **Anvil**
    fork on demand (`anvil --fork-url <rpc>`) — this is the literal tool the
    pitch named, it's free/open-source, and it natively exposes
    `debug_traceCall`/full state simulation even when the upstream public RPC
    has those namespaces disabled. This machine's toolchain wasn't checked
    for Foundry — the more relevant fit is the **Vercel Sandbox** capability
    already available to this account (ephemeral Firecracker microVMs for
    running arbitrary processes) — spin up Anvil inside a Sandbox per
    simulation request, run the approve→swap→deposit sequence against the
    fork, read back real balances, tear the sandbox down. No vendor lock, no
    recurring per-call cost (Sandbox is compute-time billed), no custody or
    contract-deployment implication (the fork is ephemeral and never
    touches mainnet). Not yet spiked live — real next step before committing
    to this path.

## Adjacent capability already shipped (don't rebuild)

- **Honeypot / transfer-tax / mintable / owner-drain detection**: already
  live in Burner Shield (`lib/goplus/security.ts`, GoPlus Security's free
  keyless API) — the "hidden transfer taxes" part of this pitch is already a
  solved, shipped problem. A sandbox panel should call the same module, not
  reinvent token-risk scoring.
- **Slippage / price-impact / route detail**: already live in Route Auditor
  (shipped in the route-quality batch after the safety batch) — the
  "Slippage Tolerance"/"Max Price Impact" fields in the pitch's mockup are
  already a real, shipped UI surface. A sandbox panel composes with this,
  doesn't replace it.
- So the actual NET-NEW piece this pitch adds is narrower than it first
  reads: **exact post-execution token balances for a bundled multi-step
  sequence**, specifically for EVM (Solana already gets this for free via
  `simulateTransaction`). Contract-verification status (Etherscan/Sourcify
  "is this contract verified") is also net-new and trivial — a single free
  keyless API call per address.

## Custody / contract-deployment check

Entirely read-only across every option above — no private key ever touches
this app's backend for this feature, no signature is requested until AFTER
the preview, and nothing is deployed on any chain (Anvil-in-Sandbox forks are
ephemeral and local to the simulation, never broadcast). Fits the "no
custody, no smart contract" constraint cleanly regardless of which EVM path
is chosen.

## Recommended v1 scope

1. **Solana: build now.** Simulate the real transaction via
   `simulateTransaction` before requesting a signature, surface
   preToken→postToken balance deltas in the existing swap review UI.
2. **EVM, cheap slice: build now.** Contract-verification check (free,
   keyless) + reuse GoPlus (already shipped) + reuse Route Auditor (already
   shipped) + single-call balance delta via the existing `stateOverride`
   technique. This alone covers most of the pitch's stated user value
   ("hidden transfer taxes, unverified target contracts, high slippage")
   without any new vendor relationship.
3. **EVM, full bundle preview: needs one more decision before building.**
   Either (a) approve a recurring Tenderly paid plan, or (b) let me spike the
   Vercel-Sandbox-hosted-Anvil approach live to confirm it's actually
   workable before committing engineering time to it. Recommend (b) — it's
   free to try and keeps this feature in the same "no paid third-party
   dependency" posture as the rest of the safety/discovery batch.

Not built yet — this is the research/plan doc only, matching this project's
established discipline (`PLAN_SAFETY_DISCOVERY_FEATURES.md`) of verifying
infra live before writing feature code against it.
