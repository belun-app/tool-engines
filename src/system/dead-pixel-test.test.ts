import { describe, expect, it } from "vitest";
import {
  TEST_COLORS,
  contrastTextColor,
  cycleIndex,
  describeScreen,
  diagnoseDefect,
  flashColor,
  isoAllowance,
  relativeLuminance,
} from "./dead-pixel-test.js";

/** WCAG 2 contrast ratio between two relative luminances. */
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

describe("TEST_COLORS / cycleIndex / flashColor", () => {
  it("cycles the nine-colour palette starting with the primaries", () => {
    expect(TEST_COLORS.map((c) => c.id).slice(0, 5)).toEqual([
      "red",
      "green",
      "blue",
      "black",
      "white",
    ]);
    expect(TEST_COLORS).toHaveLength(9);
    expect(TEST_COLORS.every((c) => /^#[0-9a-f]{6}$/.test(c.hex))).toBe(true);
  });

  it("wraps around in both directions", () => {
    expect(cycleIndex(0, 1)).toBe(1);
    expect(cycleIndex(8, 1)).toBe(0);
    expect(cycleIndex(0, -1)).toBe(8);
    expect(cycleIndex(3, -12)).toBe(0); // 3 - 12 = -9 ≡ 0 (mod 9)
    expect(cycleIndex(2, 3, 4)).toBe(1);
  });

  it("sanitises bad inputs", () => {
    expect(cycleIndex(5, 1, 0)).toBe(0);
    expect(cycleIndex(Number.NaN, 2)).toBe(2);
    expect(cycleIndex(1.9, 1.9)).toBe(2); // both truncated
    expect(cycleIndex(1, Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("alternates primaries with black when flashing", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((f) => flashColor(f).id)).toEqual([
      "red",
      "black",
      "green",
      "black",
      "blue",
      "black",
      "white",
      "black",
    ]);
    expect(flashColor(8).id).toBe("red");
    expect(flashColor(-1).id).toBe("black");
    expect(flashColor(Number.NaN).id).toBe("red");
  });
});

describe("relativeLuminance / contrastTextColor", () => {
  it("matches the WCAG luminance of the primaries", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
    expect(relativeLuminance("#ff0000")).toBeCloseTo(0.2126, 10);
    expect(relativeLuminance("#00ff00")).toBeCloseTo(0.7152, 10);
    expect(relativeLuminance("#0000ff")).toBeCloseTo(0.0722, 10);
    // #808080: (128/255 + .055)/1.055 ^ 2.4 = 0.2159
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 4);
  });

  it("accepts 3-digit hex and falls back to black on garbage", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(1, 10);
    expect(relativeLuminance("0f0")).toBeCloseTo(0.7152, 10);
    expect(relativeLuminance("nope")).toBe(0);
    expect(relativeLuminance("")).toBe(0);
  });

  it("picks black on light fields and white on dark ones", () => {
    expect(contrastTextColor("#00ff00")).toBe("#000000");
    expect(contrastTextColor("#ffffff")).toBe("#000000");
    expect(contrastTextColor("#ffff00")).toBe("#000000");
    expect(contrastTextColor("#0000ff")).toBe("#ffffff");
    expect(contrastTextColor("#000000")).toBe("#ffffff");
  });

  it("always picks the label colour with the higher contrast", () => {
    for (const { hex } of TEST_COLORS) {
      const bg = relativeLuminance(hex);
      const best = contrast(bg, 0) >= contrast(bg, 1) ? "#000000" : "#ffffff";
      expect(contrastTextColor(hex)).toBe(best);
    }
  });
});

describe("describeScreen", () => {
  it("multiplies CSS pixels by the pixel ratio", () => {
    expect(describeScreen({ cssWidth: 1280, cssHeight: 800, pixelRatio: 2 })).toEqual({
      cssResolution: "1280 × 800",
      physicalResolution: "2560 × 1600",
      pixelRatio: 2,
      totalPixels: 4_096_000,
      totalSubpixels: 12_288_000,
      megapixels: 4.1,
    });
  });

  it("rounds fractional sizes and ratios", () => {
    // 1536x864 at 1.25 -> 1920x1080 = 2 073 600 px -> 2.07 MP
    const r = describeScreen({ cssWidth: 1536, cssHeight: 864, pixelRatio: 1.25 });
    expect(r.physicalResolution).toBe("1920 × 1080");
    expect(r.megapixels).toBe(2.07);
    expect(describeScreen({ cssWidth: 100.4, cssHeight: 50.6, pixelRatio: 0 })).toMatchObject({
      cssResolution: "100 × 51",
      pixelRatio: 1,
    });
  });

  it("returns the empty report for non-positive sizes", () => {
    expect(describeScreen({ cssWidth: 0, cssHeight: 600, pixelRatio: 1 }).totalPixels).toBe(0);
    expect(describeScreen({ cssWidth: 800, cssHeight: -1, pixelRatio: 1 }).cssResolution).toBe("");
  });
});

describe("diagnoseDefect", () => {
  const obs = (black: boolean, white: boolean, every: boolean) => ({
    visibleOnBlack: black,
    visibleOnWhite: white,
    visibleOnEveryColor: every,
  });

  it("implements the four-row decision table", () => {
    expect(diagnoseDefect(obs(false, false, false))).toEqual({
      kind: "none",
      worthTryingToFix: false,
      isoFaultType: 0,
    });
    expect(diagnoseDefect(obs(false, false, true)).kind).toBe("inconclusive");
    expect(diagnoseDefect(obs(false, true, false))).toEqual({
      kind: "dead",
      worthTryingToFix: false,
      isoFaultType: 2,
    });
    expect(diagnoseDefect(obs(true, false, false))).toEqual({
      kind: "hot",
      worthTryingToFix: true,
      isoFaultType: 1,
    });
    expect(diagnoseDefect(obs(true, true, false))).toEqual({
      kind: "stuck",
      worthTryingToFix: true,
      isoFaultType: 3,
    });
    expect(diagnoseDefect(obs(true, true, true))).toEqual({
      kind: "dirt",
      worthTryingToFix: true,
      isoFaultType: 0,
    });
  });
});

describe("isoAllowance", () => {
  it("allows 4/4/10 faults on a Class II 1080p panel, as documented", () => {
    // 2.0736 MP * (2, 2, 5) = 4.15, 4.15, 10.37 -> floored
    expect(isoAllowance(1920 * 1080)).toEqual({
      pixelClass: 2,
      megapixels: 2.07,
      brightDots: 4,
      darkDots: 4,
      subpixelFaults: 10,
      total: 18,
    });
  });

  it("scales by class (ISO 13406-2 / 9241-307 table)", () => {
    // 4K: 8.2944 MP
    const px = 3840 * 2160;
    expect(isoAllowance(px, 0)).toMatchObject({ brightDots: 0, darkDots: 0, subpixelFaults: 0 });
    expect(isoAllowance(px, 1)).toMatchObject({ brightDots: 8, darkDots: 8, subpixelFaults: 16 });
    expect(isoAllowance(px, 3)).toMatchObject({
      brightDots: 41,
      darkDots: 124,
      subpixelFaults: 414,
    });
    expect(isoAllowance(px, 4)).toMatchObject({
      brightDots: 414,
      darkDots: 1244,
      subpixelFaults: 4147,
    });
  });

  it("floors small panels to zero and handles empty input", () => {
    // 0.3 MP * 2 = 0.6 -> 0 bright dots allowed
    expect(isoAllowance(640 * 480).brightDots).toBe(0);
    expect(isoAllowance(0)).toMatchObject({ megapixels: 0, total: 0 });
    expect(isoAllowance(-5)).toMatchObject({ megapixels: 0, total: 0 });
  });

  it("falls back to Class II for an unknown class", () => {
    expect(isoAllowance(1_000_000, 9 as 2).brightDots).toBe(2);
  });
});
