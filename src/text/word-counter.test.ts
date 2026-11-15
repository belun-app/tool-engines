import { describe, expect, it } from "vitest";
import { segmentGraphemes } from "../_graphemes.js";
import { countCharacters } from "./character-counter.js";
import { countWords, minutesFor, readingNorms, targetProgress } from "./word-counter.js";

describe("countWords", () => {
  it("returns the all-zero result for empty input", () => {
    const r = countWords("");
    expect(r.words).toBe(0);
    expect(r.characters).toBe(0);
    expect(r.sentences).toBe(0);
    expect(r.readingTimeMinutes).toBe(0);
    expect(r.speakingTimeMinutes).toBe(0);
    expect(r.averageWordLength).toBe(0);
  });

  it("counts characters and spaces in whitespace-only text, but no words", () => {
    const r = countWords("   \n  ");
    expect(r.words).toBe(0);
    expect(r.characters).toBe(6);
    expect(r.spaces).toBe(6);
    expect(r.charactersNoSpaces).toBe(0);
    expect(r.sentences).toBe(0);
    expect(r.lines).toBe(0);
    expect(r.readingTimeMinutes).toBe(0);
  });

  it("returns a fresh object for empty input (no shared mutable EMPTY)", () => {
    const a = countWords("");
    a.words = 99;
    expect(countWords("").words).toBe(0);
  });

  it("counts a simple English text (hand-counted)", () => {
    const r = countWords("Hello world. This is a test!");
    expect(r.words).toBe(6);
    expect(r.characters).toBe(28);
    expect(r.charactersNoSpaces).toBe(23);
    expect(r.spaces).toBe(5);
    expect(r.sentences).toBe(2);
    expect(r.paragraphs).toBe(1);
    expect(r.lines).toBe(1);
    expect(r.letters).toBe(21);
    expect(r.latin).toBe(21);
    expect(r.cyrillic).toBe(0);
    expect(r.digits).toBe(0);
    expect(r.punctuation).toBe(2);
    expect(r.uniqueWords).toBe(6);
    // hel-lo(2) world(1) this(1) is(1) a(1) test(1)
    expect(r.syllables).toBe(7);
    expect(r.longestSentenceWords).toBe(4);
    expect(r.averageWordLength).toBe(3.5);
    expect(r.averageSentenceWords).toBe(3);
    expect(r.readingTimeMinutes).toBe(1);
    expect(r.speakingTimeMinutes).toBe(1);
  });

  it("counts Cyrillic letters and Russian syllables (one per vowel)", () => {
    const r = countWords("Молоко и ёж.");
    expect(r.words).toBe(3);
    expect(r.cyrillic).toBe(9);
    expect(r.latin).toBe(0);
    expect(r.letters).toBe(9);
    // мо-ло-ко(3) и(1) ёж(1)
    expect(r.syllables).toBe(5);
    expect(r.sentences).toBe(1);
  });

  it("does not split sentences on a decimal point", () => {
    expect(countWords("It weighs 3.5 kg. Then 2.25 more.").sentences).toBe(2);
  });

  it("treats runs of terminal punctuation as one sentence end", () => {
    expect(countWords("Really?! Yes... Ok.").sentences).toBe(3);
  });

  it("counts text with no terminal punctuation as one sentence", () => {
    expect(countWords("no punctuation here").sentences).toBe(1);
  });

  it("counts paragraphs separated by blank lines and non-empty lines", () => {
    const r = countWords("Line one\nline two\n\n  \nThird para\r\nfourth line");
    expect(r.paragraphs).toBe(2);
    expect(r.lines).toBe(4);
    expect(r.words).toBe(8);
  });

  it("counts unique words case-insensitively with punctuation stripped", () => {
    expect(countWords("The cat, the CAT. the cat!").uniqueWords).toBe(2);
  });

  it("drops a silent trailing e in English syllables but keeps one syllable minimum", () => {
    // make = 1 (a-e, trailing e dropped), the = 1 (minimum one), rhythm = 1 (y)
    expect(countWords("make").syllables).toBe(1);
    expect(countWords("the").syllables).toBe(1);
    expect(countWords("rhythm").syllables).toBe(1);
    // A token without letters has no syllables.
    expect(countWords("123").syllables).toBe(0);
  });

  it("uses the Words to Minutes norms: 238 wpm EN / 184 wpm RU silent, 140 wpm aloud", () => {
    expect(readingNorms("en")).toEqual({ readingWpm: 238, speakingWpm: 140 });
    expect(readingNorms("ru")).toEqual({ readingWpm: 184, speakingWpm: 140 });
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect(countWords(words(238)).readingTimeMinutes).toBe(1);
    expect(countWords(words(239)).readingTimeMinutes).toBe(2);
    expect(countWords(words(184), "ru").readingTimeMinutes).toBe(1);
    expect(countWords(words(185), "ru").readingTimeMinutes).toBe(2);
    expect(countWords(words(140)).speakingTimeMinutes).toBe(1);
    expect(countWords(words(141), "ru").speakingTimeMinutes).toBe(2);
    expect(minutesFor(0, 238)).toBe(0);
    expect(minutesFor(1, 238)).toBe(1);
  });

  it("counts digits and averages word length over letters and digits", () => {
    const r = countWords("abc 12345");
    expect(r.digits).toBe(5);
    expect(r.averageWordLength).toBe(4);
  });

  it("does not throw on a large input", () => {
    const big = "lorem ipsum dolor. ".repeat(20000);
    expect(countWords(big).words).toBe(60000);
  });

  it("counts an emoji as one character", () => {
    const r = countWords("hi 👍");
    expect(r.characters).toBe(4);
    expect(r.punctuation).toBe(1);
  });

  // Regression: characters became code points, so 👋🏽 counted as two and a decomposed
  // "é" as two, with the accent counted as punctuation.
  it("counts visible characters: one per emoji or accented letter", () => {
    const r = countWords("Hi 👋 there");
    expect(r.characters).toBe(10);
    expect(r.punctuation).toBe(1);
    const toned = countWords("Hi 👋🏽 there");
    expect(toned.characters).toBe(10);
    expect(toned.charactersNoSpaces).toBe(8);
    expect(countWords("👨‍👩‍👧 🇷🇺").characters).toBe(3);
    const accented = countWords("cafe\u0301 моло\u0301ко");
    expect(accented.characters).toBe(11);
    expect(accented.charactersNoSpaces).toBe(10);
    expect(accented.punctuation).toBe(0);
    expect(accented.letters).toBe(10);
    expect(accented.averageWordLength).toBe(5);
  });

  it("counts CR LF as one whitespace character", () => {
    const r = countWords("a\r\nb");
    expect(r.characters).toBe(3);
    expect(r.charactersNoSpaces).toBe(2);
  });

  it("ends a sentence at the ellipsis character", () => {
    expect(countWords("Подожди… Я иду.").sentences).toBe(2);
  });

  it("does not split a sentence inside a version number", () => {
    expect(countWords("Version 1.2.3 is out. Update now.").sentences).toBe(2);
    expect(countWords("Version 1.2.3 is out. Update now.").longestSentenceWords).toBe(4);
  });

  it("agrees with the character counter on every shared figure", () => {
    for (const text of [
      "Hi 👋🏽 there… Version 1.2.3 is out!\n\nNext   paragraph\r\nline",
      "   \n  ",
      "Москва — столица. Ёж 3.5 кг?!",
      // The fast path must match whole-text segmentation at every simple/complex seam.
      " ́x é\r\ń 1️⃣ 👨‍👩‍👧🇷🇺 ё ñ 한국어 नमस्ते 👋🏽a",
      "́́start a҃b",
    ]) {
      const w = countWords(text);
      const c = countCharacters(text);
      // The word counter prints visible characters, the character counter's "Visible".
      expect(w.characters, `characters of ${JSON.stringify(text)}`).toBe(c.graphemes);
      const nonSpace = segmentGraphemes(text).filter((g) => !/^\s+$/u.test(g)).length;
      expect(w.charactersNoSpaces, `no spaces of ${JSON.stringify(text)}`).toBe(nonSpace);
      for (const key of [
        "letters",
        "cyrillic",
        "latin",
        "digits",
        "spaces",
        "punctuation",
        "words",
        "sentences",
        "paragraphs",
        "lines",
      ] as const) {
        expect(w[key], `${key} of ${JSON.stringify(text)}`).toBe(c[key]);
      }
    }
  });

  it("counts a 1 MB text", () => {
    const big = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(18000);
    const r = countWords(big);
    expect(r.words).toBe(144000);
    expect(r.sentences).toBe(18000);
  });
});

describe("targetProgress", () => {
  const r = countWords("one two three four");

  it("returns null without a positive target", () => {
    expect(targetProgress(r, 0, "words")).toBeNull();
    expect(targetProgress(r, Number.NaN, "words")).toBeNull();
  });

  it("counts what is left in the chosen unit", () => {
    expect(targetProgress(r, 10, "words")).toEqual({
      used: 4,
      left: 6,
      percent: 40,
      over: false,
      reached: false,
    });
    expect(targetProgress(r, 18, "characters")?.left).toBe(0);
    expect(targetProgress(r, 18, "characters")?.reached).toBe(true);
    expect(targetProgress(r, 10, "noSpaces")).toMatchObject({ used: 15, left: -5, over: true });
    expect(targetProgress(r, 10, "noSpaces")?.percent).toBe(100);
  });
});
