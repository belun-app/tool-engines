import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT,
  addSalesTax,
  calculateSalesTax,
  combineTaxRates,
  isPlausibleRate,
  removeSalesTax,
  round2,
  splitTaxAmount,
  taxRateFromPrices,
} from "./sales-tax-calculator.js";

describe("addSalesTax", () => {
  it("adds 8.25% to $100", () => {
    expect(addSalesTax(100, 8.25)).toEqual({
      netAmount: 100,
      taxAmount: 8.25,
      grossAmount: 108.25,
      ratePercent: 8.25,
      valid: true,
    });
  });

  it("rounds half-cents up", () => {
    // 19.99 * 7% = 1.3993 -> 1.40 ; 10.10 * 5% = 0.505 -> 0.51
    expect(addSalesTax(19.99, 7).taxAmount).toBe(1.4);
    expect(addSalesTax(19.99, 7).grossAmount).toBe(21.39);
    expect(addSalesTax(10.1, 5).taxAmount).toBe(0.51);
  });

  it("supports three-decimal rates like New York City's 8.875%", () => {
    expect(addSalesTax(200, 8.875).taxAmount).toBe(17.75);
  });

  it("treats a negative or NaN rate as 0 and caps the rate at 1000%", () => {
    expect(addSalesTax(50, -5).taxAmount).toBe(0);
    expect(addSalesTax(50, Number.NaN).ratePercent).toBe(0);
    expect(addSalesTax(1, 5000).ratePercent).toBe(1000);
  });

  it("returns the invalid result for a negative or non-finite amount", () => {
    expect(addSalesTax(-1, 5).valid).toBe(false);
    expect(addSalesTax(Number.NaN, 5).valid).toBe(false);
    expect(addSalesTax(Number.POSITIVE_INFINITY, 5).grossAmount).toBe(0);
  });

  it("handles zero amounts", () => {
    expect(addSalesTax(0, 10)).toMatchObject({ valid: true, grossAmount: 0, taxAmount: 0 });
  });
});

describe("removeSalesTax", () => {
  it("divides by 1 + rate instead of subtracting the rate", () => {
    // 100 / 1.0825 = 92.3788 -> 92.38 ; tax 7.62
    const r = removeSalesTax(100, 8.25);
    expect(r.netAmount).toBe(92.38);
    expect(r.taxAmount).toBe(7.62);
    expect(r.grossAmount).toBe(100);
  });

  it("round-trips an add", () => {
    expect(removeSalesTax(108.25, 8.25).netAmount).toBe(100);
  });

  it("returns invalid for a negative gross", () => {
    expect(removeSalesTax(-10, 5).valid).toBe(false);
  });
});

describe("calculateSalesTax", () => {
  it("dispatches on mode, default add", () => {
    expect(calculateSalesTax(100, 10).grossAmount).toBe(110);
    expect(calculateSalesTax(110, 10, "remove").netAmount).toBe(100);
  });
});

describe("combineTaxRates", () => {
  it("adds stacked rates without compounding", () => {
    // California state 6% + county 0.25% + district 2.5% = 8.75
    expect(combineTaxRates(6, 0.25, 2.5)).toBe(8.75);
    expect(combineTaxRates(4, 4.5, 0.375)).toBe(8.875);
  });

  it("drops invalid parts and handles no rates", () => {
    expect(combineTaxRates(5, -2, Number.NaN)).toBe(5);
    expect(combineTaxRates()).toBe(0);
  });
});

describe("taxRateFromPrices", () => {
  it("recovers the rate from subtotal and total", () => {
    // (107.25 - 100) / 100 = 7.25%
    expect(taxRateFromPrices(100, 107.25)).toEqual({
      ratePercent: 7.25,
      taxAmount: 7.25,
      valid: true,
    });
  });

  it("is invalid when net is 0, gross < net, or either is bad", () => {
    expect(taxRateFromPrices(0, 10).valid).toBe(false);
    expect(taxRateFromPrices(100, 90).valid).toBe(false);
    expect(taxRateFromPrices(Number.NaN, 90).valid).toBe(false);
  });

  it("gives 0% when gross equals net", () => {
    expect(taxRateFromPrices(50, 50)).toMatchObject({ ratePercent: 0, valid: true });
  });
});

describe("splitTaxAmount", () => {
  it("splits tax across jurisdictions and the parts sum to the total", () => {
    // $100 at 6 + 1 + 0.25: 6.00, 1.00, 0.25 -> total 7.25
    expect(splitTaxAmount(100, [6, 1, 0.25])).toEqual([6, 1, 0.25]);
  });

  it("lets the last part absorb the rounding remainder", () => {
    // 33.33 at 3 x 3.333%: each 1.1109 -> 1.11 ; total 9.999% -> 3.3327 -> 3.33
    const parts = splitTaxAmount(33.33, [3.333, 3.333, 3.333]);
    const total = addSalesTax(33.33, 9.999).taxAmount;
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(total);
  });

  it("returns zeros for an invalid amount and [] for no rates", () => {
    expect(splitTaxAmount(-5, [1, 2])).toEqual([0, 0]);
    expect(splitTaxAmount(100, [])).toEqual([]);
  });
});

describe("rounding, reverse mode and rate checks", () => {
  it("rounds exact half-cent ties up despite float noise", () => {
    expect(addSalesTax(30, 7.25)).toMatchObject({ taxAmount: 2.18, grossAmount: 32.18 });
    expect(addSalesTax(110, 8.25)).toMatchObject({ taxAmount: 9.08, grossAmount: 119.08 });
    expect(addSalesTax(92, 8.875)).toMatchObject({
      netAmount: 92,
      taxAmount: 8.17,
      grossAmount: 100.17,
    });
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
  });

  it("keeps net + tax equal to the total for every cent amount at common rates", () => {
    for (const rate of [6.25, 7.25, 8.875, 10, 20, 22]) {
      for (let cents = 1; cents <= 20000; cents += 7) {
        const r = addSalesTax(cents / 100, rate);
        expect(Math.round(r.netAmount * 100) + Math.round(r.taxAmount * 100)).toBe(
          Math.round(r.grossAmount * 100),
        );
        const back = removeSalesTax(cents / 100, rate);
        expect(Math.round(back.netAmount * 100) + Math.round(back.taxAmount * 100)).toBe(cents);
      }
    }
  });

  it("matches exact decimal half-up rounding of the tax", () => {
    // Tax in cents with integer arithmetic: amount (cents) × rate (basis points).
    for (const [rate, bp] of [
      [7.25, 725],
      [6.25, 625],
      [22, 2200],
    ] as const) {
      for (let cents = 1; cents <= 100000; cents += 13) {
        const exact = Math.floor((cents * bp + 5000) / 10000);
        expect(Math.round(addSalesTax(cents / 100, rate).taxAmount * 100)).toBe(exact);
      }
    }
  });

  it("extracts Russian VAT 22% (22/122) from an amount including it", () => {
    expect(removeSalesTax(1220, 22)).toMatchObject({ netAmount: 1000, taxAmount: 220 });
    expect(removeSalesTax(10000, 22)).toMatchObject({ netAmount: 8196.72, taxAmount: 1803.28 });
    expect(removeSalesTax(100, 22)).toMatchObject({ netAmount: 81.97, taxAmount: 18.03 });
  });

  it("splits the tax shown in reverse mode so the parts add up to it", () => {
    const r = removeSalesTax(50.06, combineTaxRates(6.25, 2));
    const parts = splitTaxAmount(r.netAmount, [6.25, 2], r.taxAmount);
    expect(Math.round((parts[0] + parts[1]) * 100)).toBe(Math.round(r.taxAmount * 100));
  });

  it("refuses amounts too large to hold cents instead of printing Infinity", () => {
    expect(addSalesTax(1.7e308, 10).valid).toBe(false);
    expect(addSalesTax(MAX_AMOUNT * 10, 10).valid).toBe(false);
    expect(addSalesTax(MAX_AMOUNT, 10).valid).toBe(true);
  });

  it("tells plausible rates from typos", () => {
    expect(isPlausibleRate(22)).toBe(true);
    expect(isPlausibleRate(0)).toBe(true);
    expect(isPlausibleRate(100)).toBe(true);
    expect(isPlausibleRate(-5)).toBe(false);
    expect(isPlausibleRate(5000)).toBe(false);
    expect(isPlausibleRate(Number.NaN)).toBe(false);
  });
});
