import { describe, expect, it } from "vitest";
import {
  compareWord,
  computeStats,
  generateWords,
  isCorrectPrefix,
  isWordCorrect,
  missedLetters,
  tallyKeystrokes,
} from "./typing-speed-test.js";

/** A deterministic "random" that walks evenly through [0, 1). */
function sweep(n: number): () => number {
  let i = 0;
  return () => (i++ % n) / n + 0.5 / n;
}

describe("generateWords", () => {
  it("returns [] for zero, negative and non-finite counts", () => {
    expect(generateWords(0)).toEqual([]);
    expect(generateWords(-3)).toEqual([]);
    expect(generateWords(Number.NaN)).toEqual([]);
    expect(generateWords(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("returns the requested number of words from the right bank", () => {
    const en = generateWords(50, "en", sweep(50));
    expect(en).toHaveLength(50);
    expect(en.every((w) => /^[a-z]+$/.test(w))).toBe(true);
    const ru = generateWords(50, "ru", sweep(50));
    expect(ru.every((w) => /^[а-яё]+$/.test(w))).toBe(true);
  });

  it("is deterministic with an injected random source", () => {
    expect(generateWords(5, "en", () => 0)).toEqual(generateWords(5, "en", () => 0));
    // random() = 0 always picks index 0 ("the"), then the duplicate-avoidance bumps to index 1
    expect(generateWords(4, "en", () => 0)).toEqual(["the", "of", "the", "of"]);
  });

  it("never yields the same word twice in a row", () => {
    const words = generateWords(400, "en", () => 0.37);
    for (let i = 1; i < words.length; i++) expect(words[i]).not.toBe(words[i - 1]);
  });

  it("does not index out of range when random() returns 1 or just below", () => {
    expect(generateWords(1, "en", () => 1)).toEqual(["the"]);
    expect(generateWords(1, "en", () => 0.999999)[0]).toBe("every");
  });

  it("the English bank has 200 distinct words", () => {
    expect(new Set(generateWords(200, "en", sweep(200))).size).toBe(200);
  });

  it("the Russian bank has 200 distinct words", () => {
    expect(new Set(generateWords(200, "ru", sweep(200))).size).toBe(200);
  });
});

describe("compareWord / isWordCorrect", () => {
  it("marks each target character correct, wrong or pending", () => {
    expect(compareWord("hello", "help")).toEqual({
      statuses: ["correct", "correct", "correct", "wrong", "pending"],
      extraChars: 0,
    });
  });

  it("reports extra characters beyond the target", () => {
    expect(compareWord("cat", "cats!")).toEqual({
      statuses: ["correct", "correct", "correct"],
      extraChars: 2,
    });
  });

  it("is case-sensitive and works on Cyrillic", () => {
    expect(compareWord("Дом", "дом").statuses).toEqual(["wrong", "correct", "correct"]);
    expect(isWordCorrect("дом", "дом")).toBe(true);
  });

  it("an empty target is never correct", () => {
    expect(isWordCorrect("", "")).toBe(false);
    expect(compareWord("", "ab")).toEqual({ statuses: [], extraChars: 2 });
  });
});

describe("computeStats", () => {
  it("returns zeroes for no attempts or a non-positive duration", () => {
    const attempts = [{ target: "the", typed: "the" }];
    for (const r of [
      computeStats([], 60_000),
      computeStats(attempts, 0),
      computeStats(attempts, -1),
      computeStats(attempts, Number.NaN),
    ]) {
      expect(r).toMatchObject({ wpm: 0, rawWpm: 0, accuracy: 0, elapsedSeconds: 0 });
    }
  });

  it("applies the standard net/raw WPM formulas (hand-computed)", () => {
    const r = computeStats(
      [
        { target: "the", typed: "the" },
        { target: "quick", typed: "quikc" },
        { target: "fox", typed: "fox" },
      ],
      60_000,
    );
    // net units: (3+1)+(3+1) = 8 -> 8/5/1 = 1.6 -> 2 WPM; raw units: 4+6+4 = 14 -> 2.8 -> 3
    expect(r.wpm).toBe(2);
    expect(r.rawWpm).toBe(3);
    expect(r.cpm).toBe(8);
    expect(r.rawCpm).toBe(14);
    // chars: 3 + (q,u,i = 3 correct, k/c swapped = 2 wrong) + 3 -> 9 correct, 2 wrong
    expect(r.correctChars).toBe(9);
    expect(r.wrongChars).toBe(2);
    // 9 / 11 = 81.81 % -> 81.8
    expect(r.accuracy).toBe(81.8);
    expect(r.correctWords).toBe(2);
    expect(r.wrongWords).toBe(1);
    expect(r.elapsedSeconds).toBe(60);
  });

  it("scales per minute for a 30-second run", () => {
    // 10 correct 4-letter words = 50 units in 0.5 min -> 100 cpm, 20 wpm
    const attempts = Array.from({ length: 10 }, () => ({ target: "word", typed: "word" }));
    const r = computeStats(attempts, 30_000);
    expect(r.wpm).toBe(20);
    expect(r.cpm).toBe(100);
    expect(r.accuracy).toBe(100);
    expect(r.elapsedSeconds).toBe(30);
  });

  it("counts extra characters and letters left out of a committed word as wrong", () => {
    const r = computeStats(
      [
        { target: "cat", typed: "cats" },
        { target: "house", typed: "ho" },
      ],
      60_000,
    );
    // cat/cats: 3 correct + 1 extra wrong; house/ho: 2 correct + 3 missing letters wrong
    expect(r.correctChars).toBe(5);
    expect(r.wrongChars).toBe(4);
    expect(r.wrongWords).toBe(2);
    expect(r.wpm).toBe(0);
  });

  it("lowers accuracy for a word committed with a missing letter (th for the)", () => {
    const r = computeStats(
      [
        { target: "the", typed: "th" },
        { target: "of", typed: "of" },
      ],
      60_000,
    );
    // 4 correct, 1 missing -> 80 %
    expect(r.accuracy).toBe(80);
  });

  it("does not count the word cut off by the timer as a mistake", () => {
    const r = computeStats(
      [
        { target: "the", typed: "the" },
        { target: "of", typed: "of" },
        { target: "the", typed: "th", partial: true },
      ],
      60_000,
    );
    expect(r.wrongWords).toBe(0);
    expect(r.correctWords).toBe(2);
    expect(r.accuracy).toBe(100);
    // net units: 4 + 3 + 2 letters of the unfinished word = 9
    expect(r.cpm).toBe(9);
  });

  it("still reports a wrong beginning of the cut-off word as a wrong word", () => {
    const r = computeStats([{ target: "the", typed: "tx", partial: true }], 60_000);
    expect(r.wrongWords).toBe(1);
  });

  it("takes accuracy from keystrokes when they were tracked", () => {
    const r = computeStats([{ target: "the", typed: "the" }], 60_000, { correct: 3, wrong: 1 });
    expect(r.accuracy).toBe(75);
    expect(r.correctWords).toBe(1);
  });

  it("skips attempts with nothing typed", () => {
    const r = computeStats(
      [
        { target: "a", typed: "a" },
        { target: "b", typed: "" },
      ],
      60_000,
    );
    expect(r.correctWords).toBe(1);
    expect(r.wrongWords).toBe(0);
    expect(r.rawCpm).toBe(2);
  });

  it("returns 0 accuracy (not NaN) when every attempt is blank", () => {
    const r = computeStats([{ target: "a", typed: "" }], 60_000);
    expect(r.accuracy).toBe(0);
    expect(Number.isNaN(r.wpm)).toBe(false);
  });

  it("computes CPM the way Russian tests count it (spaces included)", () => {
    // "привет мир" typed correctly in 6 s: (6+1)+(3+1) = 11 units / 0.1 min = 110 cpm
    const r = computeStats(
      [
        { target: "привет", typed: "привет" },
        { target: "мир", typed: "мир" },
      ],
      6_000,
    );
    expect(r.cpm).toBe(110);
    expect(r.wpm).toBe(22);
  });
});

describe("ё = е", () => {
  it("treats ё and е as the same letter, in both directions", () => {
    expect(isWordCorrect("еще", "ещё")).toBe(true);
    expect(isWordCorrect("ещё", "еще")).toBe(true);
    expect(isWordCorrect("Ёж", "Еж")).toBe(true);
    expect(compareWord("еще", "ещё").statuses).toEqual(["correct", "correct", "correct"]);
    // case still matters, and other letters are not merged
    expect(isWordCorrect("еще", "ЕЩЕ")).toBe(false);
    expect(isWordCorrect("ель", "эль")).toBe(false);
  });
});

describe("keystroke accounting", () => {
  it("scores each added character against the target letter", () => {
    expect(tallyKeystrokes("the", "", "t")).toEqual({ correct: 1, wrong: 0 });
    expect(tallyKeystrokes("the", "th", "thx")).toEqual({ correct: 0, wrong: 1 });
    // Backspace adds nothing; retyping the letter counts once more
    expect(tallyKeystrokes("the", "thx", "th")).toEqual({ correct: 0, wrong: 0 });
    expect(tallyKeystrokes("the", "th", "the")).toEqual({ correct: 1, wrong: 0 });
  });

  it("handles a whole word inserted at once (phone prediction) and extra letters", () => {
    expect(tallyKeystrokes("the", "", "the")).toEqual({ correct: 3, wrong: 0 });
    expect(tallyKeystrokes("of", "of", "ofs")).toEqual({ correct: 0, wrong: 1 });
    expect(tallyKeystrokes("еще", "", "ещё")).toEqual({ correct: 3, wrong: 0 });
  });

  it("counts missing letters and recognises correct beginnings", () => {
    expect(missedLetters("the", "th")).toBe(1);
    expect(missedLetters("the", "thex")).toBe(0);
    expect(isCorrectPrefix("the", "th")).toBe(true);
    expect(isCorrectPrefix("the", "tx")).toBe(false);
    expect(isCorrectPrefix("the", "")).toBe(false);
  });
});
