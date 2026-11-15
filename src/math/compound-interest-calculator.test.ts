import { describe, expect, it } from "vitest";
import {
  MAX_YEARS,
  calculateCompoundInterest,
  depositTax,
} from "./compound-interest-calculator.js";

const cents = (n: number) => Math.round(n * 100) / 100;

describe("calculateCompoundInterest", () => {
  it("matches P(1 + r/n)^(nt) for annual compounding", () => {
    // 1000 * 1.05^10 = 1628.894627
    const r = calculateCompoundInterest(1000, 5, 10, 1);
    expect(r.finalAmount).toBe(1628.89);
    expect(r.totalDeposits).toBe(1000);
    expect(r.totalInterest).toBe(628.89);
    expect(r.months).toBe(120);
    expect(r.schedule).toHaveLength(10);
  });

  it("matches the closed form for monthly, quarterly and daily compounding", () => {
    expect(calculateCompoundInterest(1000, 5, 10, 12).finalAmount).toBe(
      cents(1000 * (1 + 0.05 / 12) ** 120),
    ); // 1647.01
    expect(calculateCompoundInterest(5000, 6, 3, 4).finalAmount).toBe(
      cents(5000 * (1 + 0.06 / 4) ** 12),
    ); // 5978.09
    expect(calculateCompoundInterest(1000, 8, 2, 365).finalAmount).toBe(
      cents(1000 * (1 + 0.08 / 365) ** 730),
    ); // 1173.49
  });

  it("adds end-of-month contributions like an ordinary annuity", () => {
    // monthly compounding, i = 0.05/12: FV = 1000(1+i)^120 + 100((1+i)^120 - 1)/i = 17175.24
    const i = 0.05 / 12;
    const expected = 1000 * (1 + i) ** 120 + (100 * ((1 + i) ** 120 - 1)) / i;
    const r = calculateCompoundInterest(1000, 5, 10, 12, 100);
    expect(r.finalAmount).toBe(cents(expected));
    expect(r.totalDeposits).toBe(1000 + 100 * 120);
    expect(r.totalInterest).toBe(cents(r.finalAmount - r.totalDeposits));
  });

  it("allows a zero principal with contributions", () => {
    const r = calculateCompoundInterest(0, 0, 1, 12, 50);
    expect(r.finalAmount).toBe(600);
    expect(r.totalInterest).toBe(0);
  });

  it("returns principal unchanged at 0%", () => {
    expect(calculateCompoundInterest(1234.56, 0, 5, 12).finalAmount).toBe(1234.56);
  });

  it("builds a yearly schedule whose rows add up", () => {
    const r = calculateCompoundInterest(1000, 10, 2, 1, 0);
    // year 1: 1000 -> 1100 ; year 2: -> 1210
    expect(r.schedule).toEqual([
      { year: 1, deposits: 1000, interest: 100, balance: 1100 },
      { year: 2, deposits: 0, interest: 110, balance: 1210 },
    ]);
  });

  it("adds a partial final year for fractional terms", () => {
    const r = calculateCompoundInterest(1000, 12, 1.5, 12);
    expect(r.months).toBe(18);
    expect(r.schedule.map((s) => s.year)).toEqual([1, 2]);
    expect(r.finalAmount).toBe(cents(1000 * 1.01 ** 18));
  });

  it("returns the empty result for invalid input", () => {
    const bad: Array<[number, number, number, number, number?]> = [
      [-1, 5, 10, 12],
      [1000, -100, 10, 12], // a negative rate above −100 % is calculated
      [1000, 5, 0, 12],
      [1000, 5, -1, 12],
      [1000, 5, 10, 0],
      [1000, 5, 10, 12, -10],
      [0, 5, 10, 12, 0],
      [Number.NaN, 5, 10, 12],
      [1000, 5, Number.POSITIVE_INFINITY, 12],
      [1000, 5, 0.01, 12], // rounds to 0 months
    ];
    for (const args of bad) {
      const r = calculateCompoundInterest(...args);
      expect(r).toMatchObject({
        finalAmount: 0,
        totalDeposits: 0,
        totalInterest: 0,
        months: 0,
        schedule: [],
      });
      expect(r.error).not.toBeNull();
    }
  });
});

describe("negative rates, limits, contribution timing and tax", () => {
  it("calculates a negative rate above −100 %", () => {
    const r = calculateCompoundInterest(10000, -3, 5, 12);
    expect(r.error).toBeNull();
    expect(r.finalAmount).toBe(8605.46);
    expect(calculateCompoundInterest(10000, -100, 5, 12).error).toBe("rate-too-low");
  });

  it("explains a term under half a month and refuses more than 100 years", () => {
    expect(calculateCompoundInterest(10000, 5, 0.04, 12).error).toBe("term-too-short");
    // Refused up front: no schedule is built for the 100,000 years.
    const r = calculateCompoundInterest(1000, 5, 100000, 12);
    expect(r.error).toBe("term-too-long");
    expect(r.schedule).toEqual([]);
    expect(calculateCompoundInterest(1000, 5, MAX_YEARS, 12).schedule).toHaveLength(MAX_YEARS);
  });

  it("reports overflow instead of Infinity", () => {
    expect(calculateCompoundInterest(1e300, 50, 100, 12).error).toBe("overflow");
    expect(calculateCompoundInterest(1000, 1_000_000, 100, 12).error).toBe("overflow");
  });

  it("monthly contributions are unchanged by the new options", () => {
    expect(calculateCompoundInterest(10000, 7, 10, 12, 500).finalAmount).toBe(106639.02);
    expect(
      calculateCompoundInterest(10000, 7, 10, 12, 500, { contributionEvery: 1 }).finalAmount,
    ).toBe(106639.02);
  });

  it("contributes quarterly or yearly at the end of the period", () => {
    // 0 % rate: only the count of contributions matters.
    const q = calculateCompoundInterest(0, 0, 1, 12, 1000, { contributionEvery: 3 });
    expect(q.totalDeposits).toBe(4000);
    const y = calculateCompoundInterest(1000, 10, 2, 1, 1000, { contributionEvery: 12 });
    // 1000 → 1100 + 1000 = 2100 → 2310 + 1000 = 3310
    expect(y.finalAmount).toBe(3310);
    expect(y.totalDeposits).toBe(3000);
  });

  it("a contribution at the start of the period earns that period's interest", () => {
    const end = calculateCompoundInterest(0, 10, 1, 1, 1000, { contributionEvery: 12 });
    const start = calculateCompoundInterest(0, 10, 1, 1, 1000, {
      contributionEvery: 12,
      contributionTiming: "start",
    });
    expect(end.finalAmount).toBe(1000);
    expect(start.finalAmount).toBe(1100);
  });

  it("returns the effective annual rate (APY)", () => {
    expect(calculateCompoundInterest(1000, 5, 1, 365).effectiveRate).toBeCloseTo(5.1267, 3);
    expect(calculateCompoundInterest(1000, 12, 1, 12).effectiveRate).toBeCloseTo(12.6825, 3);
  });
});

describe("depositTax (Russian NDFL on deposit interest)", () => {
  it("taxes only interest above 1 000 000 × key rate, at 13 %", () => {
    const r = calculateCompoundInterest(3_000_000, 16, 1, 12);
    const tax = depositTax(r.schedule, 16);
    expect(tax.allowance).toBe(160000);
    const interest = r.schedule[0].interest;
    expect(tax.totalTax).toBeCloseTo((interest - 160000) * 0.13, 1);
    expect(tax.netInterest).toBeCloseTo(interest - tax.totalTax, 1);
  });

  it("is zero below the allowance", () => {
    const r = calculateCompoundInterest(100000, 16, 1, 12);
    expect(depositTax(r.schedule, 16).totalTax).toBe(0);
  });

  it("uses 15 % on the part above 2.4 million", () => {
    const tax = depositTax([{ year: 1, deposits: 0, interest: 3_000_000, balance: 0 }], 10);
    // taxable 2 900 000: 2 400 000 × 13 % + 500 000 × 15 %
    expect(tax.totalTax).toBe(312000 + 75000);
  });
});
