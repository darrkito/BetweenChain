// Site-wide X (Twitter) link (2026-08-07) — used by both AppHeader.tsx and
// Footer.tsx, one source of truth rather than duplicating the SVG/href/
// caveat in both places.
//
// The handle was provided directly by the user as their own account
// (first-party information — a different trust bar than an external
// audit's claim about a third party) — could NOT be independently
// confirmed live this session: X blocks unauthenticated scraping (402 on
// a direct fetch) and the account is too new/small to be web-search
// indexed. Not fabricated, just not independently re-verified.
export const SITE_X_URL = "https://x.com/blocksdotclick";
export const SITE_X_HANDLE = "@blocksdotclick";

export function SocialXLink({ className }: { className?: string }) {
  return (
    <a
      href={SITE_X_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Blockchains.Click on X"
      title={SITE_X_HANDLE}
      className={className}
    >
      <svg width="16" height="16" viewBox="0 0 1200 1227" fill="currentColor" aria-hidden="true">
        <path d="M714.2 519.3 1160.9 0H1055.6L667.1 450.9 356.7 0H0l468.5 681.8L0 1226.4h105.3l410.9-477.7 328.1 477.7H1200L714.2 519.3ZM569.9 686.9l-47.6-68.1L142.4 79.7h161.6L611.4 526.2l47.6 68.1 400.2 572.7H897.5L569.9 686.9Z" />
      </svg>
    </a>
  );
}
