import { describe, expect, it } from "vitest";
import {
  graphemeLength,
  segmentGraphemes,
  segmentGraphemesFallback,
  sliceGraphemes,
} from "./_graphemes.js";

const CASES: Array<[string, string[]]> = [
  ["abc", ["a", "b", "c"]],
  ["ёж", ["ё", "ж"]],
  ["моло\u0301ко", ["м", "о", "л", "о\u0301", "к", "о"]],
  ["e\u0301", ["e\u0301"]],
  ["👍🏽ok", ["👍🏽", "o", "k"]],
  ["🇧🇬🇧🇾", ["🇧🇬", "🇧🇾"]],
  ["a👨\u200d👩\u200d👧", ["a", "👨\u200d👩\u200d👧"]],
  ["❤\ufe0f ok", ["❤\ufe0f", " ", "o", "k"]],
  ["1\ufe0f\u20e3", ["1\ufe0f\u20e3"]],
  ["🚀 Rocket", ["🚀", " ", "R", "o", "c", "k", "e", "t"]],
  ["a\r\nb", ["a", "\r\n", "b"]],
];

describe("segmentGraphemes", () => {
  it.each(CASES)("%s", (text, expected) => {
    expect(segmentGraphemes(text)).toEqual(expected);
  });

  it("returns [] for empty text", () => {
    expect(segmentGraphemes("")).toEqual([]);
  });
});

describe("segmentGraphemesFallback (no Intl.Segmenter)", () => {
  it.each(CASES)("%s", (text, expected) => {
    expect(segmentGraphemesFallback(text)).toEqual(expected);
  });

  it("never splits a surrogate pair", () => {
    for (const g of segmentGraphemesFallback("𝒜🙂𐐷")) {
      expect(g.length).toBe(2);
    }
  });
});

describe("graphemeLength / sliceGraphemes", () => {
  it("counts what a reader counts", () => {
    expect(graphemeLength("👍🏽 моло\u0301ко 🇧🇬")).toBe(10);
    expect(graphemeLength("")).toBe(0);
  });

  it("slices without breaking clusters", () => {
    expect(sliceGraphemes("👍🏽🇧🇬abc", 2)).toBe("👍🏽🇧🇬");
    expect(sliceGraphemes("abc", 0)).toBe("");
  });
});
