import { describe, expect, it } from "vitest";
import { type BorderRadiusCorners, buildBorderRadius } from "./css-border-radius-generator.js";

const c = (
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
  unit: "px" | "%" = "px",
): BorderRadiusCorners => ({ topLeft, topRight, bottomRight, bottomLeft, unit });

describe("buildBorderRadius", () => {
  it("collapses to the shortest shorthand (TL TR BR BL)", () => {
    expect(buildBorderRadius(c(8, 8, 8, 8)).radius).toBe("8px");
    expect(buildBorderRadius(c(8, 24, 8, 24)).radius).toBe("8px 24px");
    expect(buildBorderRadius(c(1, 2, 3, 2)).radius).toBe("1px 2px 3px");
    expect(buildBorderRadius(c(1, 2, 3, 4)).radius).toBe("1px 2px 3px 4px");
    // BL differs from TR, so nothing can collapse even though BR == TL
    expect(buildBorderRadius(c(5, 2, 5, 9)).radius).toBe("5px 2px 5px 9px");
  });

  it("emits a ready-to-paste declaration", () => {
    expect(buildBorderRadius(c(8, 24, 8, 24))).toEqual({
      radius: "8px 24px",
      css: "border-radius: 8px 24px;",
      valid: true,
    });
  });

  it("supports % and clamps it to 0..100", () => {
    expect(buildBorderRadius(c(50, 50, 50, 50, "%")).radius).toBe("50%");
    expect(buildBorderRadius(c(150, 150, 150, 150, "%")).radius).toBe("100%");
  });

  it("clamps px to 0..500, rounds, and zeroes non-finite values", () => {
    expect(buildBorderRadius(c(-10, 900, 2.6, Number.NaN)).radius).toBe("0px 500px 3px 0px");
  });

  it("falls back to px for an unknown unit", () => {
    const bad = { ...c(4, 4, 4, 4), unit: "em" } as unknown as BorderRadiusCorners;
    expect(buildBorderRadius(bad).radius).toBe("4px");
  });

  it("returns the invalid result for a missing object", () => {
    expect(buildBorderRadius(null as unknown as BorderRadiusCorners)).toEqual({
      radius: "",
      css: "",
      valid: false,
    });
  });
});
