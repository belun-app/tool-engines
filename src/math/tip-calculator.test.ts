import { describe, expect, it } from "vitest";
import { calculateTip } from "./tip-calculator.js";

describe("calculateTip", () => {
  it("computes the tip and total for one person", () => {
    // 85.40 * 18% = 15.372 -> 15.37 ; total 100.77
    expect(calculateTip(85.4, 18, 1)).toEqual({
      tipAmount: 15.37,
      totalAmount: 100.77,
      tipPerPerson: 15.37,
      totalPerPerson: 100.77,
      billPerPerson: 85.4,
      valid: true,
    });
  });

  it("splits between people", () => {
    // 120 * 20% = 24 ; 144 / 3 = 48
    const r = calculateTip(120, 20, 3);
    expect(r.tipPerPerson).toBe(8);
    expect(r.totalPerPerson).toBe(48);
    expect(r.billPerPerson).toBe(40);
  });

  it("floors fractional party sizes and treats < 1 as one person", () => {
    expect(calculateTip(100, 10, 2.9).totalPerPerson).toBe(55);
    expect(calculateTip(100, 10, 0).totalPerPerson).toBe(110);
    expect(calculateTip(100, 10, Number.NaN).totalPerPerson).toBe(110);
  });

  it("allows a 0% tip", () => {
    expect(calculateTip(50, 0, 2)).toMatchObject({ tipAmount: 0, totalAmount: 50, valid: true });
  });

  it("returns the invalid result for a bad bill or negative tip", () => {
    expect(calculateTip(0, 15, 1).valid).toBe(false);
    expect(calculateTip(-10, 15, 1).valid).toBe(false);
    expect(calculateTip(50, -5, 1).valid).toBe(false);
    expect(calculateTip(Number.NaN, 15, 1).totalAmount).toBe(0);
  });
});
