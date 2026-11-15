import { describe, expect, it } from "vitest";
import { sortLines } from "./text-line-sorter.js";

const out = (text: string, o: Parameters<typeof sortLines>[1]) => sortLines(text, o).output;

describe("sortLines", () => {
  it("returns the empty result for empty input", () => {
    expect(sortLines("", { mode: "alpha-asc" })).toEqual({
      output: "",
      inputLines: 0,
      outputLines: 0,
      duplicatesRemoved: 0,
      emptyRemoved: 0,
    });
  });

  it("sorts alphabetically, case-insensitive by default", () => {
    expect(out("banana\nApple\ncherry", { mode: "alpha-asc" })).toBe("Apple\nbanana\ncherry");
    expect(out("banana\nApple\ncherry", { mode: "alpha-desc" })).toBe("cherry\nbanana\nApple");
  });

  it("sorts Cyrillic alphabetically", () => {
    expect(out("яблоко\nабрикос\nвишня", { mode: "alpha-asc" })).toBe("абрикос\nвишня\nяблоко");
  });

  it("sorts by length with alphabetical tie-break", () => {
    expect(out("ccc\nb\naa\nbb", { mode: "length-asc" })).toBe("b\naa\nbb\nccc");
    expect(out("ccc\nb\naa\nbb", { mode: "length-desc" })).toBe("ccc\naa\nbb\nb");
  });

  it("sorts numerically by the first number, lines without numbers last in both directions", () => {
    const text = "item 10\nnone\nitem 2\nitem -1.5\nitem 1,75";
    expect(out(text, { mode: "numeric-asc" })).toBe("item -1.5\nitem 1,75\nitem 2\nitem 10\nnone");
    expect(out(text, { mode: "numeric-desc" })).toBe("item 10\nitem 2\nitem 1,75\nitem -1.5\nnone");
  });

  it("reverses line order", () => {
    expect(out("1\n3\n2", { mode: "reverse" })).toBe("2\n3\n1");
  });

  it("removes duplicates case-insensitively unless caseSensitive", () => {
    const r = sortLines("a\nA\nb\na", { mode: "alpha-asc", removeDuplicates: true });
    expect(r.output).toBe("a\nb");
    expect(r.duplicatesRemoved).toBe(2);
    const cs = sortLines("a\nA\nb\na", {
      mode: "alpha-asc",
      removeDuplicates: true,
      caseSensitive: true,
    });
    expect(cs.duplicatesRemoved).toBe(1);
    expect(cs.outputLines).toBe(3);
  });

  it("trims lines and removes empty ones, counting them", () => {
    const r = sortLines("  b \r\n\n   \na", {
      mode: "alpha-asc",
      trimLines: true,
      removeEmpty: true,
    });
    expect(r.output).toBe("a\nb");
    expect(r.inputLines).toBe(4);
    expect(r.emptyRemoved).toBe(2);
    expect(r.outputLines).toBe(2);
  });

  it("falls back to alphabetical for an unknown mode", () => {
    expect(out("b\na", { mode: "bogus" as never })).toBe("a\nb");
  });

  it("sorts alphabetically ascending when options are left out", () => {
    expect(sortLines("b\na\nc").output).toBe("a\nb\nc");
    expect(sortLines("b\na", {}).output).toBe("a\nb");
  });

  it("returns the empty result for non-string input", () => {
    for (const bad of [undefined, null, 42, ["a"]]) {
      expect(sortLines(bad as unknown as string).outputLines).toBe(0);
    }
  });

  it("compares letters by the given locale", () => {
    // Swedish puts ä after z; German sorts it with a.
    expect(out("ä\nz\na", { mode: "alpha-asc", locale: "sv" })).toBe("a\nz\nä");
    expect(out("ä\nz\na", { mode: "alpha-asc", locale: "de" })).toBe("a\nä\nz");
  });

  it("falls back to the default locale for an invalid locale tag", () => {
    expect(out("b\na", { mode: "alpha-asc", locale: "not a locale!" })).toBe("a\nb");
  });
});
