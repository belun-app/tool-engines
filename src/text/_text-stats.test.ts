import { describe, expect, it } from "vitest";
import {
  countLines,
  countParagraphs,
  countVisibleCharacters,
  splitSentences,
  splitWords,
  tallyCharacters,
} from "./_text-stats.js";

describe("tallyCharacters", () => {
  it("returns zeros for an empty string", () => {
    expect(tallyCharacters("")).toEqual({
      characters: 0,
      charactersNoSpaces: 0,
      letters: 0,
      cyrillic: 0,
      latin: 0,
      digits: 0,
      spaces: 0,
      punctuation: 0,
    });
  });

  it("splits mixed Cyrillic and Latin text into its classes", () => {
    expect(tallyCharacters("Привет, world 42!")).toEqual({
      characters: 17,
      charactersNoSpaces: 15,
      letters: 11,
      cyrillic: 6,
      latin: 5,
      digits: 2,
      spaces: 2,
      punctuation: 2,
    });
  });

  it("counts Ё/ё and Cyrillic letters outside the basic Russian block as Cyrillic", () => {
    const t = tallyCharacters("Ёлка ёж їжак");
    expect(t.cyrillic).toBe(10);
    expect(t.latin).toBe(0);
    expect(t.letters).toBe(10);
    expect(t.spaces).toBe(2);
  });

  it("counts accented Latin letters as Latin and other scripts as plain letters", () => {
    const t = tallyCharacters("café 日本 αβ");
    expect(t.latin).toBe(4);
    expect(t.cyrillic).toBe(0);
    expect(t.letters).toBe(8);
    expect(t.punctuation).toBe(0);
  });

  it("treats tabs, newlines, NBSP and thin spaces as whitespace", () => {
    const t = tallyCharacters("a\tb\nc d e\r\n");
    expect(t.spaces).toBe(6);
    expect(t.latin).toBe(5);
    expect(t.characters).toBe(11);
    expect(t.charactersNoSpaces).toBe(5);
  });

  it("counts non-ASCII decimal digits as digits", () => {
    const t = tallyCharacters("٣٤ ४");
    expect(t.digits).toBe(3);
    expect(t.punctuation).toBe(0);
  });

  it("counts code points, so an emoji with a skin tone is two", () => {
    expect(tallyCharacters("👋").characters).toBe(1);
    expect(tallyCharacters("👋🏽").characters).toBe(2);
    expect(tallyCharacters("👋").punctuation).toBe(1);
  });

  it("keeps combining marks out of the punctuation count", () => {
    const t = tallyCharacters("моло́ко");
    expect(t.characters).toBe(7);
    expect(t.cyrillic).toBe(6);
    expect(t.punctuation).toBe(0);
  });

  it("counts a lone surrogate as one character", () => {
    expect(tallyCharacters("a\ud83d").characters).toBe(2);
    expect(tallyCharacters("\ud83da").characters).toBe(2);
  });

  it("gives the same answer when a code point is seen again (cached classification)", () => {
    const first = tallyCharacters("ßßß—");
    const second = tallyCharacters("ßßß—");
    expect(second).toEqual(first);
    expect(first.latin).toBe(3);
    expect(first.punctuation).toBe(1);
  });
});

describe("countVisibleCharacters", () => {
  it("returns zeros for an empty string", () => {
    expect(countVisibleCharacters("")).toEqual({ characters: 0, charactersNoSpaces: 0 });
  });

  it("counts plain Latin and Cyrillic text unit by unit", () => {
    expect(countVisibleCharacters("abc где")).toEqual({ characters: 7, charactersNoSpaces: 6 });
  });

  it("counts CR LF as a single whitespace cluster", () => {
    expect(countVisibleCharacters("a\r\nb")).toEqual({ characters: 3, charactersNoSpaces: 2 });
    expect(countVisibleCharacters("a\rb\nc")).toEqual({ characters: 5, charactersNoSpaces: 3 });
  });

  it("treats NBSP and NEL as whitespace", () => {
    expect(countVisibleCharacters("a b\u0085")).toEqual({
      characters: 4,
      charactersNoSpaces: 2,
    });
  });

  it("joins a combining accent to the letter before it", () => {
    expect(countVisibleCharacters("é")).toEqual({ characters: 1, charactersNoSpaces: 1 });
    expect(countVisibleCharacters("моло́ко")).toEqual({
      characters: 6,
      charactersNoSpaces: 6,
    });
  });

  it("counts a combining mark on a space as a visible character", () => {
    expect(countVisibleCharacters(" ́")).toEqual({ characters: 1, charactersNoSpaces: 1 });
  });

  it("counts a leading combining mark as its own cluster", () => {
    expect(countVisibleCharacters("́a")).toEqual({ characters: 2, charactersNoSpaces: 2 });
  });

  it("counts emoji sequences as one character each", () => {
    expect(countVisibleCharacters("👋🏽").characters).toBe(1);
    expect(countVisibleCharacters("🇩🇪").characters).toBe(1);
    expect(countVisibleCharacters("👨‍👩‍👧").characters).toBe(1);
    expect(countVisibleCharacters("👋👋").characters).toBe(2);
  });

  it("keeps a space before an emoji counted as a space", () => {
    expect(countVisibleCharacters("hi 👋 there")).toEqual({
      characters: 10,
      charactersNoSpaces: 8,
    });
  });

  it("counts whitespace outside the simple range, such as the ideographic space", () => {
    expect(countVisibleCharacters("a　b")).toEqual({ characters: 3, charactersNoSpaces: 2 });
  });

  it("counts CJK characters one per cluster", () => {
    expect(countVisibleCharacters("日本語")).toEqual({ characters: 3, charactersNoSpaces: 3 });
  });

  it("does not count Cyrillic combining marks as separate characters", () => {
    // U+0483 (titlo) is a combining mark inside the Cyrillic block.
    expect(countVisibleCharacters("г҃д").characters).toBe(2);
  });
});

describe("splitWords", () => {
  it("returns nothing for empty or blank text", () => {
    expect(splitWords("")).toEqual([]);
    expect(splitWords(" \n\t ")).toEqual([]);
  });

  it("splits on any run of whitespace", () => {
    expect(splitWords("  one  two\tthree\nчетыре ")).toEqual(["one", "two", "three", "четыре"]);
  });

  it("keeps hyphenated words whole and splits space-grouped numbers", () => {
    expect(splitWords("state-of-the-art")).toEqual(["state-of-the-art"]);
    expect(splitWords("1 200")).toEqual(["1", "200"]);
  });

  it("splits on non-breaking spaces too", () => {
    expect(splitWords("a b")).toEqual(["a", "b"]);
  });
});

describe("splitSentences", () => {
  it("returns nothing for empty or blank text", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
    expect(splitSentences("...")).toEqual([]);
  });

  it("splits at full stops, question and exclamation marks", () => {
    const s = splitSentences("Hi. How are you? Fine!");
    expect(s.map((x) => x.trim())).toEqual(["Hi", "How are you", "Fine"]);
  });

  it("treats a run of terminators and the ellipsis character as one boundary", () => {
    expect(splitSentences("Wait... what?!").map((x) => x.trim())).toEqual(["Wait", "what"]);
    expect(splitSentences("Ну… ладно").map((x) => x.trim())).toEqual(["Ну", "ладно"]);
  });

  it("counts text without a final terminator as a sentence", () => {
    expect(splitSentences("Привет. Как дела")).toHaveLength(2);
    expect(splitSentences("no terminator")).toHaveLength(1);
  });

  it("does not split at decimal points or version numbers", () => {
    expect(splitSentences("It weighs 3.5 kg. Version 1.2.3 is out.")).toHaveLength(2);
  });

  it("still splits after a number that ends a sentence", () => {
    expect(splitSentences("I have 3. You have 4.")).toHaveLength(2);
  });
});

describe("countParagraphs", () => {
  it("returns 0 for empty or blank text", () => {
    expect(countParagraphs("")).toBe(0);
    expect(countParagraphs("\n\n  \n")).toBe(0);
  });

  it("counts blocks separated by a blank line", () => {
    expect(countParagraphs("one\ntwo")).toBe(1);
    expect(countParagraphs("one\n\ntwo")).toBe(2);
    expect(countParagraphs("one\n   \n\n\ntwo\n\nthree\n\n")).toBe(3);
  });

  it("handles Windows line endings", () => {
    expect(countParagraphs("one\r\n\r\ntwo")).toBe(2);
  });
});

describe("countLines", () => {
  it("returns 0 for empty text", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("\n\n")).toBe(0);
  });

  it("counts non-blank lines with any line ending", () => {
    expect(countLines("a\nb\r\nc\rd")).toBe(4);
  });

  it("skips blank and whitespace-only lines", () => {
    expect(countLines("a\n\n   \nb\n")).toBe(2);
  });
});
