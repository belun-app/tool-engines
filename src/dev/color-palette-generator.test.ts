import { describe, expect, it } from "vitest";
import { PALETTE_TYPES, type PaletteType, generatePalette } from "./color-palette-generator.js";

const hexes = (input: string, type: PaletteType) =>
  generatePalette(input, type).colors.map((c) => c.hex);

describe("generatePalette", () => {
  it("lists the five palette types", () => {
    expect([...PALETTE_TYPES]).toEqual([
      "complementary",
      "analogous",
      "triadic",
      "tetradic",
      "monochromatic",
    ]);
  });

  it("rotates hue for pure red (h=0, s=100%, l=50%)", () => {
    // 180° -> cyan; 120°/240° -> green/blue; 90° -> chartreuse (#80ff00), 270° -> violet (#8000ff)
    expect(hexes("#ff0000", "complementary")).toEqual(["#ff0000", "#00ffff"]);
    expect(hexes("#ff0000", "triadic")).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
    expect(hexes("#ff0000", "tetradic")).toEqual(["#ff0000", "#80ff00", "#00ffff", "#8000ff"]);
    // -30° = 330° -> (255, 0, 127.5->128); +30° -> (255, 127.5->128, 0)
    expect(hexes("#ff0000", "analogous")).toEqual(["#ff0080", "#ff0000", "#ff8000"]);
  });

  it("steps lightness ±15/30 points for monochromatic, clamped to 5..95%", () => {
    const r = generatePalette("f00", "monochromatic");
    expect(r.colors.map((c) => c.hsl)).toEqual([
      "hsl(0, 100%, 20%)",
      "hsl(0, 100%, 35%)",
      "hsl(0, 100%, 50%)",
      "hsl(0, 100%, 65%)",
      "hsl(0, 100%, 80%)",
    ]);
    // l = 0.2 -> #660000 ; l = 0.8 -> #ff9999
    expect(r.colors[0].hex).toBe("#660000");
    expect(r.colors[4].hex).toBe("#ff9999");
    // white (l = 1) clamps every step into 5..95%
    const white = generatePalette("#fff", "monochromatic").colors.map((c) => c.hsl);
    expect(white).toEqual([
      "hsl(0, 0%, 70%)",
      "hsl(0, 0%, 85%)",
      "hsl(0, 0%, 95%)",
      "hsl(0, 0%, 95%)",
      "hsl(0, 0%, 95%)",
    ]);
  });

  it("returns rgb/hsl strings and WCAG luminance", () => {
    const r = generatePalette("#0000ff", "complementary");
    expect(r.baseHex).toBe("#0000ff");
    expect(r.colors[0]).toEqual({
      hex: "#0000ff",
      rgb: "rgb(0, 0, 255)",
      hsl: "hsl(240, 100%, 50%)",
      luminance: 0.0722,
    });
    // complement of blue is yellow: luminance 0.2126 + 0.7152
    expect(r.colors[1].hex).toBe("#ffff00");
    expect(r.colors[1].luminance).toBeCloseTo(0.9278, 10);
  });

  it("keeps greys grey (no saturation to rotate)", () => {
    expect(hexes("#808080", "triadic")).toEqual(["#808080", "#808080", "#808080"]);
  });

  it("falls back to complementary for an unknown type", () => {
    const r = generatePalette("#ff0000", "rainbow" as PaletteType);
    expect(r.type).toBe("complementary");
    expect(r.colors).toHaveLength(2);
  });

  it("returns the invalid result for bad hex", () => {
    for (const bad of ["", "red", "#ff", "#gggggg", "#12345"]) {
      expect(generatePalette(bad, "triadic")).toEqual({
        valid: false,
        baseHex: "",
        type: "triadic",
        colors: [],
      });
    }
  });
});
