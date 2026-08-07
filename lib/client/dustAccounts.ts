// Pure, testable dust-token-account logic (2026-08-07) — separated from the
// actual RPC/wallet-signing code (DustBurner.tsx) so the filtering/summing
// rules can be unit tested without a real wallet or network connection.
export interface TokenAccountInfo {
  pubkey: string; // the token account's own address (NOT the mint)
  mint: string;
  amount: string; // raw token amount as a string, "0" for a genuinely empty account
  lamports: number; // the account's real SOL balance (its rent), straight from the RPC response — never a hardcoded constant, so this stays accurate even if a real account's rent differs from the typical ~0.00203928 SOL for any reason
}

export function filterZeroBalanceAccounts(accounts: TokenAccountInfo[]): TokenAccountInfo[] {
  return accounts.filter((a) => {
    try {
      return BigInt(a.amount) === BigInt(0);
    } catch {
      return false; // malformed amount — never treat as "safe to close"
    }
  });
}

export function sumReclaimableLamports(accounts: TokenAccountInfo[]): number {
  return accounts.reduce((sum, a) => sum + a.lamports, 0);
}

// Solana transaction size limit (1232 bytes) bounds how many close
// instructions fit in one transaction. 15 is a conservative, real-tested
// batch size for closeAccount instructions (each ~1 signer + 3 keys, small),
// leaving real headroom rather than computing an exact byte count.
export const CLOSE_ACCOUNTS_PER_BATCH = 15;

export function batchAccounts<T>(accounts: T[], batchSize = CLOSE_ACCOUNTS_PER_BATCH): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < accounts.length; i += batchSize) {
    batches.push(accounts.slice(i, i + batchSize));
  }
  return batches;
}
