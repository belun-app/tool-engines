import { describe, expect, it } from "vitest";
import {
  calculateStatistics,
  calculateStatisticsFromText,
  parseNumberList,
  percentile,
} from "./statistics-calculator.js";

describe("parseNumberList", () => {
  it("splits on commas, semicolons and whitespace and skips junk", () => {
    expect(parseNumberList("1, 2; 3\n4\t5")).toEqual([1, 2, 3, 4, 5]);
    expect(parseNumberList("-1.5 abc 2e3")).toEqual([-1.5, 2000]);
    expect(parseNumberList("")).toEqual([]);
    expect(parseNumberList(" ,, ; ")).toEqual([]);
  });
});

describe("percentile (QUARTILE.INC)", () => {
  it("interpolates linearly", () => {
    expect(percentile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([7], 0.9)).toBe(7);
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([1, 2], 2)).toBe(2); // clamped
  });
});

describe("calculateStatistics", () => {
  it("computes the textbook data set 2,4,4,4,5,5,7,9", () => {
    const r = calculateStatistics([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(r.count).toBe(8);
    expect(r.sum).toBe(40);
    expect(r.mean).toBe(5);
    expect(r.median).toBe(4.5);
    expect(r.mode).toEqual([4]);
    expect(r.modeFrequency).toBe(3);
    expect(r.min).toBe(2);
    expect(r.max).toBe(9);
    expect(r.range).toBe(7);
    // squared deviations: 9+1+1+1+0+0+4+16 = 32
    expect(r.populationVariance).toBe(4);
    expect(r.populationStdDev).toBe(2);
    expect(r.sampleVariance).toBeCloseTo(32 / 7, 12);
    expect(r.sampleStdDev).toBeCloseTo(Math.sqrt(32 / 7), 12);
    // |dev|: 3+1+1+1+0+0+2+4 = 12 / 8
    expect(r.meanAbsoluteDeviation).toBe(1.5);
    // Q1 pos 1.75 -> 4 ; Q3 pos 5.25 -> 5 + 0.25*2 = 5.5
    expect(r.q1).toBe(4);
    expect(r.q3).toBe(5.5);
    expect(r.iqr).toBe(1.5);
    // fences 4 - 2.25 = 1.75 and 5.5 + 2.25 = 7.75 -> 9 is an outlier
    expect(r.outliers).toEqual([9]);
  });

  it("finds outliers beyond 1.5 IQR", () => {
    // Q1 2, Q3 4, IQR 2, fences -1 and 7
    const r = calculateStatistics([1, 2, 3, 4, 100]);
    expect(r.outliers).toEqual([100]);
    expect(r.median).toBe(3);
  });

  it("reports every tied mode and no mode when nothing repeats", () => {
    expect(calculateStatistics([3, 1, 3, 1, 2]).mode).toEqual([1, 3]);
    const none = calculateStatistics([1, 2, 3]);
    expect(none.mode).toEqual([]);
    expect(none.modeFrequency).toBe(1);
  });

  it("handles a single value (sample variance 0)", () => {
    const r = calculateStatistics([42]);
    expect(r).toMatchObject({ count: 1, mean: 42, median: 42, sampleVariance: 0, range: 0 });
  });

  it("sorts numerically, not lexically, and drops non-finite values", () => {
    const r = calculateStatistics([10, 9, 100, Number.NaN, Number.POSITIVE_INFINITY, -1]);
    expect(r.sorted).toEqual([-1, 9, 10, 100]);
    expect(r.count).toBe(4);
  });

  it("returns the empty result for no numbers", () => {
    const r = calculateStatistics([]);
    expect(r.valid).toBe(false);
    expect(r.count).toBe(0);
    expect(calculateStatisticsFromText("no numbers here").valid).toBe(false);
  });

  it("parses text end to end", () => {
    expect(calculateStatisticsFromText("1,2,3,4").mean).toBe(2.5);
  });
});
