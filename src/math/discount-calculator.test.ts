import { describe, expect, it } from "vitest";
import { calculateDiscount, calculatePercentOff } from "./discount-calculator.js";

describe("calculateDiscount", () => {
  it("takes a single percentage off", () => {
    // 59.99 * 25% = 14.9975 -> 15.00 ; 44.9925 -> 44.99
    const r = calculateDiscount(59.99, 25);
    expect(r.firstDiscountAmount).toBe(15);
    expect(r.finalPrice).toBe(44.99);
    expect(r.savings).toBe(15);
    expect(r.effectivePercent).toBe(25);
    expect(r.secondDiscountAmount).toBe(0);
    expect(r.valid).toBe(true);
  });

  it("stacks a second discount on the reduced price (20% + 10% = 28%, not 30%)", () => {
    const r = calculateDiscount(100, 20, 10);
    expect(r.priceAfterFirst).toBe(80);
    expect(r.secondDiscountAmount).toBe(8);
    expect(r.finalPrice).toBe(72);
    expect(r.savings).toBe(28);
    expect(r.effectivePercent).toBe(28);
  });

  it("clamps percentages to 0–100", () => {
    expect(calculateDiscount(50, 150).finalPrice).toBe(0);
    expect(calculateDiscount(50, -10).finalPrice).toBe(50);
    expect(calculateDiscount(50, Number.NaN, 10).finalPrice).toBe(45);
  });

  it("returns the invalid result for a zero, negative or non-finite price", () => {
    expect(calculateDiscount(0, 10).valid).toBe(false);
    expect(calculateDiscount(-5, 10).valid).toBe(false);
    expect(calculateDiscount(Number.NaN, 10).finalPrice).toBe(0);
  });
});

describe("calculatePercentOff", () => {
  it("works out the percentage off from old and new price", () => {
    // (80 - 60) / 80 = 25%
    expect(calculatePercentOff(80, 60)).toEqual({ discountPercent: 25, savings: 20, valid: true });
    // (29.99 - 19.99) / 29.99 = 33.344%
    expect(calculatePercentOff(29.99, 19.99).discountPercent).toBe(33.34);
    expect(calculatePercentOff(10, 0).discountPercent).toBe(100);
    expect(calculatePercentOff(10, 10).discountPercent).toBe(0);
  });

  it("is invalid when the sale price is higher or input is bad", () => {
    expect(calculatePercentOff(10, 12).valid).toBe(false);
    expect(calculatePercentOff(0, 0).valid).toBe(false);
    expect(calculatePercentOff(10, -1).valid).toBe(false);
  });
});
