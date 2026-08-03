import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// RELAY_FEE_RECIPIENT/RELAY_FEE_BPS/JUPITER_FEE_ACCOUNT/JUPITER_FEE_BPS are all
// computed once at module load time from process.env (lib/fees.ts:28-32) — not
// re-read per call. To test bpsFromEnv's fallback/validation logic under
// different env values, each test case sets process.env then re-imports the
// module fresh via vi.resetModules(), rather than trying to mutate an
// already-frozen export.
async function importFeesWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("./fees");
}

const ENV_KEYS = ["RELAY_FEE_RECIPIENT", "RELAY_FEE_BPS", "JUPITER_FEE_ACCOUNT", "JUPITER_FEE_BPS"];
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("bpsFromEnv (via RELAY_FEE_BPS/JUPITER_FEE_BPS)", () => {
  it("defaults to 25 bps when the env var is unset", async () => {
    const { RELAY_FEE_BPS } = await importFeesWithEnv({ RELAY_FEE_BPS: undefined });
    expect(RELAY_FEE_BPS).toBe(25);
  });

  it("uses a valid numeric env value", async () => {
    const { RELAY_FEE_BPS } = await importFeesWithEnv({ RELAY_FEE_BPS: "50" });
    expect(RELAY_FEE_BPS).toBe(50);
  });

  it("accepts 0 as an explicit valid value (fees can be disabled)", async () => {
    const { JUPITER_FEE_BPS } = await importFeesWithEnv({ JUPITER_FEE_BPS: "0" });
    expect(JUPITER_FEE_BPS).toBe(0);
  });

  it("falls back to the default for a negative value (never charge a negative fee)", async () => {
    const { RELAY_FEE_BPS } = await importFeesWithEnv({ RELAY_FEE_BPS: "-10" });
    expect(RELAY_FEE_BPS).toBe(25);
  });

  it("falls back to the default for a non-numeric value", async () => {
    const { RELAY_FEE_BPS } = await importFeesWithEnv({ RELAY_FEE_BPS: "not-a-number" });
    expect(RELAY_FEE_BPS).toBe(25);
  });

  it("falls back to the default for an empty string", async () => {
    const { RELAY_FEE_BPS } = await importFeesWithEnv({ RELAY_FEE_BPS: "" });
    expect(RELAY_FEE_BPS).toBe(25);
  });
});

describe("relayAppFees", () => {
  it("returns undefined when RELAY_FEE_RECIPIENT is unset (fee mechanism inactive)", async () => {
    const { relayAppFees } = await importFeesWithEnv({ RELAY_FEE_RECIPIENT: undefined });
    expect(relayAppFees()).toBeUndefined();
  });

  it("returns a single-entry fee array using the configured recipient and bps once set", async () => {
    const { relayAppFees } = await importFeesWithEnv({
      RELAY_FEE_RECIPIENT: "0x000000000000000000000000000000000000dEaD",
      RELAY_FEE_BPS: "30",
    });
    expect(relayAppFees()).toEqual([{ recipient: "0x000000000000000000000000000000000000dEaD", fee: "30" }]);
  });
});
