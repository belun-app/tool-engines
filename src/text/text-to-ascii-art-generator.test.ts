import { describe, expect, it } from "vitest";
import {
  ASCII_ART_FONTS,
  DEFAULT_FONT,
  MAX_INPUT_LENGTH,
  generateAsciiArt,
} from "./text-to-ascii-art-generator.js";

// The 5x7 grids for H and I as drawn in the engine's bitmap table.
const H = ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"];
const I = [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."];

/** Independent reference renderer for the bitmap fonts (no shadow / slant). */
function render(glyphs: string[][], spacing: number, scale: number, fill: string): string[] {
  return Array.from({ length: 7 }, (_, r) =>
    glyphs
      .map((g) => [...g[r]].map((cell) => (cell === "#" ? fill : " ").repeat(scale)).join(""))
      .join(" ".repeat(spacing))
      .trimEnd(),
  );
}

describe("font catalogue", () => {
  it("lists the fonts with heights and capabilities", () => {
    expect(DEFAULT_FONT).toBe("standard");
    const byId = Object.fromEntries(ASCII_ART_FONTS.map((f) => [f.id, f]));
    expect(byId.standard).toMatchObject({ height: 6, fillable: false, cyrillic: false });
    expect(byId.mini).toMatchObject({ height: 7, fillable: true, cyrillic: true });
    expect(byId.shadow.height).toBe(8);
  });
});

describe("generateAsciiArt", () => {
  it("returns an empty result for empty or whitespace input", () => {
    expect(generateAsciiArt("  \n\t ", { font: "mini" })).toEqual({
      text: "",
      lines: [],
      width: 0,
      height: 0,
      font: "mini",
      fontName: "Mini",
      unsupported: [],
      truncated: false,
    });
  });

  it("falls back to the standard font for an unknown id", () => {
    expect(generateAsciiArt("A", { font: "nope" }).font).toBe("standard");
  });

  it("renders the mini bitmap font and folds lowercase", () => {
    const r = generateAsciiArt("hi", { font: "mini" });
    expect(r.lines).toEqual(render([H, I], 1, 1, "#"));
    expect(r.height).toBe(7);
    // H(5) + gap(1) + I(5) = 11 columns, trailing paper trimmed -> row 0 is "#   #  ###"
    expect(r.width).toBe(10);
    expect(r.text).toBe(r.lines.join("\n"));
  });

  it("renders block font at double horizontal scale", () => {
    const r = generateAsciiArt("I", { font: "block" });
    expect(r.lines).toEqual(render([I], 2, 2, "█"));
  });

  it("uses the first code point of a custom fill on bitmap fonts only", () => {
    expect(generateAsciiArt("I", { font: "banner", fill: "@x" }).lines).toEqual(
      render([I], 2, 2, "@"),
    );
    const standard = generateAsciiArt("I", { font: "standard", fill: "@" }).text;
    expect(standard).not.toContain("@");
  });

  it("clamps letter spacing to 0..10", () => {
    expect(generateAsciiArt("II", { font: "mini", letterSpacing: 0 }).lines).toEqual(
      render([I, I], 0, 1, "#"),
    );
    // 5 + 10 + " ###" (4) = 19
    expect(generateAsciiArt("II", { font: "mini", letterSpacing: 50 }).width).toBe(19);
    expect(generateAsciiArt("II", { font: "mini", letterSpacing: -5 }).width).toBe(9);
  });

  it("adds a drop-shadow row and column for the shadow font", () => {
    const r = generateAsciiArt("I", { font: "shadow" });
    expect(r.height).toBe(8);
    expect(r.lines[0]).not.toContain("░");
    expect(r.lines[7]).toContain("░");
    expect(r.lines[7]).not.toContain("█");
  });

  it("leans the slant font: top row shifted by height-1 = 6 columns", () => {
    const r = generateAsciiArt("I", { font: "slant" });
    // ".###." at scale 2 starts with 2 blank columns; row 0 gets +6, row 6 gets +0
    expect(r.lines[0].match(/^ */)?.[0].length).toBe(8);
    expect(r.lines[6].match(/^ */)?.[0].length).toBe(2);
  });

  it("renders the standard line-art font", () => {
    const r = generateAsciiArt("I", { font: "standard" });
    expect(r.height).toBe(6);
    expect(r.lines[0]).toBe(" ___");
    expect(r.unsupported).toEqual([]);
  });

  it("supports Cyrillic in bitmap fonts, aliasing look-alike letters", () => {
    // Cyrillic Н is drawn with the Latin H glyph
    expect(generateAsciiArt("Н", { font: "mini" }).lines).toEqual(render([H], 1, 1, "#"));
    expect(generateAsciiArt("я", { font: "mini" }).unsupported).toEqual([]);
  });

  it("reports unsupported characters once, in input order, and renders them as blanks", () => {
    expect(generateAsciiArt("Я€😀Я", { font: "standard" }).unsupported).toEqual(["Я", "€", "😀"]);
    expect(generateAsciiArt("€😀", { font: "mini" }).unsupported).toEqual(["€", "😀"]);
  });

  it("separates input lines with a blank gap row in bitmap fonts", () => {
    const r = generateAsciiArt("I\nI", { font: "mini" });
    expect(r.height).toBe(15);
    expect(r.lines[7]).toBe("");
  });

  it("aligns lines right and center against the widest line", () => {
    // "I" band is 4 wide (" ###"), "II" band is 10 wide (" ###   ###")
    const right = generateAsciiArt("I\nII", { font: "mini", align: "right" });
    expect(right.lines[0]).toBe("       ###");
    expect(right.lines[7]).toBe("");
    const center = generateAsciiArt("I\nII", { font: "mini", align: "center" });
    // padding 6 -> 3 on the left
    expect(center.lines[0]).toBe("    ###");
  });

  it("draws borders around the padded body", () => {
    const r = generateAsciiArt("I", { font: "mini", border: "ascii" });
    // inner width 4 -> rule of 6 dashes
    expect(r.lines[0]).toBe("+------+");
    expect(r.lines[1]).toBe("|  ### |");
    expect(r.lines[2]).toBe("|   #  |");
    expect(r.lines.at(-1)).toBe("+------+");
    expect(r.height).toBe(9);
    expect(r.width).toBe(8);
    const dbl = generateAsciiArt("I", { font: "mini", border: "double" });
    expect(dbl.lines[0]).toBe("╔══════╗");
  });

  it("wraps at maxWidth on word boundaries and breaks overlong words", () => {
    // "AB" = 5+1+5 = 11 columns, fits; "AB CD" (29) does not
    const words = generateAsciiArt("AB CD", { font: "mini", maxWidth: 11 });
    expect(words.height).toBe(15);
    const long = generateAsciiArt("ABCD", { font: "mini", maxWidth: 11 });
    expect(long.height).toBe(15);
    expect(long.width).toBeLessThanOrEqual(11);
  });

  it("truncates input past MAX_INPUT_LENGTH", () => {
    const r = generateAsciiArt("I".repeat(MAX_INPUT_LENGTH + 1), { font: "mini" });
    expect(r.truncated).toBe(true);
    // 200 glyphs of 5 + 199 gaps, last glyph trimmed to 4 columns
    expect(r.width).toBe(200 * 5 + 199 - 1);
  });

  it("expands tabs to two spaces", () => {
    expect(generateAsciiArt("I\tI", { font: "mini" }).width).toBe(
      generateAsciiArt("I  I", { font: "mini" }).width,
    );
  });
});
