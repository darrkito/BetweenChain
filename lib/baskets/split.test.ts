import { describe, it, expect } from "vitest";
import { splitAmount, normalizePercentages } from "./split";

describe("splitAmount", () => {
  it("splits proportionally by percentage", () => {
    const result = splitAmount("1000000000", [{ percentage: 40 }, { percentage: 30 }, { percentage: 30 }]);
    expect(result).toEqual(["400000000", "300000000", "300000000"]);
  });

  it("always sums to exactly the input total, even with an odd amount that doesn't divide evenly", () => {
    const total = "1000000007";
    const result = splitAmount(total, [{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }]);
    const sum = result.reduce((s, a) => s + BigInt(a), BigInt(0));
    expect(sum.toString()).toBe(total);
  });

  it("the last allocation absorbs the rounding remainder", () => {
    const result = splitAmount("100", [{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }]);
    // 33.33% of 100 = 33.33 -> floors to 33 (integer division); two legs of 33 = 66,
    // remainder (100-66=34) goes to the last leg.
    expect(result[0]).toBe("33");
    expect(result[1]).toBe("33");
    expect(result[2]).toBe("34");
  });

  it("returns an empty array for no allocations", () => {
    expect(splitAmount("1000", [])).toEqual([]);
  });

  it("gives the full amount to a single 100% allocation", () => {
    expect(splitAmount("500", [{ percentage: 100 }])).toEqual(["500"]);
  });
});

describe("normalizePercentages", () => {
  it("leaves an already-100 set unchanged", () => {
    expect(normalizePercentages([40, 30, 30])).toEqual([40, 30, 30]);
  });

  it("scales a set summing to less than 100 up to 100", () => {
    const result = normalizePercentages([20, 20]);
    expect(result[0] + result[1]).toBeCloseTo(100);
    expect(result[0]).toBeCloseTo(50);
  });

  it("scales a set summing to more than 100 down to 100", () => {
    const result = normalizePercentages([60, 60]);
    expect(result[0] + result[1]).toBeCloseTo(100);
    expect(result[0]).toBeCloseTo(50);
  });

  it("splits evenly when every input is 0", () => {
    expect(normalizePercentages([0, 0, 0])).toEqual([100 / 3, 100 / 3, 100 / 3]);
  });
});
