export interface TokenListItem {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  verified: boolean;
  isNative: boolean;
  source: "featured" | "trending" | "search";
}

export interface ChainInfo {
  id: number;
  name: string;
  displayName: string;
  iconUrl: string | null;
  vmType: string;
  nativeCurrency: { symbol: string; address: string; decimals: number };
  featuredTokens: Array<{
    id: string;
    symbol: string;
    name: string;
    address: string;
    decimals: number;
    logoURI: string;
  }>;
}
