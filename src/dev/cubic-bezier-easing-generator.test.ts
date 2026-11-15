import { describe, expect, it } from "vitest";
import {
  BEZIER_PRESETS,
  type CubicBezierOptions,
  buildCubicBezierCss,
} from "./cubic-bezier-easing-generator.js";

describe("BEZIER_PRESETS", () => {
  it("match the CSS spec keyword definitions", () => {
    // CSS Easing Functions Level 1, §2.2
    const css = (name: string) => buildCubicBezierCss(BEZIER_PRESETS[name]).value;
    expect(css("ease")).toBe("cubic-bezier(0.25, 0.1, 0.25, 1)");
    expect(css("ease-in")).toBe("cubic-bezier(0.42, 0, 1, 1)");
    expect(css("ease-out")).toBe("cubic-bezier(0, 0, 0.58, 1)");
    expect(css("ease-in-out")).toBe("cubic-bezier(0.42, 0, 0.58, 1)");
    expect(css("linear")).toBe("cubic-bezier(0, 0, 1, 1)");
  });
});

describe("buildCubicBezierCss", () => {
  it("builds value and declaration", () => {
    expect(buildCubicBezierCss({ p1: { x: 0.1, y: 0.7 }, p2: { x: 1, y: 0.1 } })).toEqual({
      value: "cubic-bezier(0.1, 0.7, 1, 0.1)",
      css: "transition-timing-function: cubic-bezier(0.1, 0.7, 1, 0.1);",
      valid: true,
    });
  });

  it("clamps x to 0..1, y to -2..2 and rounds to 3 decimals", () => {
    expect(buildCubicBezierCss({ p1: { x: -0.5, y: 3 }, p2: { x: 1.5, y: -1.23456 } }).value).toBe(
      "cubic-bezier(0, 2, 1, -1.235)",
    );
  });

  it("keeps overshoot y values (back easing)", () => {
    expect(
      buildCubicBezierCss({ p1: { x: 0.68, y: -0.55 }, p2: { x: 0.265, y: 1.55 } }).value,
    ).toBe("cubic-bezier(0.68, -0.55, 0.265, 1.55)");
  });

  it("zeroes non-finite coordinates", () => {
    expect(
      buildCubicBezierCss({
        p1: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
        p2: { x: 1, y: 1 },
      }).value,
    ).toBe("cubic-bezier(0, 0, 1, 1)");
  });

  it("returns the invalid result for missing points", () => {
    const invalid = { value: "", css: "", valid: false };
    expect(buildCubicBezierCss(null as unknown as CubicBezierOptions)).toEqual(invalid);
    expect(buildCubicBezierCss({ p1: { x: 0, y: 0 } } as CubicBezierOptions)).toEqual(invalid);
  });
});
