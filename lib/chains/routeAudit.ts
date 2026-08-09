import "server-only";

// Route Auditor (2026-08-09) — surfaces REAL fields both engines already
// return on every quote this app already fetches, previously discarded.
// Live-verified via direct curl before building (see
// PLAN_ROUTE_QUALITY_FEATURES.md): Relay's raw quote includes
// `details.totalImpact`/`timeEstimate`/`route.{origin,destination}.router`;
// Jupiter's raw quote includes `routePlan[].swapInfo.label`. Deliberately
// does NOT synthesize a "confidence score" — no such metric exists from
// either engine, and inventing one would imply false precision. All
// extraction is defensive (real API responses, not a typed SDK) — a
// missing/reshaped field degrades to null, never thrown.
export interface RouteAudit {
  priceImpactPct: number | null;
  timeEstimateSeconds: number | null;
  dexLabels: string[]; // which real AMM/pool/router filled each leg
}

export function auditFromJupiterRoute(route: unknown): Partial<RouteAudit> {
  const r = route as { priceImpactPct?: string; routePlan?: Array<{ swapInfo?: { label?: string } }> } | undefined;
  const priceImpactPct = r?.priceImpactPct ? Number(r.priceImpactPct) : null;
  const dexLabels = (r?.routePlan ?? []).map((p) => p.swapInfo?.label).filter((l): l is string => Boolean(l));
  return { priceImpactPct: Number.isFinite(priceImpactPct) ? priceImpactPct : null, dexLabels };
}

export function auditFromRelayQuote(quote: unknown): Partial<RouteAudit> {
  const q = quote as {
    details?: {
      totalImpact?: { percent?: string };
      timeEstimate?: number;
      route?: { origin?: { router?: string }; destination?: { router?: string } };
    };
  };
  const details = q?.details;
  const priceImpactPct = details?.totalImpact?.percent ? Number(details.totalImpact.percent) : null;
  const dexLabels = [details?.route?.origin?.router, details?.route?.destination?.router].filter(
    (l): l is string => Boolean(l) && l !== "relay", // "relay" itself isn't a DEX name, just Relay's own leg
  );
  return {
    priceImpactPct: Number.isFinite(priceImpactPct) ? priceImpactPct : null,
    timeEstimateSeconds: typeof details?.timeEstimate === "number" ? details.timeEstimate : null,
    dexLabels,
  };
}

/** Merges audits from multiple legs (e.g. a Jupiter leg + a Relay leg) into one summary — impact is additive, time/labels concatenate. */
export function mergeRouteAudits(...parts: Array<Partial<RouteAudit>>): RouteAudit {
  const impacts = parts.map((p) => p.priceImpactPct).filter((v): v is number => v !== null && v !== undefined);
  const times = parts.map((p) => p.timeEstimateSeconds).filter((v): v is number => v !== null && v !== undefined);
  return {
    priceImpactPct: impacts.length > 0 ? impacts.reduce((a, b) => a + b, 0) : null,
    timeEstimateSeconds: times.length > 0 ? times.reduce((a, b) => a + b, 0) : null,
    dexLabels: parts.flatMap((p) => p.dexLabels ?? []),
  };
}
