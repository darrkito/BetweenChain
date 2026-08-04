import "server-only";
import { NextResponse } from "next/server";

/**
 * 2026-08-04 (reliability/observability pass) — ~24 routes had a final
 * catch-all that did `NextResponse.json({ error: (err as Error).message },
 * { status })`, sending whatever an internal thrown Error's message
 * happened to contain straight to the client — could be a vendor's raw
 * complaint text, a config hint ("OPENSEA_API_KEY is not set..."), or
 * anything else a dependency's error message contains, none of it vetted
 * for what's safe to expose. This logs the REAL error server-side (so it's
 * actually visible for debugging, addressing the separate "no error
 * tracking" gap in the same pass) and returns a generic, safe message to
 * the client instead.
 *
 * Deliberately NOT used for intentional, already-safe error responses
 * (validation failures, "not found", explicit business-logic messages like
 * "Cannot confirm buy from status: X") — only for the catch-all branches
 * that were forwarding an arbitrary caught error's raw message.
 */
export function safeErrorResponse(logLabel: string, err: unknown, status: number, publicMessage = "Something went wrong. Please try again."): NextResponse {
  console.error(`[${logLabel}]`, err);
  return NextResponse.json({ error: publicMessage }, { status });
}
