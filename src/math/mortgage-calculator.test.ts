import { describe, expect, it } from "vitest";
import { type MortgageInput, calculateMortgage } from "./mortgage-calculator.js";

const base: MortgageInput = {
  homePrice: 400_000,
  downPayment: 80_000,
  annualRatePct: 6.5,
  years: 30,
};

describe("calculateMortgage", () => {
  it("computes principal and interest on the loan amount", () => {
    // loan 320 000, r = 0.065/12, n = 360 -> 2022.62
    const r = calculateMortgage(base);
    expect(r.loanAmount).toBe(320_000);
    expect(r.downPaymentPercent).toBe(20);
    expect(r.monthlyPrincipalInterest).toBe(2022.62);
    expect(r.months).toBe(360);
    expect(r.schedule[359].balance).toBe(0);
    expect(r.monthlyPmi).toBe(0);
    expect(r.monthlyTotal).toBe(2022.62);
    // ~ 360 * 2022.62 - 320000 = 408 143
    expect(Math.abs(r.totalInterest - 408_143)).toBeLessThan(5);
  });

  it("adds tax, insurance, HOA and PMI below 20% down", () => {
    // 10% down: loan 360 000 ; PMI 0.5%: 360000 * 0.005 / 12 = 150
    // tax 4800/12 = 400, insurance 1200/12 = 100, HOA 50
    const r = calculateMortgage({
      ...base,
      downPayment: 40_000,
      annualPropertyTax: 4800,
      annualHomeInsurance: 1200,
      monthlyHoa: 50,
      pmiAnnualRatePct: 0.5,
    });
    expect(r.downPaymentPercent).toBe(10);
    expect(r.monthlyPmi).toBe(150);
    expect(r.monthlyPropertyTax).toBe(400);
    expect(r.monthlyHomeInsurance).toBe(100);
    expect(r.monthlyHoa).toBe(50);
    expect(r.monthlyTotal).toBeCloseTo(r.monthlyPrincipalInterest + 700, 2);
  });

  it("drops PMI at exactly 20% down and ignores a negative HOA", () => {
    const r = calculateMortgage({ ...base, pmiAnnualRatePct: 0.5, monthlyHoa: -100 });
    expect(r.monthlyPmi).toBe(0);
    expect(r.monthlyHoa).toBe(0);
  });

  it("handles a 0% rate", () => {
    const r = calculateMortgage({ ...base, annualRatePct: 0, years: 10 });
    // 320000 / 120 = 2666.666 -> 2666.67
    expect(r.monthlyPrincipalInterest).toBe(2666.67);
    expect(r.totalInterest).toBe(0);
    expect(r.totalPrincipalInterest).toBe(320_000);
  });

  it("returns the empty result for invalid input", () => {
    for (const bad of [
      { ...base, homePrice: 0 },
      { ...base, downPayment: -1 },
      { ...base, downPayment: 400_000 },
      { ...base, downPayment: 500_000 },
      { ...base, years: 0 },
      { ...base, annualRatePct: -1 },
      { ...base, annualRatePct: Number.NaN },
    ]) {
      const r = calculateMortgage(bad);
      expect(r.months).toBe(0);
      expect(r.monthlyTotal).toBe(0);
      expect(r.schedule).toEqual([]);
    }
  });
});
