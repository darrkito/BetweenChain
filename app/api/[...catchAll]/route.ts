import { NextResponse } from "next/server";

// Real gap found via is-agentic scan (2026-09-12): an unmatched /api/* path
// fell through to Next's default not-found handling, which returns the
// full HTML app shell — useless to an agent trying to parse an API error.
// Next's router only reaches this catch-all when no more specific route
// matched, so this can't shadow any real endpoint.
function jsonNotFound() {
  return NextResponse.json(
    {
      error: {
        code: "not_found",
        message: "No API endpoint exists at this path.",
        resolution: "See https://blockchains.click/llms.txt for the real list of available endpoints, or https://blockchains.click/.well-known/api-catalog.",
      },
    },
    { status: 404 },
  );
}

export const GET = jsonNotFound;
export const POST = jsonNotFound;
export const PUT = jsonNotFound;
export const PATCH = jsonNotFound;
export const DELETE = jsonNotFound;
