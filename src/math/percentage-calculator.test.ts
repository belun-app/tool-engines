import { describe, expect, it } from "vitest";
import {
  calcPercentChange,
  calcPercentDifference,
  calcPercentOf,
  calcWhatPercent,
  roundTo,
} from "./percentage-calculator.js";

describe("percentage calculator", () => {
  it("X% of Y", () => {
    expect(calcPercentOf(20, 150)).toBe(30);
    expect(calcPercentOf(-10, 50)).toBe(-5);
    expect(calcPercentOf(0, 50)).toBe(0);
    expect(calcPercentOf(Number.NaN, 50)).toBeNull();
  });

  it("X is what percent of Y", () => {
    expect(calcWhatPercent(30, 150)).toBe(20);
    expect(calcWhatPercent(150, 100)).toBe(150);
    expect(calcWhatPercent(5, 0)).toBeNull();
    expect(calcWhatPercent(5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("percentage change uses |from| so a negative start keeps the right direction", () => {
    expect(calcPercentChange(50, 75)).toBe(50);
    expect(calcPercentChange(80, 60)).toBe(-25);
    // -50 -> -25 is an increase of 50%
    expect(calcPercentChange(-50, -25)).toBe(50);
    expect(calcPercentChange(0, 10)).toBeNull();
  });

  it("percentage difference is symmetric over the mean", () => {
    // |10 - 20| / 15 = 66.67%
    expect(calcPercentDifference(10, 20)).toBeCloseTo(66.6667, 4);
    expect(calcPercentDifference(20, 10)).toBe(calcPercentDifference(10, 20));
    expect(calcPercentDifference(0, 0)).toBe(0);
    expect(calcPercentDifference(Number.NaN, 0)).toBeNull();
  });

  it("roundTo rounds to the given decimals", () => {
    expect(roundTo(66.666666, 2)).toBe(66.67);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(1234.5678, 1)).toBe(1234.6);
  });

  it("rounds half-way decimals up", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
  });
});
