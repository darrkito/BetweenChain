import "server-only";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// Fully-unattended cross-chain delivery for Trigger Orders (2026-08-09) —
// this is the ONLY place this app's backend holds a real signing key. Its
// blast radius is bounded by design: it can only ever move tokens a user
// has explicitly delegated (via SPL `approve`, see
// lib/relayer/deliverOrder.ts) up to the exact amount they approved — it
// has no general authority over any user's wallet. See SECURITY.md's
// "Trigger Order relayer" entry for the full threat model before touching
// this file.
//
// RELAYER_SOLANA_SECRET_KEY accepts either format `solana-keygen` /
// wallet exports commonly use: a base58 string, or a JSON array of bytes
// (e.g. `[12,34,...]`, 64 bytes). Never logged, never sent to any client
// bundle (server-only import above enforces the latter at build time).
let cached: Keypair | null | undefined;

export function getRelayerKeypair(): Keypair | null {
  if (cached !== undefined) return cached;

  const raw = process.env.RELAYER_SOLANA_SECRET_KEY;
  if (!raw) {
    cached = null;
    return null;
  }

  try {
    const secretKey = raw.trim().startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw.trim());
    cached = Keypair.fromSecretKey(secretKey);
  } catch {
    throw new Error("RELAYER_SOLANA_SECRET_KEY is set but not a valid Solana secret key (expected base58 or a JSON byte array)");
  }
  return cached;
}
