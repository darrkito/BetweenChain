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
  // Real collections this game's community/IP is connected to (2026-08-07,
  // ownership display — see app/components/GameCollectionOwnership.tsx).
  // `chain` picks which connected wallet (Solana vs Sui) to check ownership
  // against — a game can reference collections on more than one chain, e.g.
  // Claynosaurz's own Solana collections plus a Sui spinoff.
  nftCollections?: Array<{ vendor: "magiceden" | "opensea" | "tradeport"; slug: string; chain: "solana" | "sui" | "evm" }>;
  tokenMint?: string;
  website?: string;
  twitterUsername?: string;
  discordUrl?: string;
  telegramUrl?: string;
  // Added 2026-08-08 (Doggy Racing Chart) — `developer` stays a plain
  // display string (works for a single credited dev/studio, e.g. Crash
  // Dummy's), but a game can have more than one dev with their own X
  // account each; kept separate from `twitterUsername` (the game/project's
  // own account) and from `developer` (display text) rather than
  // overloading either.
  developerTwitterUsernames?: string[];
  // A separate "built with/powered by" credit (e.g. an indie tools/engine
  // builder) — distinct from the dev credit above.
  poweredByTwitterUsername?: string;
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
    // Confirmed live 2026-08-07 (all three resolve on this app's own
    // /nft/[vendor]/[slug] routes): Claynosaurz + Saga on Solana/Magic
    // Eden, Popkins on Sui/Tradeport — the Claynosaurz universe this fan
    // game is set in.
    nftCollections: [
      { vendor: "magiceden", slug: "claynosaurz", chain: "solana" },
      { vendor: "magiceden", slug: "saga", chain: "solana" },
      {
        vendor: "tradeport",
        slug: "0xb908f3c6fea6865d32e2048c520cdfe3b5c5bbcebb658117c41bad70f52b7ccc::popkins_nft::Popkins",
        chain: "sui",
      },
    ],
    twitterUsername: "Degen_Bald_Boy",
    addedDate: "2026-08-07",
  },
  {
    slug: "doggy-racing-chart",
    name: "Doggy Racing Chart",
    developer: "adriansanpei & isracryptoeth",
    description: "Ride motocross on real memecoin price charts. Survive the pumps, conquer the dumps — do backflips on DOGGY, race through BONK crashes. Built on real Solana price data.",
    gameplay: "Motocross meets crypto: your bike's terrain is generated live from a memecoin's actual price chart, so every run is different depending on what the market is doing.",
    genre: "Motocross / Endless Runner",
    category: "token",
    // Real og:image from racing.eldoggy.com's own <head> (confirmed live,
    // 1200x628, resolves 200) — same discipline as Crash Dummy's coverImage.
    coverImage: "https://racing.eldoggy.com/share-card.png",
    bannerImage: "https://racing.eldoggy.com/share-card.png",
    playUrl: "https://racing.eldoggy.com/",
    // Confirmed live 2026-08-08 via `curl -sI https://racing.eldoggy.com/`:
    // no x-frame-options or content-security-policy header at all — nothing
    // blocks framing from another origin, unlike Crash Dummy.
    embeddable: true,
    // $DOGGY — confirmed live via Jupiter's token search (exact mint match):
    // symbol DOGGY, real liquidity (~$17.5k) and holder count (1,487+),
    // isVerified: true, and its own listed X account
    // (https://x.com/elholder__) matches the "powered by" credit given —
    // real cross-confirmation, not just taken on trust.
    tokenMint: "BS7HxRitaY5ipGfbek1nmatWLbaS9yoWRSEQzCb3pump",
    twitterUsername: "soyeldoggy",
    discordUrl: "https://discord.gg/cJfja9XZ23",
    developerTwitterUsernames: ["adriansanpei", "isracryptoeth"],
    poweredByTwitterUsername: "elholder__",
    addedDate: "2026-08-08",
  },
];

export function getAllGames(): GameMeta[] {
  return GAMES;
}

export function getGame(slug: string): GameMeta | undefined {
  return GAMES.find((g) => g.slug === slug);
}
