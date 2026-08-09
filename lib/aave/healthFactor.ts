import "server-only";
import { getPublicClient } from "@/lib/chains/evm";

// Sentinel Shield (2026-08-09, read-only v1) — Aave v3's real
// getUserAccountData() view function, confirmed live via direct eth_call
// against each chain's real Pool contract (not assumed from docs):
// Ethereum 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2, Arbitrum
// 0x794a61358D6845594F94dc1DB02A252b5b4814aD, Base
// 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5. No auth, no gas — a plain
// public read. healthFactor is 1e18-scaled; max uint256 means "no debt,"
// not "infinitely healthy" — displayed as null/"no open borrows" rather
// than a huge number.
const AAVE_POOL_BY_CHAIN: Record<number, string> = {
  1: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  42161: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  8453: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
};

const AAVE_POOL_ABI = [
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
] as const;

export interface AaveHealthSnapshot {
  chainId: number;
  totalCollateralUsd: number; // Aave's "base currency" is USD-pegged on every chain this app queries
  totalDebtUsd: number;
  healthFactor: number | null; // null = no open borrows (Aave returns max uint256 in that case)
}

const MAX_UINT256 = BigInt(2) ** BigInt(256) - BigInt(1);

export async function getAaveHealth(chainId: number, address: string): Promise<AaveHealthSnapshot | null> {
  const pool = AAVE_POOL_BY_CHAIN[chainId];
  if (!pool) return null;

  const client = getPublicClient(chainId);
  const [totalCollateralBase, totalDebtBase, , , , healthFactorRaw] = await client.readContract({
    address: pool as `0x${string}`,
    abi: AAVE_POOL_ABI,
    functionName: "getUserAccountData",
    args: [address as `0x${string}`],
  });

  return {
    chainId,
    totalCollateralUsd: Number(totalCollateralBase) / 1e8, // Aave's base currency uses 8 decimals
    totalDebtUsd: Number(totalDebtBase) / 1e8,
    healthFactor: healthFactorRaw >= MAX_UINT256 / BigInt(2) ? null : Number(healthFactorRaw) / 1e18,
  };
}

export const AAVE_SUPPORTED_CHAIN_IDS = Object.keys(AAVE_POOL_BY_CHAIN).map(Number);
