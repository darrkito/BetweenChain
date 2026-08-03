// Loads .env.local (the same file `next dev` reads) so tests that need real
// config — Supabase URL/service key for the local dev instance,
// SUPABASE_JWT_SECRET for session-token tests — see the same values the app
// itself runs against, without duplicating them into a second env file that
// could drift out of sync. Deliberately does nothing if .env.local is
// missing (e.g. CI without local Supabase) — tests that need it should fail
// with a clear "Missing required env var" from lib/supabase/server.ts's own
// `env()` helper, not a confusing setup-file error.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not present — fine, see comment above.
}
