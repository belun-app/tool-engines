import { describe, expect, it } from "vitest";
import { checkReadability } from "./readability-checker.js";

describe("checkReadability", () => {
  it("returns the zero result with a dash label for empty input", () => {
    expect(checkReadability("  \n ")).toEqual({
      words: 0,
      sentences: 0,
      syllables: 0,
      fleschScore: 0,
      gradeLevel: 0,
      readabilityLabel: "—",
      avgWordsPerSentence: 0,
      avgSyllablesPerWord: 0,
    });
  });

  it("computes Flesch and Flesch-Kincaid for a pangram (hand-calculated)", () => {
    // 9 words, 1 sentence; syllables: the1 quick1 brown1 fox1 jumps1 o-ver2 the1 la-zy2 dog1 = 11
    // Flesch = 206.835 - 1.015*9 - 84.6*11/9 = 206.835 - 9.135 - 103.4 = 94.3
    // FK grade = 0.39*9 + 11.8*11/9 - 15.59 = 3.51 + 14.4222 - 15.59 = 2.3422 -> 2.3
    const r = checkReadability("The quick brown fox jumps over the lazy dog.");
    expect(r.words).toBe(9);
    expect(r.sentences).toBe(1);
    expect(r.syllables).toBe(11);
    expect(r.fleschScore).toBe(94.3);
    expect(r.gradeLevel).toBe(2.3);
    expect(r.readabilityLabel).toBe("Very Easy");
    expect(r.avgWordsPerSentence).toBe(9);
    expect(r.avgSyllablesPerWord).toBe(1.22);
  });

  it("clamps Flesch to 0 and keeps a high grade for dense text", () => {
    // read-ing2 im-pro-ves3 (heuristic) com-pre-hen-sion4 = 9 syllables, 3 words, 1 sentence
    // Flesch = 206.835 - 3.045 - 253.8 < 0 -> 0 ; grade = 1.17 + 35.4 - 15.59 = 20.98 -> 21
    const r = checkReadability("Reading improves comprehension.");
    expect(r.syllables).toBe(9);
    expect(r.fleschScore).toBe(0);
    expect(r.gradeLevel).toBe(21);
    expect(r.readabilityLabel).toBe("Very Difficult");
  });

  it("clamps Flesch to 100 and grade to 0 for very simple text", () => {
    // 6 one-syllable words: Flesch = 206.835 - 6.09 - 84.6 = 116.1 -> 100 ; grade -1.45 -> 0
    const r = checkReadability("The cat sat on the mat.");
    expect(r.fleschScore).toBe(100);
    expect(r.gradeLevel).toBe(0);
  });

  it("treats text without terminal punctuation as one sentence", () => {
    expect(checkReadability("no full stop here").sentences).toBe(1);
  });

  it("maps score bands to labels", () => {
    // 2 words per sentence of 2-syllable words: 206.835 - 2.03 - 169.2 = 35.6 -> Difficult
    expect(checkReadability("Happy pupils.").readabilityLabel).toBe("Difficult");
  });

  it("counts syllables in Cyrillic words", () => {
    expect(checkReadability("Молоко полезно.").syllables).toBeGreaterThan(0);
  });

  it("scores Russian with Oborneva's coefficients", () => {
    // 3 + 3 vowels; 2 words, 1 sentence: 206.835 - 1.3 * 2 - 60.1 * 3 = 23.9
    const r = checkReadability("Молоко полезно.");
    expect(r.syllables).toBe(6);
    expect(r.fleschScore).toBe(23.9);
  });
});
