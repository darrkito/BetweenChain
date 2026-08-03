import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Service-role client — bypasses RLS. Only ever used inside API routes after
 * the caller's session/authorization has already been checked explicitly.
 * Never expose this client or its key to the browser.
 */
export function supabaseAdmin(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * User-scoped client — RLS-enforced, built from the caller's minted JWT.
 * Use this for read paths where RLS itself should be the authorization
 * boundary (e.g. dashboard reads), not for privileged writes.
 */
export function supabaseForUser(jwt: string): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
