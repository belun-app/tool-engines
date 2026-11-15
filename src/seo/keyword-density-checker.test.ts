import { describe, expect, it } from "vitest";
import { analyzeKeywordDensity } from "./keyword-density-checker.js";

const TEXT = "SEO tools help. SEO tools rank. The best SEO tools.";

describe("analyzeKeywordDensity", () => {
  it("returns empty stats (and keeps character counts) for text without words", () => {
    expect(analyzeKeywordDensity("  ... ")).toEqual({
      totalWords: 0,
      uniqueWords: 0,
      characters: 6,
      charactersNoSpaces: 3,
      sentences: 0,
      oneWord: [],
      twoWord: [],
      threeWord: [],
      target: null,
    });
  });

  it("measures a target even when the text is empty", () => {
    expect(analyzeKeywordDensity("", { target: "seo" }).target).toEqual({
      keyword: "seo",
      count: 0,
      density: 0,
      status: "missing",
    });
  });

  it("counts words, sentences and single-word density (hand-calculated)", () => {
    // tokens: seo tools help seo tools rank the best seo tools = 10
    const r = analyzeKeywordDensity(TEXT);
    expect(r.totalWords).toBe(10);
    expect(r.uniqueWords).toBe(6);
    expect(r.sentences).toBe(3);
    expect(r.characters).toBe(TEXT.length);
    // "the" is a stop word and is dropped; seo/tools 3/10 = 30%, others 1/10 = 10%
    expect(r.oneWord).toEqual([
      { keyword: "seo", count: 3, density: 30, words: 1 },
      { keyword: "tools", count: 3, density: 30, words: 1 },
      { keyword: "best", count: 1, density: 10, words: 1 },
      { keyword: "help", count: 1, density: 10, words: 1 },
      { keyword: "rank", count: 1, density: 10, words: 1 },
    ]);
  });

  it("builds phrases with a default minimum of 2 occurrences", () => {
    const r = analyzeKeywordDensity(TEXT);
    // 9 bigram slots, "seo tools" x3 -> 33.3%
    expect(r.twoWord).toEqual([{ keyword: "seo tools", count: 3, density: 33.3, words: 2 }]);
    // no trigram repeats
    expect(r.threeWord).toEqual([]);
  });

  it("drops phrases that start or end with a stop word, but not ones with one in the middle", () => {
    const r = analyzeKeywordDensity(TEXT, { minCount: 1 });
    const bigrams = r.twoWord.map((e) => e.keyword);
    expect(bigrams).not.toContain("rank the");
    expect(bigrams).not.toContain("the best");
    expect(r.threeWord.map((e) => e.keyword)).toContain("rank the best");
  });

  it("keeps stop words when ignoreStopWords is false", () => {
    const r = analyzeKeywordDensity(TEXT, { ignoreStopWords: false });
    expect(r.oneWord.map((e) => e.keyword)).toContain("the");
  });

  it("applies limit and minCount", () => {
    const r = analyzeKeywordDensity(TEXT, { limit: 1, minCount: 3 });
    expect(r.oneWord).toEqual([{ keyword: "seo", count: 3, density: 30, words: 1 }]);
  });

  it("rates the target keyword: missing / low / good / high / empty", () => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    // 1 hit in 200 words = 0.5% -> good ; 1 in 250 = 0.4% -> low ; 3/10 -> high
    expect(analyzeKeywordDensity(`coffee ${filler(199)}`, { target: "Coffee" }).target).toEqual({
      keyword: "coffee",
      count: 1,
      density: 0.5,
      status: "good",
    });
    expect(
      analyzeKeywordDensity(`coffee ${filler(249)}`, { target: "coffee" }).target?.status,
    ).toBe("low");
    expect(analyzeKeywordDensity(TEXT, { target: "seo tools" }).target).toEqual({
      keyword: "seo tools",
      count: 3,
      density: 33.3,
      status: "high",
    });
    expect(analyzeKeywordDensity(TEXT, { target: "coffee" }).target?.status).toBe("missing");
    expect(analyzeKeywordDensity(TEXT, { target: "!!!" }).target).toEqual({
      keyword: "!!!",
      count: 0,
      density: 0,
      status: "empty",
    });
    expect(analyzeKeywordDensity(TEXT, { target: "   " }).target).toBeNull();
  });

  it("handles Cyrillic text and Russian stop words", () => {
    // кофе, для, кофе -> "для" is a stop word; кофе 2/3 = 66.7%
    const r = analyzeKeywordDensity("Кофе для кофе!");
    expect(r.oneWord).toEqual([{ keyword: "кофе", count: 2, density: 66.7, words: 1 }]);
  });

  it("keeps hyphenated words and apostrophes inside a token", () => {
    const r = analyzeKeywordDensity("e-mail don't e-mail");
    expect(r.oneWord[0]).toMatchObject({ keyword: "e-mail", count: 2 });
  });

  it("breaks count ties alphabetically in the given locale", () => {
    const text = "zebra ärger apple";
    const sv = analyzeKeywordDensity(text, { locale: "sv" }).oneWord.map((e) => e.keyword);
    const de = analyzeKeywordDensity(text, { locale: "de" }).oneWord.map((e) => e.keyword);
    expect(sv).toEqual(["apple", "zebra", "ärger"]);
    expect(de).toEqual(["apple", "ärger", "zebra"]);
  });
});
