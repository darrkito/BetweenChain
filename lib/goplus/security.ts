import "server-only";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

// Burner Shield Lite (2026-08-09) — real, live-verified GoPlus Security API
// (api.gopluslabs.io), confirmed via direct curl: no API key required on
// either endpoint used here. Scoped down from the original pitch's full
// ERC-4337 isolated-execution engine (that needs new account-abstraction
// infra plus a real decision about funding gas for arbitrary unvetted
// contracts — a materially bigger risk than anything shipped so far, see
// PLAN_SAFETY_DISCOVERY_FEATURES.md) to what's honestly buildable now: a
// real pre-sign risk check, the same category of tool as Blockaid/Wallet
// Guard, just backed by GoPlus's free data instead of a paid API.
const GOPLUS_API = "https://api.gopluslabs.io/api/v1";

export interface AddressSecurityFlags {
  isMalicious: boolean;
  reasons: string[]; // human-readable flags that were set
}

const ADDRESS_FLAG_LABELS: Record<string, string> = {
  cybercrime: "Linked to cybercrime",
  money_laundering: "Linked to money laundering",
  financial_crime: "Linked to financial crime",
  darkweb_transactions: "Darkweb transaction history",
  phishing_activities: "Linked to phishing",
  blacklist_doubt: "On a blacklist",
  stealing_attack: "Linked to theft/draining",
  blackmail_activities: "Linked to blackmail",
  sanctioned: "Sanctioned address",
  malicious_mining_activities: "Linked to malicious mining",
  mixer: "Mixer-associated address",
  fake_kyc: "Fake KYC provider",
  fake_token: "Associated with fake tokens",
  fake_standard_interface: "Non-standard/spoofed token interface",
  honeypot_related_address: "Linked to a honeypot",
  number_of_malicious_contracts_created: "Has deployed known-malicious contracts",
};

export async function checkAddressSecurity(chainId: number, address: string): Promise<AddressSecurityFlags | null> {
  const res = await fetchWithTimeout(`${GOPLUS_API}/address_security/${address}?chain_id=${chainId}`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json();
  const result = body?.result as Record<string, string> | undefined;
  if (!result) return null;

  const reasons: string[] = [];
  for (const [key, label] of Object.entries(ADDRESS_FLAG_LABELS)) {
    const value = result[key];
    if (value && value !== "0") reasons.push(label);
  }
  return { isMalicious: reasons.length > 0, reasons };
}

export interface TokenSecurityFlags {
  isHoneypot: boolean;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  ownerCanChangeBalance: boolean;
  isProxy: boolean;
  isMintable: boolean;
  // Contract-verification status — this is the same field GoPlus already
  // returns in the token_security payload this app was already fetching,
  // just not previously read. No new API call needed (see
  // PLAN_SANDBOX_SIMULATION.md's "adjacent capability already shipped" note).
  isOpenSource: boolean | null;
}

export async function checkTokenSecurity(chainId: number, tokenAddress: string): Promise<TokenSecurityFlags | null> {
  const res = await fetchWithTimeout(`${GOPLUS_API}/token_security/${chainId}?contract_addresses=${tokenAddress}`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json();
  const result = body?.result?.[tokenAddress.toLowerCase()] as Record<string, string> | undefined;
  if (!result) return null;

  return {
    isHoneypot: result.is_honeypot === "1",
    buyTaxPct: result.buy_tax ? Number(result.buy_tax) * 100 : null,
    sellTaxPct: result.sell_tax ? Number(result.sell_tax) * 100 : null,
    ownerCanChangeBalance: result.owner_change_balance === "1",
    isProxy: result.is_proxy === "1",
    isMintable: result.is_mintable === "1",
    isOpenSource: result.is_open_source == null ? null : result.is_open_source === "1",
  };
}
