"use client";
import { createClient } from "@supabase/supabase-js";

/**
 * Browser client — anon key only, RLS-enforced. Session JWT is attached
 * per-request from the HttpOnly cookie via API routes, so this client is
 * used for anonymous/public reads only (or paired with supabaseForUser
 * server-side for authenticated dashboard data fetched through an API route).
 */
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
