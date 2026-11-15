import { describe, expect, it } from "vitest";
import {
  MAX_OUTPUT_CHARACTERS,
  MAX_REPETITIONS,
  expandEscapes,
  repeatText,
} from "./text-repeater.js";

describe("expandEscapes", () => {
  it("expands \\n, \\r, \\t and \\\\ and leaves other escapes alone", () => {
    expect(expandEscapes("a\\nb\\tc\\rd\\\\e\\qf")).toBe("a\nb\tc\rd\\e\\qf");
  });
});

describe("repeatText", () => {
  it("returns the empty result for empty input or an invalid count", () => {
    const empty = {
      text: "",
      repetitions: 0,
      characters: 0,
      charactersNoSpaces: 0,
      words: 0,
      lines: 0,
      truncated: false,
    };
    expect(repeatText("", { count: 5 })).toEqual(empty);
    for (const count of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 0.9]) {
      expect(repeatText("x", { count })).toEqual(empty);
    }
  });

  it("repeats with no separator by default", () => {
    const r = repeatText("ab", { count: 3 });
    expect(r.text).toBe("ababab");
    expect(r.repetitions).toBe(3);
    expect(r.characters).toBe(6);
    expect(r.words).toBe(1);
    expect(r.lines).toBe(1);
  });

  it("floors fractional counts", () => {
    expect(repeatText("a", { count: 2.9 }).repetitions).toBe(2);
  });

  it("expands an escaped newline separator into real line breaks", () => {
    const r = repeatText("hi there", { count: 3, separator: "\\n" });
    expect(r.text).toBe("hi there\nhi there\nhi there");
    expect(r.lines).toBe(3);
    expect(r.words).toBe(6);
    // 3 * 7 non-space chars
    expect(r.charactersNoSpaces).toBe(21);
  });

  it("numbers each copy", () => {
    expect(repeatText("x", { count: 3, separator: ", ", numbered: true }).text).toBe(
      "1. x, 2. x, 3. x",
    );
  });

  it("adds a trailing separator only when asked and the separator is non-empty", () => {
    expect(repeatText("a", { count: 2, separator: "-", trailingSeparator: true }).text).toBe(
      "a-a-",
    );
    expect(repeatText("a", { count: 2, trailingSeparator: true }).text).toBe("aa");
  });

  it("repeats Cyrillic and emoji", () => {
    expect(repeatText("Да👍", { count: 2, separator: " " }).text).toBe("Да👍 Да👍");
  });

  it("clamps the count to MAX_REPETITIONS", () => {
    const r = repeatText("a", { count: MAX_REPETITIONS * 2 });
    expect(r.repetitions).toBe(MAX_REPETITIONS);
    expect(r.text.length).toBe(MAX_REPETITIONS);
    expect(r.truncated).toBe(false);
  });

  it("stops at MAX_OUTPUT_CHARACTERS and flags truncation (no trailing separator then)", () => {
    // 1000-char chunk, no separator: exactly 2000 copies fit in 2,000,000 chars
    const input = "x".repeat(1000);
    const r = repeatText(input, { count: 3000, separator: "", trailingSeparator: true });
    expect(r.repetitions).toBe(MAX_OUTPUT_CHARACTERS / 1000);
    expect(r.characters).toBe(MAX_OUTPUT_CHARACTERS);
    expect(r.truncated).toBe(true);
  });
});
