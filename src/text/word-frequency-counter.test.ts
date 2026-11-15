import { describe, expect, it } from "vitest";
import { STOP_WORDS } from "./_stop-words.js";
import { classicNausea, countWordFrequency, toCsv } from "./word-frequency-counter.js";

describe("STOP_WORDS", () => {
  it("contains English and Russian function words in lower case", () => {
    for (const w of ["the", "and", "of", "и", "в", "не"]) expect(STOP_WORDS.has(w)).toBe(true);
    expect(STOP_WORDS.has("cat")).toBe(false);
    for (const w of STOP_WORDS) expect(w).toBe(w.toLowerCase());
  });
});

describe("countWordFrequency", () => {
  it("returns empty stats for empty input or punctuation only", () => {
    for (const t of ["", "  ", "... !!! —"]) {
      expect(countWordFrequency(t)).toEqual({
        totalWords: 0,
        uniqueWords: 0,
        stopWordCount: 0,
        stopWordShare: 0,
        maxCount: 0,
        entries: [],
      });
    }
  });

  it("counts words case-insensitively, sorted by count then alphabetically", () => {
    // the,cat,and,the,hat,the,end -> 7 words; the=3 (42.9%), others 1 (14.3%)
    const r = countWordFrequency("The cat and the hat. The end.");
    expect(r.totalWords).toBe(7);
    expect(r.uniqueWords).toBe(5);
    expect(r.maxCount).toBe(3);
    expect(r.entries).toEqual([
      { word: "the", count: 3, percentage: 42.9 },
      { word: "and", count: 1, percentage: 14.3 },
      { word: "cat", count: 1, percentage: 14.3 },
      { word: "end", count: 1, percentage: 14.3 },
      { word: "hat", count: 1, percentage: 14.3 },
    ]);
    // stop words: the x3 + and = 4 of 7 = 57.1%
    expect(r.stopWordCount).toBe(4);
    expect(r.stopWordShare).toBe(57.1);
  });

  it("excludes stop words when asked, but still reports their share of the original", () => {
    const r = countWordFrequency("The cat and the hat. The end.", { excludeStopWords: true });
    expect(r.entries.map((e) => e.word)).toEqual(["cat", "end", "hat"]);
    expect(r.totalWords).toBe(3);
    expect(r.entries[0].percentage).toBe(33.3);
    expect(r.stopWordCount).toBe(4);
  });

  it("keeps case distinct when caseSensitive", () => {
    const r = countWordFrequency("Apple apple APPLE", { caseSensitive: true });
    expect(r.uniqueWords).toBe(3);
  });

  it("filters by minimum length", () => {
    const r = countWordFrequency("a bb ccc dddd", { minLength: 3 });
    expect(r.entries.map((e) => e.word)).toEqual(["ccc", "dddd"]);
  });

  it("keeps hyphenated words and contractions together", () => {
    const r = countWordFrequency("don't well-known it’s");
    expect(r.entries.map((e) => e.word).sort()).toEqual(["don't", "it’s", "well-known"]);
  });

  it("handles Cyrillic text and Russian stop words", () => {
    // кот, и, кот, и, пёс -> кот 2, и 2, пёс 1 ; stop words: и x2 = 40%
    const r = countWordFrequency("Кот и кот и пёс");
    expect(r.totalWords).toBe(5);
    expect(r.entries[0].count).toBe(2);
    expect(r.stopWordShare).toBe(40);
  });

  it("counts digits as words and ignores emoji", () => {
    const r = countWordFrequency("2026 👍 2026");
    expect(r.entries).toEqual([{ word: "2026", count: 2, percentage: 100 }]);
  });
});

describe("classicNausea", () => {
  it("is the square root of the max count, rounded to 2 decimals", () => {
    expect(classicNausea(9)).toBe(3);
    expect(classicNausea(2)).toBe(1.41);
    expect(classicNausea(0)).toBe(0);
    expect(classicNausea(-4)).toBe(0);
  });
});

describe("toCsv", () => {
  it("writes a header plus rows with CRLF and quotes fields that need it", () => {
    const csv = toCsv(
      [
        { word: "plain", count: 2, percentage: 50 },
        { word: 'say "hi", ok', count: 1, percentage: 25 },
      ],
      ["word", "count", "percent"],
    );
    expect(csv).toBe('word,count,percent\r\nplain,2,50\r\n"say ""hi"", ok",1,25');
  });

  it("writes only the header for no entries", () => {
    expect(toCsv([], ["a", "b", "c"])).toBe("a,b,c");
  });
});

describe("locale option", () => {
  it("breaks count ties alphabetically in the given locale", () => {
    const words = (locale: string) =>
      countWordFrequency("zebra ärger apple", { locale }).entries.map((e) => e.word);
    expect(words("sv")).toEqual(["apple", "zebra", "ärger"]);
    expect(words("de")).toEqual(["apple", "ärger", "zebra"]);
    expect(countWordFrequency("b a", { locale: "not a locale!" }).entries[0].word).toBe("a");
  });
});
