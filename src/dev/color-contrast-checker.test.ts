import { describe, expect, it } from "vitest";
import {
  checkContrast,
  contrastRatio,
  parseColor,
  relativeLuminance,
  toHex,
} from "./color-contrast-checker.js";

describe("parseColor / toHex", () => {
  it("parses 3- and 6-digit hex with or without #, any case", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor("1A2b3C")).toEqual({ r: 26, g: 43, b: 60 });
    expect(parseColor("  #000000 ")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("parses rgb()/rgba() and rejects channels above 255", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor("RGBA(1,2,3,0.5)")).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseColor("rgb(256, 0, 0)")).toBeNull();
  });

  it("returns null for junk", () => {
    for (const bad of ["", "#ff", "#ggg", "red", "#12345", "hsl(0,0%,0%)"]) {
      expect(parseColor(bad), bad).toBeNull();
    }
  });

  it("formats lowercase #rrggbb", () => {
    expect(toHex({ r: 255, g: 0, b: 10 })).toBe("#ff000a");
  });
});

describe("relativeLuminance / contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
    // black on white = (1 + 0.05) / (0 + 0.05) = 21
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 10);
    // order does not matter
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 10);
  });
});

describe("checkContrast", () => {
  it("passes everything for black on white", () => {
    expect(checkContrast("#000", "#fff")).toEqual({
      valid: true,
      ratio: 21,
      ratioText: "21.00:1",
      aaNormal: true,
      aaLarge: true,
      aaaNormal: true,
      aaaLarge: true,
      uiComponents: true,
      foregroundHex: "#000000",
      backgroundHex: "#ffffff",
    });
  });

  it("applies the 4.5 boundary on the unrounded ratio (#767676 passes, #777777 fails)", () => {
    // #767676 on white = 4.54:1 (the darkest grey that passes AA); #777777 = 4.48:1
    const pass = checkContrast("#767676", "#ffffff");
    expect(pass.ratio).toBe(4.54);
    expect(pass.aaNormal).toBe(true);
    expect(pass.aaaNormal).toBe(false);
    const fail = checkContrast("#777777", "#ffffff");
    expect(fail.ratio).toBe(4.48);
    expect(fail.aaNormal).toBe(false);
    expect(fail.aaLarge).toBe(true);
    expect(fail.uiComponents).toBe(true);
  });

  it("fails everything for identical colours (1:1)", () => {
    const r = checkContrast("rgb(128,128,128)", "#808080");
    expect(r.ratio).toBe(1);
    expect(r.ratioText).toBe("1.00:1");
    expect(r.aaLarge).toBe(false);
  });

  it("returns the invalid result for unparseable colours", () => {
    const r = checkContrast("nope", "#fff");
    expect(r.valid).toBe(false);
    expect(r.ratioText).toBe("—");
  });
});
