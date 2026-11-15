import { describe, expect, it } from "vitest";
import {
  type BodyFatInput,
  calculateBodyFat,
  classifyBodyFat,
  feetInchesToCm,
  inchesToCm,
  lbsToKg,
} from "./body-fat-calculator.js";

const man: BodyFatInput = {
  sex: "male",
  age: 30,
  heightCm: 180,
  weightKg: 80,
  neckCm: 40,
  waistCm: 90,
  hipCm: 0,
};

const woman: BodyFatInput = {
  sex: "female",
  age: 30,
  heightCm: 165,
  weightKg: 60,
  neckCm: 34,
  waistCm: 75,
  hipCm: 100,
};

describe("calculateBodyFat", () => {
  it("applies the U.S. Navy formula for men", () => {
    // 495 / (1.0324 - 0.19077 log10(50) + 0.15456 log10(180)) - 450 = 18.367
    const r = calculateBodyFat(man);
    expect(r.navyPercent).toBe(18.4);
    expect(r.category).toBe("average");
    // 80 * 18.4% = 14.72
    expect(r.fatMassKg).toBe(14.7);
    expect(r.leanMassKg).toBe(65.3);
    // BMI 80 / 1.8^2 = 24.69 ; Deurenberg 1.2*24.69 + 0.23*30 - 10.8 - 5.4 = 20.33
    expect(r.bmi).toBe(24.7);
    expect(r.bmiPercent).toBe(20.3);
    // Jackson & Pollock ideal at 30 = 12.7 ; lean 65.28 / 0.873 = 74.78
    expect(r.idealPercent).toBe(12.7);
    expect(r.idealWeightKg).toBe(74.8);
    expect(r.fatToLoseKg).toBe(5.2);
  });

  it("applies the U.S. Navy formula for women (uses hips)", () => {
    // 495 / (1.29579 - 0.35004 log10(75 + 100 - 34) + 0.221 log10(165)) - 450 = 28.936
    const r = calculateBodyFat(woman);
    expect(r.navyPercent).toBe(28.9);
    expect(r.category).toBe("average");
    expect(r.idealPercent).toBe(19.3);
    // Deurenberg: 1.2 * 22.04 + 6.9 - 5.4 = 27.95
    expect(r.bmiPercent).toBe(27.9);
  });

  it("falls back to the BMI estimate when the tape measurements cannot work", () => {
    // waist not bigger than neck
    const r = calculateBodyFat({ ...man, waistCm: 40 });
    expect(r.navyPercent).toBeNull();
    expect(r.bmiPercent).toBe(20.3);
    expect(r.category).toBe("average");
    expect(r.fatMassKg).toBe(16.2); // 80 * 20.3%
    // woman without hips
    expect(calculateBodyFat({ ...woman, hipCm: 0 }).navyPercent).toBeNull();
    // zero neck
    expect(calculateBodyFat({ ...man, neckCm: 0 }).navyPercent).toBeNull();
  });

  it("interpolates the ideal body fat between table ages and clamps outside", () => {
    // male 27: 10.5 + (2/5)(12.7 - 10.5) = 11.38
    expect(calculateBodyFat({ ...man, age: 27 }).idealPercent).toBe(11.4);
    expect(calculateBodyFat({ ...man, age: 16 }).idealPercent).toBe(8.5);
    expect(calculateBodyFat({ ...man, age: 80 }).idealPercent).toBe(20.9);
    expect(calculateBodyFat({ ...woman, age: 55 }).idealPercent).toBe(26.3);
  });

  it("clamps extreme estimates to 2–75%", () => {
    const tiny = calculateBodyFat({ ...man, waistCm: 41, neckCm: 40, weightKg: 40 });
    expect(tiny.navyPercent).toBe(2);
    const huge = calculateBodyFat({ ...man, weightKg: 400, waistCm: 0 });
    expect(huge.bmiPercent).toBe(75);
  });

  it("returns the empty result for invalid input", () => {
    for (const bad of [
      { ...man, age: 0 },
      { ...man, age: 131 },
      { ...man, heightCm: 0 },
      { ...man, weightKg: -1 },
      { ...man, neckCm: Number.NaN },
      { ...man, hipCm: Number.POSITIVE_INFINITY },
    ]) {
      const r = calculateBodyFat(bad);
      expect(r.navyPercent).toBeNull();
      expect(r.bmiPercent).toBeNull();
      expect(r.category).toBe("");
    }
  });
});

describe("classifyBodyFat", () => {
  it("uses the ACE bands for men and women", () => {
    expect(classifyBodyFat(5.9, "male")).toBe("essential");
    expect(classifyBodyFat(6, "male")).toBe("athletes");
    expect(classifyBodyFat(14, "male")).toBe("fitness");
    expect(classifyBodyFat(18, "male")).toBe("average");
    expect(classifyBodyFat(25, "male")).toBe("obese");
    expect(classifyBodyFat(13.9, "female")).toBe("essential");
    expect(classifyBodyFat(14, "female")).toBe("athletes");
    expect(classifyBodyFat(21, "female")).toBe("fitness");
    expect(classifyBodyFat(25, "female")).toBe("average");
    expect(classifyBodyFat(32, "female")).toBe("obese");
    expect(classifyBodyFat(Number.NaN, "female")).toBe("");
  });
});

describe("unit helpers", () => {
  it("converts imperial units exactly", () => {
    expect(inchesToCm(10)).toBeCloseTo(25.4, 10);
    expect(lbsToKg(100)).toBeCloseTo(45.359237, 10);
    expect(feetInchesToCm(6, 0)).toBeCloseTo(182.88, 10);
  });
});
