"use client";

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// GhostSwap (2026-08-09) — generates a brand-new, unlinked wallet entirely
// client-side. Nothing here ever leaves the browser: no network call, no
// server involvement, no persistence. The private key is shown to the user
// exactly once so they can save it themselves — this app never stores or
// transmits it. See PLAN_SAFETY_DISCOVERY_FEATURES.md's GhostSwap section
// for why this is honest ("severs the direct on-chain link," not "makes
// you anonymous") and what NOT to claim (no real compliance screening).
export interface FreshWallet {
  address: string;
  privateKey: string; // base58 (Solana) or 0x-hex (EVM) — shown once, never persisted
}

export function generateFreshSolanaWallet(): FreshWallet {
  const kp = Keypair.generate();
  return { address: kp.publicKey.toBase58(), privateKey: bs58.encode(kp.secretKey) };
}

export function generateFreshEvmWallet(): FreshWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, privateKey };
}
