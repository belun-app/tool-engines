import { describe, expect, it } from "vitest";
import { calculateLoan } from "./loan-calculator.js";

describe("calculateLoan", () => {
  it("matches the standard amortization payment (200k, 6%, 30 y = $1,199.10)", () => {
    // r = 0.005, n = 360: P r (1+r)^n / ((1+r)^n - 1) = 1199.1011
    const r = calculateLoan(200_000, 6, 30);
    expect(r.monthlyPayment).toBe(1199.1);
    expect(r.months).toBe(360);
    expect(r.schedule).toHaveLength(360);
    // first month: interest 200000 * 0.005 = 1000, principal 199.10
    expect(r.schedule[0]).toEqual({
      period: 1,
      payment: 1199.1,
      principal: 199.1,
      interest: 1000,
      balance: 199_800.9,
    });
    expect(r.schedule[359].balance).toBe(0);
    // total interest is roughly 360 * 1199.10 - 200000 = 231 676 (within rounding of the last payment)
    expect(Math.abs(r.totalInterest - 231_676)).toBeLessThan(5);
    expect(r.totalPayment).toBeCloseTo(200_000 + r.totalInterest, 2);
  });

  it("sums principal parts back to the loan amount", () => {
    const r = calculateLoan(15_000, 7.5, 5);
    const principal = r.schedule.reduce((s, e) => s + e.principal, 0);
    expect(principal).toBeCloseTo(15_000, 2);
  });

  it("divides evenly at 0% and settles the remainder on the last payment", () => {
    // 10000 / 12 = 833.33 ; 11 * 833.33 = 9166.63 ; last = 833.37
    const r = calculateLoan(10_000, 0, 1);
    expect(r.monthlyPayment).toBe(833.33);
    expect(r.totalInterest).toBe(0);
    expect(r.schedule[11].payment).toBe(833.37);
    expect(r.totalPayment).toBe(10_000);
  });

  it("rounds a fractional term to whole months", () => {
    expect(calculateLoan(1000, 5, 1.5).months).toBe(18);
  });

  it("returns zeros and an error code for invalid input", () => {
    const bad: Array<[number, number, number, string]> = [
      [0, 5, 10, "invalid-principal"],
      [-1, 5, 10, "invalid-principal"],
      [1000, -1, 10, "invalid-rate"],
      [1000, 5, 0, "invalid-term"],
      [1000, 5, -3, "invalid-term"],
      [1000, 5, 0.02, "invalid-term"], // rounds to 0 months
      [Number.NaN, 5, 10, "invalid-principal"],
      [1000, Number.POSITIVE_INFINITY, 10, "invalid-rate"],
      ["1000" as unknown as number, 5, 10, "invalid-principal"],
    ];
    for (const [p, r, y, error] of bad) {
      expect(calculateLoan(p, r, y)).toEqual({
        monthlyPayment: 0,
        totalPayment: 0,
        totalInterest: 0,
        months: 0,
        schedule: [],
        error,
      });
    }
  });

  it("has no error field on success", () => {
    expect(calculateLoan(1000, 5, 1)).not.toHaveProperty("error");
  });
});
