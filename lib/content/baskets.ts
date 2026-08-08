// Portfolio Baskets content-as-code (2026-08-08) — same pattern as
// lib/content/games.ts/faq.ts: a typed array, edited via a commit, rather
// than a live admin CRUD UI (this app has no admin panel/role system, same
// reasoning games.ts's own doc gives). Every token below was live-verified
// (Relay's /currencies/v2 search for EVM, Jupiter's token search + a real
// price/liquidity check for Solana) before being hardcoded here — the
// pitch this feature came from named tickers, not addresses; addresses
// were resolved and confirmed live, not guessed.
export interface BasketAllocation {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  isNative: boolean;
  percentage: number; // allocations within a basket should sum to 100
}

export interface BasketMeta {
  slug: string;
  name: string;
  description: string;
  icon: string; // emoji, same lightweight-icon convention as GameMeta doesn't need — kept simple for a card grid
  allocations: BasketAllocation[];
  addedDate: string;
}

const BASE_CHAIN_ID = 8453;
const ETHEREUM_CHAIN_ID = 1;
const SOLANA_CHAIN_ID = 792703809;
const ROBINHOOD_CHAIN_ID = 4663;

export const BASKETS: BasketMeta[] = [
  {
    slug: "base-ecosystem-starter",
    name: "Base Ecosystem Starter",
    description: "Exposure to three of Base's most established community meme tokens in one swap, instead of three separate trades.",
    icon: "🔵",
    allocations: [
      {
        chainId: BASE_CHAIN_ID,
        address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
        symbol: "DEGEN",
        name: "Degen",
        decimals: 18,
        logoURI: "https://coin-images.coingecko.com/coins/images/34515/large/android-chrome-512x512.png?1706198225",
        isNative: false,
        percentage: 40,
      },
      {
        chainId: BASE_CHAIN_ID,
        address: "0x532f27101965dd16442e59d40670faf5ebb142e4",
        symbol: "BRETT",
        name: "Brett",
        decimals: 18,
        logoURI: "https://coin-images.coingecko.com/coins/images/35529/large/1000050750.png?1709031995",
        isNative: false,
        percentage: 30,
      },
      {
        chainId: BASE_CHAIN_ID,
        address: "0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4",
        symbol: "TOSHI",
        name: "Toshi",
        decimals: 18,
        logoURI: "https://coin-images.coingecko.com/coins/images/31126/large/Toshi_Logo_-_Circle_-_Toshi_Bg.png",
        isNative: false,
        percentage: 30,
      },
    ],
    addedDate: "2026-08-08",
  },
  {
    slug: "ai-agent-index",
    name: "AI Agent Index",
    description: "Cross-chain exposure to the AI-agent-token narrative — one Solana pick, one Base pick, one Ethereum pick, delivered to your own wallet on each.",
    icon: "🤖",
    allocations: [
      {
        chainId: BASE_CHAIN_ID,
        address: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
        symbol: "VIRTUAL",
        name: "Virtuals Protocol",
        decimals: 18,
        logoURI: "https://coin-images.coingecko.com/coins/images/34057/large/LOGOMARK.png",
        isNative: false,
        percentage: 40,
      },
      {
        chainId: SOLANA_CHAIN_ID,
        address: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump",
        symbol: "GOAT",
        name: "Goatseus Maximus",
        decimals: 6,
        logoURI: "",
        isNative: false,
        percentage: 35,
      },
      {
        chainId: ETHEREUM_CHAIN_ID,
        address: "0xaea46a60368a7bd060eec7df8cba43b7ef41ad85",
        symbol: "FET",
        name: "Artificial Superintelligence Alliance",
        decimals: 18,
        logoURI: "https://coin-images.coingecko.com/coins/images/5681/large/ASI.png",
        isNative: false,
        percentage: 25,
      },
    ],
    addedDate: "2026-08-08",
  },
  {
    slug: "solana-ecosystem",
    name: "Solana Ecosystem",
    description: "The DEX/staking/oracle infrastructure powering Solana — Jupiter, Jito, and Pyth in one swap.",
    icon: "🟣",
    allocations: [
      {
        chainId: SOLANA_CHAIN_ID,
        address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
        symbol: "JUP",
        name: "Jupiter",
        decimals: 6,
        logoURI: "https://static.jup.ag/jup/icon.png",
        isNative: false,
        percentage: 40,
      },
      {
        chainId: SOLANA_CHAIN_ID,
        address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
        symbol: "JTO",
        name: "Jito",
        decimals: 9,
        logoURI: "https://metadata.jito.network/token/jto/image",
        isNative: false,
        percentage: 30,
      },
      {
        chainId: SOLANA_CHAIN_ID,
        address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
        symbol: "PYTH",
        name: "Pyth Network",
        decimals: 6,
        logoURI: "https://pyth.network/token.svg",
        isNative: false,
        percentage: 30,
      },
    ],
    addedDate: "2026-08-08",
  },
  {
    slug: "robinhood-chain-starter",
    name: "Robinhood Chain Starter",
    description: "A blue-chip starter set on Robinhood's new L2 — native ETH, Global Dollar, and ApeCoin. The chain is brand new; most other tokens there are unverified, so this stays deliberately conservative.",
    icon: "🪶",
    allocations: [
      {
        chainId: ROBINHOOD_CHAIN_ID,
        address: "0x0000000000000000000000000000000000000000",
        symbol: "ETH",
        name: "Ether",
        decimals: 18,
        logoURI: "https://assets.relay.link/icons/1/light.png",
        isNative: true,
        percentage: 50,
      },
      {
        chainId: ROBINHOOD_CHAIN_ID,
        address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
        symbol: "USDG",
        name: "Global Dollar",
        decimals: 6,
        logoURI: "https://assets.coingecko.com/coins/images/51281/standard/GDN_USDG_Token_200x200.png",
        isNative: false,
        percentage: 30,
      },
      {
        chainId: ROBINHOOD_CHAIN_ID,
        address: "0x8f86a15ec17cb3369d8b3e666dadbc11daa82b79",
        symbol: "APE",
        name: "ApeCoin",
        decimals: 18,
        logoURI: "https://coin-images.coingecko.com/coins/images/24383/large/APECOIN.png?1756551529",
        isNative: false,
        percentage: 20,
      },
    ],
    addedDate: "2026-08-08",
  },
];

export function getAllBaskets(): BasketMeta[] {
  return BASKETS;
}

export function getBasket(slug: string): BasketMeta | null {
  return BASKETS.find((b) => b.slug === slug) ?? null;
}
