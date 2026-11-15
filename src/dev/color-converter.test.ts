import { describe, expect, it } from "vitest";
import { convertColor } from "./color-converter.js";

// #336699 = rgb(51, 102, 153): max .6, min .2 -> l = .4, s = .4/.8 = 50%, h = 210;
// HSV: v = 60%, s = .4/.6 = 66.7% -> 67%.
const STEEL = {
  valid: true,
  hex: "#336699",
  rgb: "rgb(51, 102, 153)",
  hsl: "hsl(210, 50%, 40%)",
  hsv: "hsv(210, 67%, 60%)",
  r: 51,
  g: 102,
  b: 153,
};

describe("convertColor", () => {
  it("converts from every supported notation", () => {
    expect(convertColor("#336699")).toEqual(STEEL);
    expect(convertColor("369")).toEqual(STEEL);
    expect(convertColor("rgb(51, 102, 153)")).toEqual(STEEL);
    expect(convertColor("RGB(51,102,153)")).toEqual(STEEL);
    expect(convertColor("hsl(210, 50%, 40%)")).toEqual(STEEL);
    expect(convertColor("hsl(210, 50, 40)")).toEqual(STEEL);
  });

  it("converts HSV to RGB (hsv(30, 100%, 100%) = #ff8000)", () => {
    const r = convertColor("hsv(30, 100%, 100%)");
    expect(r.hex).toBe("#ff8000");
    expect(r.hsl).toBe("hsl(30, 100%, 50%)");
  });

  it("handles primaries, black, white and grey", () => {
    expect(convertColor("#ff0000").hsl).toBe("hsl(0, 100%, 50%)");
    expect(convertColor("#00ff00").hsv).toBe("hsv(120, 100%, 100%)");
    expect(convertColor("#000").hsv).toBe("hsv(0, 0%, 0%)");
    expect(convertColor("#fff").hsl).toBe("hsl(0, 0%, 100%)");
    expect(convertColor("#808080").hsl).toBe("hsl(0, 0%, 50%)");
    // hue 360 wraps to red
    expect(convertColor("hsl(360, 100%, 50%)").hex).toBe("#ff0000");
    expect(convertColor("hsv(360, 100%, 100%)").hex).toBe("#ff0000");
  });

  it("clamps rgb channels above 255", () => {
    expect(convertColor("rgb(300, 0, 0)").hex).toBe("#ff0000");
  });

  it("returns the invalid result for empty and unknown input", () => {
    for (const bad of [
      "",
      "   ",
      "red",
      "#12",
      "#1234",
      "rgb(1,2)",
      "hsl(a,b,c)",
      "cmyk(0,0,0,0)",
    ]) {
      expect(convertColor(bad).valid, bad).toBe(false);
    }
  });

  it("wraps hsl hue above 360", () => {
    expect(convertColor("hsl(400, 100%, 50%)").hex).toBe("#ffaa00");
  });
});
