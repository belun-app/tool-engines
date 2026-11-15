import { describe, expect, it } from "vitest";
import { checkPlagiarism } from "./plagiarism-checker.js";

const ZERO = {
  similarityPercent: 0,
  matchingSentences: 0,
  totalSentencesA: 0,
  commonWords: 0,
  uniqueWordsA: 0,
  uniqueWordsB: 0,
};

describe("checkPlagiarism", () => {
  it("returns all zeros when either text is empty or whitespace", () => {
    expect(checkPlagiarism("", "abc")).toEqual(ZERO);
    expect(checkPlagiarism("abc", "  ")).toEqual(ZERO);
  });

  it("scores identical texts at 100%", () => {
    const t = "The cat sat on the mat. It was happy.";
    const r = checkPlagiarism(t, t);
    expect(r.similarityPercent).toBe(100);
    expect(r.matchingSentences).toBe(2);
    expect(r.totalSentencesA).toBe(2);
  });

  it("scores disjoint texts at 0%", () => {
    expect(checkPlagiarism("alpha beta.", "gamma delta.").similarityPercent).toBe(0);
  });

  it("computes Jaccard word similarity and exact sentence matches", () => {
    // A words {the,cat,sat,dog,ran}=5, B {the,cat,sat,a,bird,flew}=6
    // common 3, union 5+6-3 = 8 -> 3/8 = 37.5% -> 38
    const r = checkPlagiarism("The cat sat. The dog ran.", "The cat sat. A bird flew.");
    expect(r).toEqual({
      similarityPercent: 38,
      matchingSentences: 1,
      totalSentencesA: 2,
      commonWords: 3,
      uniqueWordsA: 5,
      uniqueWordsB: 6,
    });
  });

  it("ignores case and punctuation when matching sentences", () => {
    const r = checkPlagiarism("Hello, World!", "hello world!");
    expect(r.matchingSentences).toBe(1);
  });

  it("does not match unrelated Cyrillic sentences", () => {
    const r = checkPlagiarism("Привет мир.", "Совсем другой текст.");
    expect(r.matchingSentences).toBe(0);
  });

  it("scores identical Cyrillic texts at 100%", () => {
    const t = "Кошка сидела на ковре.";
    expect(checkPlagiarism(t, t).similarityPercent).toBe(100);
  });
});
