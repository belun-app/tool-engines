import { describe, expect, it } from "vitest";
import { calculateBmi, feetInchesToCm, lbsToKg } from "./bmi-calculator.js";

describe("calculateBmi", () => {
  it("computes BMI and the healthy weight range", () => {
    // 70 / 1.75^2 = 22.857 ; 18.5 * 3.0625 = 56.66 ; 24.9 * 3.0625 = 76.26
    expect(calculateBmi(70, 175)).toEqual({
      bmi: 22.9,
      category: "normal",
      minHealthyKg: 56.7,
      maxHealthyKg: 76.3,
    });
  });

  it("uses WHO category edges (lower edge inclusive)", () => {
    // height 100 cm -> BMI equals the weight
    expect(calculateBmi(18.4, 100).category).toBe("underweight");
    expect(calculateBmi(18.5, 100).category).toBe("normal");
    expect(calculateBmi(24.99, 100).category).toBe("normal");
    expect(calculateBmi(25, 100).category).toBe("overweight");
    expect(calculateBmi(29.99, 100).category).toBe("overweight");
    expect(calculateBmi(30, 100).category).toBe("obese");
  });

  it("returns the empty result for zero, negative or non-finite input", () => {
    const empty = { bmi: null, category: "", minHealthyKg: null, maxHealthyKg: null };
    expect(calculateBmi(0, 175)).toEqual(empty);
    expect(calculateBmi(70, 0)).toEqual(empty);
    expect(calculateBmi(-70, 175)).toEqual(empty);
    expect(calculateBmi(Number.NaN, 175)).toEqual(empty);
    expect(calculateBmi(70, Number.POSITIVE_INFINITY)).toEqual(empty);
  });
});

describe("unit helpers", () => {
  it("converts pounds and feet/inches exactly", () => {
    expect(lbsToKg(1)).toBe(0.45359237);
    expect(lbsToKg(154)).toBeCloseTo(69.853, 3);
    expect(feetInchesToCm(5, 9)).toBeCloseTo(175.26, 10); // 69 in * 2.54
    expect(feetInchesToCm(0, 0)).toBe(0);
  });
});
