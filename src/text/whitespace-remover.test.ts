import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPTIONS,
  type WhitespaceOptions,
  cleanWhitespace,
  measure,
  removeWhitespace,
} from "./whitespace-remover.js";

const NONE: WhitespaceOptions = {
  collapseSpaces: false,
  trimLines: false,
  removeEmptyLines: false,
  collapseBlankLines: false,
  removeAllWhitespace: false,
  tabsToSpaces: false,
  normalizeUnicode: false,
  fixPunctuation: false,
  joinLines: false,
};
const opts = (o: Partial<WhitespaceOptions>) => ({ ...NONE, ...o });

describe("measure", () => {
  it("returns zeroes for empty text", () => {
    expect(measure("")).toEqual({ characters: 0, words: 0, lines: 0, whitespace: 0 });
  });

  it("counts characters, words, lines and whitespace", () => {
    // "a b\n c" -> 6 chars, 3 words, 2 lines, whitespace: " ", "\n", " " = 3
    expect(measure("a b\n c")).toEqual({ characters: 6, words: 3, lines: 2, whitespace: 3 });
  });

  it("counts zero words for whitespace-only text", () => {
    expect(measure("  \n ").words).toBe(0);
  });
});

describe("cleanWhitespace", () => {
  it("returns empty string for empty input", () => {
    expect(cleanWhitespace("", DEFAULT_OPTIONS)).toBe("");
  });

  it("with every option off only normalises line endings", () => {
    expect(cleanWhitespace("a  b\r\nc\rd", NONE)).toBe("a  b\nc\nd");
  });

  it("collapses runs of spaces and tabs inside a line but keeps newlines", () => {
    expect(cleanWhitespace("a  \t b\n\nc", opts({ collapseSpaces: true }))).toBe("a b\n\nc");
  });

  it("trims every line", () => {
    expect(cleanWhitespace("  a  \n\tb\t", opts({ trimLines: true }))).toBe("a\nb");
  });

  it("removes empty and whitespace-only lines", () => {
    expect(cleanWhitespace("a\n\n  \nb\n", opts({ removeEmptyLines: true }))).toBe("a\nb");
  });

  it("collapses 2+ blank lines down to one blank line", () => {
    expect(cleanWhitespace("a\n\n\n\nb", opts({ collapseBlankLines: true }))).toBe("a\n\nb");
    expect(cleanWhitespace("a\n \n\t\nb", opts({ collapseBlankLines: true }))).toBe("a\n\nb");
    // a single newline is left alone
    expect(cleanWhitespace("a\nb", opts({ collapseBlankLines: true }))).toBe("a\nb");
  });

  it("removeEmptyLines takes precedence over collapseBlankLines", () => {
    expect(
      cleanWhitespace("a\n\n\nb", opts({ removeEmptyLines: true, collapseBlankLines: true })),
    ).toBe("a\nb");
  });

  it("removes all whitespace and short-circuits other rules", () => {
    expect(
      cleanWhitespace(" a b\n\tc ", opts({ removeAllWhitespace: true, trimLines: true })),
    ).toBe("abc");
  });

  it("converts tabs to single spaces", () => {
    expect(cleanWhitespace("a\t\tb", opts({ tabsToSpaces: true }))).toBe("a  b");
  });

  it("replaces Unicode spaces with a space and deletes zero-width characters", () => {
    // NBSP, thin space U+2009, narrow NBSP U+202F, ideographic U+3000 -> " "; ZWSP, BOM -> ""
    const input = "a b c d　e​f﻿g";
    expect(cleanWhitespace(input, opts({ normalizeUnicode: true }))).toBe("a b c d efg");
    expect(cleanWhitespace(input, opts({ normalizeUnicode: true }))).not.toMatch(/[​﻿]/);
  });

  it("handles all 17 space-like code points listed on the page", () => {
    const spaces = [
      0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009,
      0x200a, 0x202f, 0x205f, 0x3000, 0x180e,
    ];
    for (const cp of spaces) {
      expect(
        cleanWhitespace(`x${String.fromCodePoint(cp)}y`, opts({ normalizeUnicode: true })),
      ).toBe("x y");
    }
    for (const cp of [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]) {
      expect(
        cleanWhitespace(`x${String.fromCodePoint(cp)}y`, opts({ normalizeUnicode: true })),
      ).toBe("xy");
    }
  });

  it("leaves Unicode spaces alone when normalisation is off", () => {
    expect(cleanWhitespace("a​b", NONE)).toBe("a​b");
  });

  it("applies the default options (collapse, trim, collapse blank lines, unicode)", () => {
    const input = "  Hello   world  \n\n\n\n  Привет  мир 👋  ";
    expect(cleanWhitespace(input, DEFAULT_OPTIONS)).toBe("Hello world\n\nПривет мир 👋");
  });

  // Regression: collapsing matched a single NBSP, so unticking "Fix invisible Unicode spaces"
  // still turned every typographic non-breaking space into a plain one.
  it("keeps single non-breaking spaces and a BOM when normalisation is off", () => {
    const off = { ...DEFAULT_OPTIONS, normalizeUnicode: false };
    expect(cleanWhitespace("10\u00a0км  и  1\u202f500\u00a0₽", off)).toBe(
      "10\u00a0км и 1\u202f500\u00a0₽",
    );
    expect(cleanWhitespace("x\ufeffy", off)).toBe("x\ufeffy");
    // A run that contains a non-breaking space is still a double space.
    expect(cleanWhitespace("a\u00a0 b", off)).toBe("a b");
    // A lone tab still becomes a space, as before.
    expect(cleanWhitespace("a\tb", opts({ collapseSpaces: true }))).toBe("a b");
  });

  // Regression: every U+200D and U+200C was deleted, breaking 👩‍💻 and Persian words.
  it("keeps emoji ZWJ sequences and a ZWNJ inside a Persian word", () => {
    const tech = "\u{1F469}\u200d\u{1F4BB}";
    const flag = "\u{1F3F3}\ufe0f\u200d\u{1F308}";
    const toned = "\u{1F469}\u{1F3FD}\u200d\u{1F4BB}";
    expect(cleanWhitespace(`dev  ${tech} ${flag} ${toned}`, DEFAULT_OPTIONS)).toBe(
      `dev ${tech} ${flag} ${toned}`,
    );
    const persian = "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645";
    expect(cleanWhitespace(persian, DEFAULT_OPTIONS)).toBe(persian);
    // Stray joiners next to Latin or Cyrillic letters are still removed.
    expect(cleanWhitespace("Acme\u200dLtd \u0414\u200c\u0430", DEFAULT_OPTIONS)).toBe(
      "AcmeLtd \u0414\u0430",
    );
  });

  // Regression: trimming was per line only, so blank lines at the edges survived.
  it("drops blank lines at the start and end of the text when trimming", () => {
    expect(cleanWhitespace("\n\n\nTitle\n\nBody\n\n\n", DEFAULT_OPTIONS)).toBe("Title\n\nBody");
    expect(cleanWhitespace("   \n\t\n  ", DEFAULT_OPTIONS)).toBe("");
    expect(cleanWhitespace("\n\nx\n", opts({ collapseSpaces: true }))).toBe("\n\nx\n");
  });

  it("removes spaces before punctuation and inside brackets and guillemets", () => {
    const fix = { ...DEFAULT_OPTIONS, fixPunctuation: true };
    expect(cleanWhitespace("слово , слово ; ( текст ) « цитата » ! Ну ...", fix)).toBe(
      "слово, слово; (текст) «цитата»! Ну...",
    );
    expect(cleanWhitespace("a , b\n( c", fix)).toBe("a, b\n(c");
    expect(cleanWhitespace("слово , слово", DEFAULT_OPTIONS)).toBe("слово , слово");
  });

  // Regression: ".NET", ".docx" and ":)" were glued to the word before them.
  it("removes the space only when the punctuation ends a word", () => {
    const fix = { ...DEFAULT_OPTIONS, fixPunctuation: true };
    expect(cleanWhitespace("I use .NET and open .docx files :) ok", fix)).toBe(
      "I use .NET and open .docx files :) ok",
    );
    expect(cleanWhitespace("Hi :)", fix)).toBe("Hi :)");
    expect(cleanWhitespace("a ,b and 1 .5", fix)).toBe("a ,b and 1 .5");
    expect(cleanWhitespace("Really ?!\nYes .\n( see above ) . Done ...", fix)).toBe(
      "Really?!\nYes.\n(see above). Done...",
    );
    expect(cleanWhitespace("«цитата » , и всё", fix)).toBe("«цитата», и всё");
  });

  it("joins the lines of a paragraph but keeps paragraph breaks", () => {
    const join = { ...DEFAULT_OPTIONS, joinLines: true };
    expect(cleanWhitespace("one\ntwo  \n  three\n\n\nfour\nfive", join)).toBe(
      "one two three\n\nfour five",
    );
    expect(cleanWhitespace("one\ntwo\n\nthree", { ...join, removeEmptyLines: true })).toBe(
      "one two three",
    );
  });

  it("keeps the indentation of the line after a blank line when trimLines is off", () => {
    expect(cleanWhitespace("x\n\n    y", opts({ collapseBlankLines: true }))).toBe("x\n\n    y");
  });
});

describe("removeWhitespace", () => {
  it("returns zeroed stats for empty input", () => {
    const r = removeWhitespace("");
    expect(r.text).toBe("");
    expect(r.removed).toBe(0);
    expect(r.removedPercent).toBe(0);
    expect(r.before.characters).toBe(0);
  });

  it("reports removed characters and percentage rounded to one decimal", () => {
    // "a   b" (5 chars) -> "a b" (3 chars): removed 2 = 40%
    const r = removeWhitespace("a   b");
    expect(r.text).toBe("a b");
    expect(r.removed).toBe(2);
    expect(r.removedPercent).toBe(40);
    // "a     " (6 chars) -> "a": removed 5/6 = 83.33% -> 83.3
    expect(removeWhitespace("a     ").removedPercent).toBe(83.3);
  });

  it("uses DEFAULT_OPTIONS when no options are given", () => {
    expect(removeWhitespace("  x  ").text).toBe("x");
  });

  it("never reports a negative removal", () => {
    const r = removeWhitespace("abc", NONE);
    expect(r.removed).toBe(0);
    expect(r.removedPercent).toBe(0);
  });
});
