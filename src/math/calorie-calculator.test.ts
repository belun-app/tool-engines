import { describe, expect, it } from "vitest";
import { calculateCalories } from "./calorie-calculator.js";

describe("calculateCalories (Mifflin-St Jeor)", () => {
  it("computes BMR and TDEE for a man", () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 1780 ; x1.55 = 2759
    expect(calculateCalories(30, "male", 180, 80, "moderate")).toEqual({
      bmr: 1780,
      tdee: 2759,
      mildLoss: 2509,
      loss: 2259,
      mildGain: 3009,
      gain: 3259,
    });
  });

  it("computes BMR for a woman", () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 1345.25 ; sedentary x1.2 = 1614.3
    const r = calculateCalories(25, "female", 165, 60, "sedentary");
    expect(r.bmr).toBe(1345);
    expect(r.tdee).toBe(1614);
  });

  it("applies every activity multiplier", () => {
    const tdee = (a: Parameters<typeof calculateCalories>[4]) =>
      calculateCalories(30, "male", 180, 80, a).tdee;
    expect(tdee("sedentary")).toBe(2136); // 1780 * 1.2
    expect(tdee("light")).toBe(2448); // * 1.375 = 2447.5
    expect(tdee("active")).toBe(3071); // * 1.725 = 3070.5
    expect(tdee("very-active")).toBe(3382); // * 1.9
  });

  it("never goes below zero", () => {
    // 10*1 + 6.25*10 - 5*100 - 161 < 0
    const r = calculateCalories(100, "female", 10, 1, "sedentary");
    expect(r.bmr).toBe(0);
    expect(r.loss).toBe(0);
  });

  it("returns zeros for invalid input", () => {
    const zero = { bmr: 0, tdee: 0, mildLoss: 0, loss: 0, mildGain: 0, gain: 0 };
    expect(calculateCalories(0, "male", 180, 80, "moderate")).toEqual(zero);
    expect(calculateCalories(131, "male", 180, 80, "moderate")).toEqual(zero);
    expect(calculateCalories(30, "male", 0, 80, "moderate")).toEqual(zero);
    expect(calculateCalories(30, "male", 180, -1, "moderate")).toEqual(zero);
    expect(calculateCalories(Number.NaN, "male", 180, 80, "moderate")).toEqual(zero);
  });
});
