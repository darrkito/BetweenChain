import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

export interface PaymentLink {
  id: string;
  creator_user_id: string | null;
  dest_chain_id: number;
  dest_token: string;
  dest_token_symbol: string;
  dest_token_decimals: number;
  dest_token_logo_uri: string | null;
  dest_address: string;
  amount_requested: string | null;
  label: string | null;
  created_at: string;
}

// Shared read path for a ClickPay invoice — used by both the public GET
// API route (app/api/pay/[id]) and the server-rendered pay page
// (app/pay/[id]/page.tsx), same "one function, no self-fetch" pattern
// lib/content/games.ts's getGame()/lib/nft's vendor clients already
// establish elsewhere in this app.
export async function getPaymentLink(id: string): Promise<PaymentLink | null> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("payment_links").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as PaymentLink;
}
