import type { EvmChainOption } from "@/lib/nft/evmChains";

// Swap-only EVM chains (2026-08-18) — deliberately NOT added to
// lib/nft/evmChains.ts's EVM_CHAINS, even though they're the same
// `EvmChainOption` shape and Relay lists them the same way as the 7
// chains there. EVM_CHAINS is dual-purpose: it also drives the NFT
// browse page's per-chain tabs (app/components/EvmChainSubTabs.tsx maps
// over it directly) and OpenSea slug resolution — OpenSea does NOT cover
// most of the chains below (per PLAN.md's OpenSea coverage table), so
// adding them there would surface a broken/empty NFT tab for each one.
// This list only feeds SWAP_CHAINS (lib/chains/swapChains.ts), so `slug`
// here is just a URL-safe identifier for the ?sell=&buy= prefill
// mechanism, NOT a verified OpenSea slug the way EVM_CHAINS's is.
//
// Selection: Relay's live /chains response lists 47 EVM chains beyond the
// original 7; these 39 are the ones with (a) a matching viem/chains
// built-in Chain definition under the same chain id (ruling out a few
// chain-id collisions with unrelated testnets, e.g. id 1337/999 collide
// with viem's tempoLocalnet/zoraTestnet, not the real chains Relay uses
// those ids for) and (b) a live eth_chainId RPC check confirming the
// chain id actually served back matches, same discipline evm.ts's own
// history requires before trusting a fallback RPC. Metis (1088) had a
// matching viem def but failed the live RPC check at add-time — held out
// pending a working endpoint, not silently guessed. Mythos (42018),
// AnimeChain (69000), and Doma (97477) have no viem/chains definition at
// all — held out pending a hand-built defineChain + verified RPC.
export const SWAP_ONLY_EVM_CHAINS: EvmChainOption[] = [
  { slug: "abstract", label: "Abstract", chainId: 2741, iconUrl: "https://assets.relay.link/icons/2741/light.png" },
  { slug: "apechain", label: "ApeChain", chainId: 33139, iconUrl: "https://assets.relay.link/icons/33139/light.png" },
  { slug: "arbitrum-nova", label: "Arbitrum Nova", chainId: 42170, iconUrl: "https://assets.relay.link/icons/42170/light.png" },
  { slug: "b3", label: "B3", chainId: 8333, iconUrl: "https://assets.relay.link/icons/8333/light.png" },
  { slug: "bsc", label: "BNB", chainId: 56, iconUrl: "https://assets.relay.link/icons/56/light.png" },
  { slug: "bob", label: "BOB", chainId: 60808, iconUrl: "https://assets.relay.link/icons/60808/light.png" },
  { slug: "berachain", label: "Berachain", chainId: 80094, iconUrl: "https://assets.relay.link/icons/80094/light.png" },
  { slug: "blast", label: "Blast", chainId: 81457, iconUrl: "https://assets.relay.link/icons/81457/light.png" },
  { slug: "boba", label: "Boba Network", chainId: 288, iconUrl: "https://assets.relay.link/icons/288/light.png" },
  { slug: "celo", label: "Celo", chainId: 42220, iconUrl: "https://assets.relay.link/icons/42220/light.png" },
  { slug: "cronos", label: "Cronos", chainId: 25, iconUrl: "https://assets.relay.link/icons/25/light.png" },
  { slug: "degen", label: "Degen", chainId: 666666666, iconUrl: "https://assets.relay.link/icons/666666666/light.png" },
  { slug: "gnosis", label: "Gnosis", chainId: 100, iconUrl: "https://assets.relay.link/icons/100/light.png" },
  { slug: "gunz", label: "Gunz", chainId: 43419, iconUrl: "https://assets.relay.link/icons/43419/light.png" },
  { slug: "ink", label: "Ink", chainId: 57073, iconUrl: "https://assets.relay.link/icons/57073/light.png" },
  { slug: "katana", label: "Katana", chainId: 747474, iconUrl: "https://assets.relay.link/icons/747474/light.png" },
  { slug: "linea", label: "Linea", chainId: 59144, iconUrl: "https://assets.relay.link/icons/59144/light.png" },
  { slug: "lisk", label: "Lisk", chainId: 1135, iconUrl: "https://assets.relay.link/icons/1135/light.png" },
  { slug: "manta-pacific", label: "Manta Pacific", chainId: 169, iconUrl: "https://assets.relay.link/icons/169/light.png" },
  { slug: "mantle", label: "Mantle", chainId: 5000, iconUrl: "https://assets.relay.link/icons/5000/light.png" },
  { slug: "megaeth", label: "MegaETH", chainId: 4326, iconUrl: "https://assets.relay.link/icons/4326/light.png" },
  { slug: "mode", label: "Mode", chainId: 34443, iconUrl: "https://assets.relay.link/icons/34443/light.png" },
  { slug: "monad", label: "Monad", chainId: 143, iconUrl: "https://assets.relay.link/icons/143/light.png" },
  { slug: "morph", label: "Morph", chainId: 2818, iconUrl: "https://assets.relay.link/icons/2818/light.png" },
  { slug: "plasma", label: "Plasma", chainId: 9745, iconUrl: "https://assets.relay.link/icons/9745/light.png" },
  { slug: "plume", label: "Plume", chainId: 98866, iconUrl: "https://assets.relay.link/icons/98866/light.png" },
  { slug: "ronin", label: "Ronin", chainId: 2020, iconUrl: "https://assets.relay.link/icons/2020/light.png" },
  { slug: "scroll", label: "Scroll", chainId: 534352, iconUrl: "https://assets.relay.link/icons/534352/light.png" },
  { slug: "sei", label: "Sei", chainId: 1329, iconUrl: "https://assets.relay.link/icons/1329/light.png" },
  { slug: "shape", label: "Shape", chainId: 360, iconUrl: "https://assets.relay.link/icons/360/light.png" },
  { slug: "somnia", label: "Somnia", chainId: 5031, iconUrl: "https://assets.relay.link/icons/5031/light.png" },
  { slug: "soneium", label: "Soneium", chainId: 1868, iconUrl: "https://assets.relay.link/icons/1868/light.png" },
  { slug: "sonic", label: "Sonic", chainId: 146, iconUrl: "https://assets.relay.link/icons/146/light.png" },
  { slug: "stable", label: "Stable", chainId: 988, iconUrl: "https://assets.relay.link/icons/988/light.png" },
  { slug: "superseed", label: "Superseed", chainId: 5330, iconUrl: "https://assets.relay.link/icons/5330/light.png" },
  { slug: "unichain", label: "Unichain", chainId: 130, iconUrl: "https://assets.relay.link/icons/130/light.png" },
  { slug: "world-chain", label: "World Chain", chainId: 480, iconUrl: "https://assets.relay.link/icons/480/light.png" },
  { slug: "zircuit", label: "Zircuit", chainId: 48900, iconUrl: "https://assets.relay.link/icons/48900/light.png" },
  { slug: "zora", label: "Zora", chainId: 7777777, iconUrl: "https://assets.relay.link/icons/7777777/light.png" },
  { slug: "zksync", label: "zkSync Era", chainId: 324, iconUrl: "https://assets.relay.link/icons/324/light.png" },
];
