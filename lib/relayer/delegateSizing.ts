// Pure sizing math for fully-unattended Trigger Order delivery (2026-08-09)
// — extracted so it's unit-testable without hitting Jupiter's API or a
// wallet. See app/api/orders/create/route.ts's own doc comment for why
// each order kind needs a buffer above its best available estimate.
export const LIMIT_DELEGATE_BUFFER = 1.1; // +10%
export const DCA_DELEGATE_BUFFER = 1.25; // +25%

export function sizeLimitDelegateAmount(takingAmountAtomic: string): bigint {
  return BigInt(Math.ceil(Number(takingAmountAtomic) * LIMIT_DELEGATE_BUFFER));
}

export function sizeDcaDelegateAmount(estimatedOutAmountAtomic: string): bigint {
  return BigInt(Math.ceil(Number(estimatedOutAmountAtomic) * DCA_DELEGATE_BUFFER));
}
