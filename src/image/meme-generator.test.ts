import { describe, expect, it } from "vitest";
import {
  type MemeMeasure,
  fitWithin,
  layoutMemeCaption,
  memeFileName,
  memeFontString,
  normalizeCaption,
  wrapMemeText,
} from "./meme-generator.js";

// The mount measures text with canvas measureText; here a monospace stub is used:
// every character is half the font size wide.
const mono: MemeMeasure = (text, size) => text.length * size * 0.5;

describe("normalizeCaption", () => {
  it("collapses spaces/tabs, trims lines, caps blank runs at one empty line, upper-cases", () => {
    expect(normalizeCaption("  one \t  does\r\nnot\n\n\n\nsimply  ")).toBe(
      "ONE DOES\nNOT\n\nSIMPLY",
    );
  });

  it("keeps case when asked and handles Cyrillic", () => {
    expect(normalizeCaption("Привет  мир", false)).toBe("Привет мир");
    expect(normalizeCaption("привет")).toBe("ПРИВЕТ");
  });

  it("returns empty for non-strings and blank input", () => {
    expect(normalizeCaption(undefined as unknown as string)).toBe("");
    expect(normalizeCaption(" \n \t ")).toBe("");
  });
});

describe("wrapMemeText", () => {
  // width 100 at size 10 -> 5 px per char -> 20 chars per line
  it("wraps greedily at word boundaries", () => {
    expect(wrapMemeText("AAAA BBBB CCCC DDDD EEEE", 100, 10, mono)).toEqual([
      "AAAA BBBB CCCC DDDD",
      "EEEE",
    ]);
  });

  it("splits a word wider than the line into pieces", () => {
    expect(wrapMemeText("X".repeat(25), 100, 10, mono)).toEqual(["X".repeat(20), "X".repeat(5)]);
    expect(wrapMemeText(`AB ${"X".repeat(25)}`, 100, 10, mono)).toEqual([
      "AB",
      "X".repeat(20),
      "X".repeat(5),
    ]);
  });

  it("honours manual line breaks including empty lines", () => {
    expect(wrapMemeText("A\n\nB", 100, 10, mono)).toEqual(["A", "", "B"]);
  });

  it("treats an invalid width as unlimited and empty text as no lines", () => {
    expect(wrapMemeText("A B C", 0, 10, mono)).toEqual(["A B C"]);
    expect(wrapMemeText("", 100, 10, mono)).toEqual([]);
  });
});

describe("layoutMemeCaption", () => {
  it("places a short top caption (hand-computed)", () => {
    // size = round(500*0.1) = 50, padY = 500*0.035 = 17.5, y = 17.5 + 50*0.86 = 60.5
    const r = layoutMemeCaption("hello", mono, { width: 500, height: 500, position: "top" });
    expect(r.empty).toBe(false);
    expect(r.fontSizePx).toBe(50);
    expect(r.x).toBe(250);
    expect(r.lines).toEqual([{ text: "HELLO", width: 125, y: 60.5 }]);
    expect(r.blockHeight).toBeCloseTo(56); // 1 line * 50 * 1.12
    expect(r.strokeWidthPx).toBeCloseTo(50 / 12);
  });

  it("anchors a bottom caption to the bottom edge", () => {
    // y = 500 - 17.5 - 0 - 50*0.2 = 472.5
    const r = layoutMemeCaption("hello", mono, { width: 500, height: 500, position: "bottom" });
    expect(r.lines[0].y).toBe(472.5);
  });

  it("shrinks the font until the block fits the line budget and 45% of the height", () => {
    const text = "word ".repeat(60);
    const r = layoutMemeCaption(text, mono, { width: 400, height: 300, position: "top" });
    expect(r.fontSizePx).toBeLessThan(30);
    expect(r.fontSizePx).toBeGreaterThanOrEqual(10);
    if (r.fontSizePx > 10) {
      expect(r.lines.length).toBeLessThanOrEqual(4);
      expect(r.blockHeight).toBeLessThanOrEqual(300 * 0.45);
    }
    // Lines are evenly spaced downwards.
    expect(r.lines[1].y - r.lines[0].y).toBeCloseTo(r.fontSizePx * 1.12);
  });

  it("never goes below the minimum font size", () => {
    const r = layoutMemeCaption("x ".repeat(500), mono, {
      width: 200,
      height: 100,
      position: "bottom",
      minFontSizePx: 12,
    });
    expect(r.fontSizePx).toBe(12);
  });

  it("returns the empty layout for blank captions and survives NaN sizes", () => {
    expect(layoutMemeCaption("  ", mono, { width: 100, height: 100, position: "top" }).empty).toBe(
      true,
    );
    const r = layoutMemeCaption("a", mono, {
      width: Number.NaN,
      height: Number.NaN,
      position: "top",
    });
    expect(r.empty).toBe(false);
    expect(r.fontSizePx).toBe(10);
  });
});

describe("memeFontString / fitWithin", () => {
  it("builds a bold font shorthand with an Impact fallback", () => {
    expect(memeFontString(31.6, "  ")).toBe("bold 32px Impact, sans-serif");
    expect(memeFontString(0, "Arial")).toBe("bold 1px Arial");
  });

  it("scales the longest side down to maxSide", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500, scale: 0.5 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
    expect(fitWithin(0, Number.NaN)).toEqual({ width: 1, height: 1, scale: 1 });
  });
});

describe("memeFileName", () => {
  it("slugs the caption", () => {
    expect(memeFileName("Top text!", "cat.jpg")).toBe("top-text-meme.png");
    expect(memeFileName("Привет,  Мир", "cat.jpg")).toBe("привет-мир-meme.png");
  });

  it("falls back to the source name, then to 'meme'", () => {
    expect(memeFileName("", "My Cat.JPG")).toBe("my-cat-meme.png");
    expect(memeFileName("", "")).toBe("meme-meme.png");
  });

  it("caps the caption part at 40 characters without a trailing dash", () => {
    const name = memeFileName(`${"a".repeat(39)} bcd`);
    expect(name).toBe(`${"a".repeat(39)}-meme.png`);
  });
});
