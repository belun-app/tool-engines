import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOT_FONT_SIZE,
  buildConversionTable,
  convertCssUnits,
  formatCssNumber,
} from "./px-to-rem-converter.js";

describe("convertCssUnits", () => {
  it("converts px to rem/em at the default 16px root (24px = 1.5rem)", () => {
    expect(DEFAULT_ROOT_FONT_SIZE).toBe(16);
    expect(convertCssUnits(24, "px", 16)).toEqual({ px: 24, rem: 1.5, em: 1.5 });
  });

  it("converts rem and em to px", () => {
    expect(convertCssUnits(2, "rem", 16)).toEqual({ px: 32, rem: 2, em: 2 });
    // 1.25em at a 20px base = 25px
    expect(convertCssUnits(1.25, "em", 20)).toEqual({ px: 25, rem: 1.25, em: 1.25 });
  });

  it("handles zero and negative lengths", () => {
    expect(convertCssUnits(0, "px", 16)).toEqual({ px: 0, rem: 0, em: 0 });
    expect(convertCssUnits(-8, "px", 16)).toEqual({ px: -8, rem: -0.5, em: -0.5 });
  });

  it("returns zeros for invalid value or root size", () => {
    const zero = { px: 0, rem: 0, em: 0 };
    expect(convertCssUnits(Number.NaN, "px", 16)).toEqual(zero);
    expect(convertCssUnits(10, "px", 0)).toEqual(zero);
    expect(convertCssUnits(10, "px", -16)).toEqual(zero);
    expect(convertCssUnits(Number.POSITIVE_INFINITY, "rem", 16)).toEqual(zero);
    expect(convertCssUnits(10, "px", Number.NaN)).toEqual(zero);
  });
});

describe("buildConversionTable", () => {
  it("builds the default table at 16px", () => {
    const t = buildConversionTable(16);
    expect(t).toHaveLength(23);
    expect(t[0]).toEqual({ px: 1, rem: 0.0625 });
    expect(t.find((r) => r.px === 16)).toEqual({ px: 16, rem: 1 });
    expect(t.at(-1)).toEqual({ px: 128, rem: 8 });
  });

  it("accepts custom values, drops non-finite ones, and rejects a bad root", () => {
    expect(buildConversionTable(10, [5, Number.NaN, 15])).toEqual([
      { px: 5, rem: 0.5 },
      { px: 15, rem: 1.5 },
    ]);
    expect(buildConversionTable(0)).toEqual([]);
    expect(buildConversionTable(Number.NaN)).toEqual([]);
  });
});

describe("formatCssNumber", () => {
  it("rounds to 4 decimals and drops trailing zeros", () => {
    expect(formatCssNumber(1.5)).toBe("1.5");
    expect(formatCssNumber(2)).toBe("2");
    // 1/3 = 0.33333... -> 0.3333
    expect(formatCssNumber(1 / 3)).toBe("0.3333");
    expect(formatCssNumber(0.0625)).toBe("0.0625");
    expect(formatCssNumber(1 / 3, 2)).toBe("0.33");
  });

  it("formats non-finite as 0", () => {
    expect(formatCssNumber(Number.NaN)).toBe("0");
    expect(formatCssNumber(Number.POSITIVE_INFINITY)).toBe("0");
  });
});
