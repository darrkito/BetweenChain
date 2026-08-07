import type { NftCollection } from "@/lib/nft/types";

// Only http(s) — rejects javascript:/data: etc (same protocol-allowlist
// principle the audit's own security checklist called for). Vendor social
// fields are read-only API data (never user-editable in this app), but
// sanitizing before rendering an href costs nothing and closes the
// injection class outright rather than trusting the upstream vendor.
function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

interface SocialLink {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const ICON_PROPS = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;

function GlobeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.93 9h-3.05a15.4 15.4 0 0 0-1.2-5.6A8.02 8.02 0 0 1 19.93 11ZM12 4.06c.9 1.2 1.86 3.3 2.15 6.94H9.85c.29-3.64 1.25-5.74 2.15-6.94ZM9.85 13h4.3c-.29 3.64-1.25 5.74-2.15 6.94-.9-1.2-1.86-3.3-2.15-6.94Zm-2.02-2H4.07a8.02 8.02 0 0 1 4.25-5.6A15.4 15.4 0 0 0 7.17 11ZM4.07 13h3.1a15.4 15.4 0 0 0 1.2 5.6A8.02 8.02 0 0 1 4.07 13Zm11.6 5.6a15.4 15.4 0 0 0 1.2-5.6h3.06a8.02 8.02 0 0 1-4.26 5.6Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg {...ICON_PROPS} viewBox="0 0 1200 1227">
      <path d="M714.2 519.3 1160.9 0H1055.6L667.1 450.9 356.7 0H0l468.5 681.8L0 1226.4h105.3l410.9-477.7 328.1 477.7H1200L714.2 519.3ZM569.9 686.9l-47.6-68.1L142.4 79.7h161.6L611.4 526.2l47.6 68.1 400.2 572.7H897.5L569.9 686.9Z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M20.3 4.6a19.6 19.6 0 0 0-4.8-1.5l-.24.44a17.5 17.5 0 0 1 4.3 1.4 18.9 18.9 0 0 0-16.1 0 17.5 17.5 0 0 1 4.3-1.4l-.24-.44a19.6 19.6 0 0 0-4.8 1.5C.9 8.4.1 12 .4 15.6a19.7 19.7 0 0 0 5.9 3l.9-1.5a12.7 12.7 0 0 1-1.9-.9c.16-.1.32-.24.47-.36a14 14 0 0 0 12.6 0c.15.12.31.25.47.37-.6.35-1.24.65-1.9.9l.9 1.5a19.7 19.7 0 0 0 5.9-3c.4-4.2-.7-7.8-3.4-11ZM8.5 13.7c-.9 0-1.7-.84-1.7-1.87s.75-1.87 1.7-1.87 1.72.85 1.7 1.87c0 1.03-.75 1.87-1.7 1.87Zm7 0c-.9 0-1.7-.84-1.7-1.87s.75-1.87 1.7-1.87 1.72.85 1.7 1.87c0 1.03-.74 1.87-1.7 1.87Z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M21.9 4.3 18.6 20c-.25 1.1-.9 1.38-1.83.86l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.02.5l.36-5.13L18 6.5c.4-.36-.09-.56-.62-.2L6.3 13.4l-4.98-1.56c-1.08-.34-1.1-1.08.23-1.6L20.5 3.4c.9-.34 1.7.2 1.4 1z" />
    </svg>
  );
}

export function socialLinks(collection: {
  externalUrl?: string;
  twitterUsername?: string;
  discordUrl?: string;
  telegramUrl?: string;
}): SocialLink[] {
  const links: SocialLink[] = [];

  if (collection.externalUrl) {
    const url = sanitizeUrl(collection.externalUrl);
    if (url) links.push({ href: url, label: "Official website", icon: <GlobeIcon /> });
  }
  if (collection.twitterUsername) {
    const url = sanitizeUrl(`https://x.com/${collection.twitterUsername}`);
    if (url) links.push({ href: url, label: "X (Twitter)", icon: <XIcon /> });
  }
  if (collection.discordUrl) {
    const url = sanitizeUrl(collection.discordUrl);
    if (url) links.push({ href: url, label: "Discord", icon: <DiscordIcon /> });
  }
  if (collection.telegramUrl) {
    const url = sanitizeUrl(collection.telegramUrl);
    if (url) links.push({ href: url, label: "Telegram", icon: <TelegramIcon /> });
  }

  return links;
}

// Official collection links, sourced directly from the vendor's own API
// response (OpenSea project_url/twitter_username/discord_url/telegram_url,
// Tradeport website/twitter/discord) — never user-editable, so there's no
// "restrict editing to admins" concern the original audit's checklist
// raised (nothing here can be edited at all). Deliberately no `nofollow`:
// these are the collection's real, vendor-verified official links, not
// user-generated content — nofollowing them would work against the
// nftCollectionBrandSchema `sameAs` assertion right below it (see
// lib/seo/jsonld.tsx), which is asserting the opposite.
export function CollectionSocialsBar({ collection }: { collection: NftCollection }) {
  const links = socialLinks(collection);
  if (links.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={link.label}
          title={link.label}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-surface text-ink-muted transition-all hover:border-accent/40 hover:text-accent"
        >
          {link.icon}
        </a>
      ))}
    </div>
  );
}
