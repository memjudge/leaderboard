import { describe, expect, it } from "vitest";
import { duration, int, pct, pValue, rate, secs, usd } from "../src/lib/format.ts";
import { ecdf, mcnemarExact, naturalCompare } from "../src/lib/stats.ts";

describe("mcnemarExact", () => {
  // Reference values: exact binomial sums with Python's math.comb and Fraction.
  it.each([
    [0, 0, 1],
    [5, 5, 1],
    [3, 0, 0.25],
    [10, 2, 0.03857421875],
    [33, 7, 4.2277022657799534e-5],
    [42, 16, 0.0008617822405421263],
    [1000, 900, 0.02310884510890107],
  ])("b=%i c=%i", (b, c, expected) => {
    expect(mcnemarExact(b, c)).toBeCloseTo(expected, 12);
    expect(mcnemarExact(c, b)).toBeCloseTo(expected, 12);
  });

  it("does not overflow for large disagreements", () => {
    expect(mcnemarExact(0, 1200)).toBe(0);
    expect(pValue(mcnemarExact(0, 1200))).toBe("under 10⁻¹⁵");
  });
});

describe("pValue", () => {
  it("writes small values in powers of ten", () => {
    expect(pValue(0.25)).toBe("0.25");
    expect(pValue(0.0038)).toBe("0.0038");
    expect(pValue(4.2277e-5)).toBe("4 × 10⁻⁵");
    expect(pValue(9.7e-5)).toBe("1 × 10⁻⁴");
  });
});

describe("naturalCompare", () => {
  it("orders numbered ids by number", () => {
    expect(["conv-10:q2", "conv-9:q10", "conv-9:q9"].sort(naturalCompare)).toEqual([
      "conv-9:q9",
      "conv-9:q10",
      "conv-10:q2",
    ]);
  });
});

describe("ecdf", () => {
  it("gives the share of values at or below each point", () => {
    expect(ecdf([3, 1, 2, 2])).toEqual([
      [1, 0.25],
      [2, 0.75],
      [3, 1],
    ]);
  });
});

describe("formatting", () => {
  it("never guesses a missing value", () => {
    for (const f of [int, pct, secs, usd, duration]) expect(f(null)).toBe("not reported");
    expect(rate(null)).toBe("not reported");
    expect(rate({ n: 0, value: null })).toBe("n/a");
    expect(rate({ n: 10, value: 0.5 })).toBe("50.0%");
  });

  it("formats numbers for people", () => {
    expect(int(1986)).toBe("1,986");
    expect(pct(0.82357)).toBe("82.4%");
    expect(secs(0.412)).toBe("412 ms");
    expect(secs(2.5e-5)).toBe("25 µs");
    expect(secs(1.6e-4)).toBe("160 µs");
    expect(secs(3.2)).toBe("3.20 s");
    expect(duration(252)).toBe("4 min 12 s");
    expect(duration(7500)).toBe("2 h 05 min");
    expect(usd(15.292102)).toBe("$15.29");
    expect(usd(0.004)).toBe("under $0.01");
  });
});
