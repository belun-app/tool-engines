import { describe, expect, it } from "vitest";
import { STOP_WORDS } from "../text/_stop-words.js";
import { type CloudPlacement, buildWordCloud, layoutCloud } from "./word-cloud-generator.js";

describe("buildWordCloud", () => {
  it("returns an empty result for empty, whitespace or punctuation-only text", () => {
    for (const t of ["", "   \n", "!!! ... ---", "👍🎉"]) {
      expect(buildWordCloud(t)).toEqual({ entries: [], totalWords: 0, uniqueWords: 0 });
    }
  });

  it("counts, ranks and weights words (hand-counted)", () => {
    const r = buildWordCloud("Apple banana apple cherry. Banana apple!");
    // apple 3, banana 2, cherry 1
    expect(r.entries).toEqual([
      { word: "apple", count: 3, weight: 1 },
      { word: "banana", count: 2, weight: 2 / 3 },
      { word: "cherry", count: 1, weight: 1 / 3 },
    ]);
    expect(r.totalWords).toBe(6);
    expect(r.uniqueWords).toBe(3);
  });

  it("breaks frequency ties alphabetically", () => {
    expect(buildWordCloud("zeta alpha mid").entries.map((e) => e.word)).toEqual([
      "alpha",
      "mid",
      "zeta",
    ]);
  });

  it("drops English stop words by default and keeps them when asked", () => {
    const text = "the cat and the dog";
    expect(buildWordCloud(text).entries.map((e) => e.word)).toEqual(["cat", "dog"]);
    const all = buildWordCloud(text, { excludeStopWords: false });
    expect(all.entries[0]).toEqual({ word: "the", count: 2, weight: 1 });
    expect(all.totalWords).toBe(5);
  });

  it("keeps contractions and hyphenated words as one token", () => {
    const r = buildWordCloud("well-known rock'n'roll well-known", { excludeStopWords: false });
    expect(r.entries.map((e) => e.word)).toEqual(["well-known", "rock'n'roll"]);
    // "don't" is a stop word with a straight apostrophe
    expect(buildWordCloud("don't stop").entries.map((e) => e.word)).toEqual(["stop"]);
  });

  it("applies minWordLength to letters only (punctuation ignored), at least 1", () => {
    // "a-b" has 2 letters, "ab" 2, "x" 1
    const r = buildWordCloud("a-b ab x", { excludeStopWords: false, minWordLength: 2 });
    expect(r.entries.map((e) => e.word).sort()).toEqual(["a-b", "ab"]);
    const one = buildWordCloud("x y", { minWordLength: 0 });
    expect(one.totalWords).toBe(2);
    expect(buildWordCloud("cat house", { minWordLength: 4 }).entries.map((e) => e.word)).toEqual([
      "house",
    ]);
  });

  it("is case-insensitive by default and case-sensitive on request", () => {
    expect(buildWordCloud("Word word WORD").entries).toEqual([
      { word: "word", count: 3, weight: 1 },
    ]);
    const cs = buildWordCloud("Word word word", { caseSensitive: true });
    expect(cs.entries).toEqual([
      { word: "word", count: 2, weight: 1 },
      { word: "Word", count: 1, weight: 0.5 },
    ]);
    // stop words still match regardless of case
    expect(buildWordCloud("The cat", { caseSensitive: true }).entries.map((e) => e.word)).toEqual([
      "cat",
    ]);
  });

  it("caps the list at maxWords (rounded, minimum 1) but reports all unique words", () => {
    const text = "aa bb cc dd ee aa";
    const r = buildWordCloud(text, { maxWords: 2 });
    expect(r.entries.map((e) => e.word)).toEqual(["aa", "bb"]);
    expect(r.uniqueWords).toBe(5);
    expect(buildWordCloud(text, { maxWords: 0 }).entries).toHaveLength(1);
    expect(buildWordCloud(text, { maxWords: 2.6 }).entries).toHaveLength(3);
  });

  it("handles Cyrillic and digits", () => {
    const r = buildWordCloud("Москва москва 2024 год");
    expect(r.entries[0]).toEqual({ word: "москва", count: 2, weight: 1 });
    expect(r.entries.map((e) => e.word)).toContain("2024");
  });

  it("does not throw on a large input", () => {
    const r = buildWordCloud("alpha beta gamma ".repeat(20_000));
    expect(r.totalWords).toBe(60_000);
    expect(r.entries).toHaveLength(3);
  });

  it("filters stop words written with a curly apostrophe", () => {
    expect(buildWordCloud("don’t stop").entries.map((e) => e.word)).toEqual(["stop"]);
  });

  it("filters Russian stop words promised on the RU page", () => {
    const words = buildWordCloud("на столе что это книга").entries.map((e) => e.word);
    expect(words).toEqual(["книга", "столе"]);
  });

  it("uses the shared EN+RU stop-word list (what keyword-density and word-frequency use)", () => {
    const text =
      "Что на складе? Это не то, что на витрине, как и всё, что они говорят. Склад большой, но склад пустой.";
    const words = buildWordCloud(text).entries.map((e) => e.word);
    for (const stop of ["что", "на", "это", "не", "как", "но", "то", "всё", "они", "и"]) {
      expect(words).not.toContain(stop);
    }
    expect(words[0]).toBe("склад");
    for (const w of ["что", "это", "как", "they're", "you've"]) {
      expect(STOP_WORDS.has(w)).toBe(true);
    }
  });

  it("filters stop words written with е instead of ё", () => {
    expect(buildWordCloud("все еще дом").entries.map((e) => e.word)).toEqual(["дом"]);
  });

  it("keeps a stress mark inside the word and counts length in graphemes", () => {
    const stressed = `моло${String.fromCodePoint(0x301)}ко`;
    expect(buildWordCloud(`${stressed} ${stressed}`).entries).toEqual([
      { word: stressed, count: 2, weight: 1 },
    ]);
    // "é" written as e + combining acute is one letter, so it passes minWordLength 2 only with a second letter.
    const decomposedE = `e${String.fromCodePoint(0x301)}`;
    expect(buildWordCloud(decomposedE, { minWordLength: 2 }).entries).toEqual([]);
    expect(buildWordCloud(`${decomposedE}t`, { minWordLength: 2 }).entries).toHaveLength(1);
  });

  // Regression: «ещё» and «еще» were two different words in the cloud.
  it("counts ё and е spellings as one word and shows the more frequent spelling", () => {
    const r = buildWordCloud("ещё еще ещё зелёный зеленый облако", { excludeStopWords: false });
    expect(r.entries.map((e) => [e.word, e.count])).toEqual([
      ["ещё", 3],
      ["зелёный", 2],
      ["облако", 1],
    ]);
    expect(r.uniqueWords).toBe(3);
  });
});

/** Bold sans-serif is roughly 0.62 em per letter. */
const measure = (word: string, size: number) => [...word].length * size * 0.62;

function noOverlap(ps: CloudPlacement[]): boolean {
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return false;
    }
  return true;
}

const inside = (ps: CloudPlacement[], w: number, h: number) =>
  ps.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h);

const SAMPLE =
  "Word clouds are a quick way to see which words dominate a piece of text. Paste an article, " +
  "a speech, survey answers or customer reviews, and the most frequent words grow larger. " +
  "Common words are filtered out, so the cloud shows the words that carry meaning.";

describe("layoutCloud", () => {
  const frame = { width: 900, height: 480, minFont: 13, maxFont: 86, measure };

  // Regression: words that did not fit were dropped silently (27 of 45 sample words).
  it("places every word of a typical text, top word at full size", () => {
    const { entries } = buildWordCloud(SAMPLE, { maxWords: 60 });
    const { placements, dropped } = layoutCloud(entries, frame);
    expect(dropped).toBe(0);
    expect(placements).toHaveLength(entries.length);
    expect(placements[0].fontSize).toBe(86);
    expect(placements.every((p) => p.fontSize >= 13)).toBe(true);
    expect(noOverlap(placements)).toBe(true);
    expect(inside(placements, 900, 480)).toBe(true);
  });

  it("shrinks the rest rather than losing words: 150 equally frequent words", () => {
    const text = Array.from({ length: 150 }, (_, i) => `w${i.toString(36).padStart(3, "a")}`).join(
      " ",
    );
    const { entries } = buildWordCloud(text, { maxWords: 150 });
    const { placements } = layoutCloud(entries, frame);
    expect(placements.length).toBeGreaterThan(140);
    expect(noOverlap(placements)).toBe(true);
  });

  // Regression: a frequent word longer than the frame was never placed.
  it("always keeps a long most frequent word, scaled to the frame width", () => {
    const words = Array(6).fill("electroencephalography").join(" ");
    const { entries } = buildWordCloud(`${words} alpha beta gamma delta`, {});
    const { placements } = layoutCloud(entries, frame);
    const top = placements.find((p) => p.word === "electroencephalography");
    expect(top).toBeDefined();
    expect((top?.x ?? 0) + (top?.w ?? 0)).toBeLessThanOrEqual(900);
  });

  // Regression: a top word still wider than the frame at 6 px was dropped.
  it("cuts the top word with … when it does not fit even at 6 px", () => {
    const long = "a".repeat(60);
    const { entries } = buildWordCloud(`${long} ${long} short`, {});
    const { placements } = layoutCloud(entries, { ...frame, width: 120, height: 80 });
    const top = placements.find((p) => p.index === 0);
    expect(top).toBeDefined();
    expect(top?.word.endsWith("…")).toBe(true);
    expect(top?.word.startsWith("aaaa")).toBe(true);
    expect(top?.fontSize).toBe(6);
    expect((top?.x ?? 0) + (top?.w ?? 0)).toBeLessThanOrEqual(120);
  });

  it("keeps the top word when the measure is not proportional to the font size", () => {
    const padded = (word: string, size: number) => [...word].length * size * 0.62 + 40;
    const words = Array(4).fill("electroencephalography").join(" ");
    const { entries } = buildWordCloud(`${words} alpha`, {});
    const { placements } = layoutCloud(entries, { ...frame, width: 400, measure: padded });
    const top = placements.find((p) => p.index === 0);
    expect(top?.word).toBe("electroencephalography");
    expect((top?.x ?? 0) + (top?.w ?? 0)).toBeLessThanOrEqual(400);
  });

  it("keeps sizes in frequency order", () => {
    const { entries } = buildWordCloud("apple Apple APPLE banana banana cherry");
    const sizes = layoutCloud(entries, frame).placements.map((p) => p.fontSize);
    expect(sizes[0]).toBe(86);
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[2]);
  });

  it("is repeatable for a seed and differs for another seed", () => {
    const { entries } = buildWordCloud(SAMPLE);
    const a = layoutCloud(entries, { ...frame, seed: 7 }).placements;
    const b = layoutCloud(entries, { ...frame, seed: 7 }).placements;
    const c = layoutCloud(entries, { ...frame, seed: 8 }).placements;
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it("fits a narrow phone frame", () => {
    const { entries } = buildWordCloud(SAMPLE);
    const { placements, dropped } = layoutCloud(entries, {
      width: 340,
      height: 290,
      minFont: 11,
      maxFont: 52,
      measure,
    });
    expect(dropped).toBe(0);
    expect(inside(placements, 340, 290)).toBe(true);
    expect(noOverlap(placements)).toBe(true);
  });

  it("returns nothing for no entries", () => {
    expect(layoutCloud([], frame)).toEqual({ placements: [], dropped: 0 });
  });
});

describe("locale option", () => {
  it("breaks count ties alphabetically in the given locale", () => {
    const words = (locale: string) =>
      buildWordCloud("zebra ärger apple", { locale }).entries.map((e) => e.word);
    expect(words("sv")).toEqual(["apple", "zebra", "ärger"]);
    expect(words("de")).toEqual(["apple", "ärger", "zebra"]);
  });
});
