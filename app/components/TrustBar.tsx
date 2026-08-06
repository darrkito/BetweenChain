// Text-only "powered by" trust signal (2026-08-06 UX audit pass) — no logo
// image files exist for Jupiter/Relay's own branding (only per-chain network
// icons are hosted, e.g. assets.relay.link/icons/{chainId}/light.png), so
// this deliberately renders as styled text badges, not images. Lists only
// the general swap-path partners actually wired into this app — confirmed
// against lib/chains/jupiter.ts and lib/chains/relay.ts, nothing aspirational
// (Wormhole/deBridge/Li.Fi/Pyth are NOT integrated). ChangeNOW is
// deliberately excluded — it's the Sui-only NFT-purchase leg, not part of
// the general swap path this bar represents.
const PARTNERS = ["Jupiter", "Relay"];

export function TrustBar() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
      <span>Powered by</span>
      {PARTNERS.map((name) => (
        <span key={name} className="rounded-full border border-hairline px-3 py-1 font-medium text-ink-muted">
          {name}
        </span>
      ))}
    </div>
  );
}
