// Games Hub content-as-code (2026-08-07) — same pattern as lib/content/faq.ts
// (a typed array, edited via a commit) rather than a live admin CRUD UI.
// This app has zero admin panel, role system, or file-upload capability
// today (confirmed via a full research pass before building this) — a real
// admin UI is real, separate scope for if/when outside communities start
// submitting games at volume, not needed to ship one game.
export interface GameMeta {
  slug: string;
  name: string;
  developer: string;
  description: string;
  gameplay?: string;
  controls?: string;
  genre: string;
  category: "token" | "nft-collection" | "community";
  coverImage: string;
  bannerImage?: string;
  screenshots?: string[];
  playUrl: string;
  // Explicit, per-game, verified by hand (checked the game's own response
  // headers) — NEVER runtime-detected. A blocked iframe doesn't reliably
  // fire a JS error, so there's no safe way to infer this automatically;
  // getting it wrong would mean either a silently-broken embed or an
  // unnecessary redirect for a game that would have embedded fine.
  embeddable: boolean;
  nftCollection?: { vendor: "magiceden" | "opensea" | "tradeport"; slug: string };
  tokenMint?: string;
  website?: string;
  twitterUsername?: string;
  discordUrl?: string;
  telegramUrl?: string;
  addedDate: string;
}

export const GAMES: GameMeta[] = [
  {
    slug: "crash-dummy",
    name: "Crash Dummy",
    developer: "Degen_Bald_Boy",
    description: "Launch the dummy, glide, and chase the record. A Claynosaurz fan game.",
    genre: "Launcher / Physics Arcade",
    category: "community",
    // Real og:image from crash-dummy.xyz's own <head> (confirmed live,
    // 1200x630, resolves 200) — not a guessed or invented cover.
    coverImage: "https://crash-dummy.xyz/og.jpg",
    bannerImage: "https://crash-dummy.xyz/og.jpg",
    playUrl: "https://crash-dummy.xyz/",
    // Confirmed live 2026-08-07 via `curl -sI https://crash-dummy.xyz/`:
    // `x-frame-options: SAMEORIGIN` — the game's own host blocks framing
    // from any other origin, so this launches externally instead of a
    // broken/blank embed. Revisit once/if the game's own hosting adds a
    // `Content-Security-Policy: frame-ancestors https://blockchains.click`
    // allowlist entry.
    embeddable: false,
    twitterUsername: "Degen_Bald_Boy",
    addedDate: "2026-08-07",
  },
];

export function getAllGames(): GameMeta[] {
  return GAMES;
}

export function getGame(slug: string): GameMeta | undefined {
  return GAMES.find((g) => g.slug === slug);
}
