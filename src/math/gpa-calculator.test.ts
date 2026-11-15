import { describe, expect, it } from "vitest";
import {
  calculateGpa,
  cumulativeGpa,
  gpaToLetter,
  letterScaleTable,
  letterToPoints,
  normalizeLetter,
  parseGrade,
  percentToLetter,
} from "./gpa-calculator.js";

describe("letter helpers", () => {
  it("normalises case, spaces and unicode minus/dash", () => {
    expect(normalizeLetter(" b + ")).toBe("B+");
    expect(normalizeLetter("a−")).toBe("A-");
    expect(normalizeLetter("c–")).toBe("C-");
  });

  it("maps letters to the standard 4.0 points and A+ to 4.3 on the 4.3 scale", () => {
    expect(letterToPoints("A+")).toBe(4);
    expect(letterToPoints("A+", "4.3")).toBe(4.3);
    expect(letterToPoints("A-")).toBe(3.7);
    expect(letterToPoints("b+")).toBe(3.3);
    expect(letterToPoints("D-")).toBe(0.7);
    expect(letterToPoints("E")).toBe(0);
    expect(letterToPoints("Z")).toBeNull();
  });

  it("maps percentages to US letters at the floors", () => {
    expect(percentToLetter(100)).toBe("A+");
    expect(percentToLetter(93)).toBe("A");
    expect(percentToLetter(92.99)).toBe("A-");
    expect(percentToLetter(60)).toBe("D-");
    expect(percentToLetter(59.9)).toBe("F");
    expect(percentToLetter(-5)).toBe("F");
  });

  it("maps a GPA back to a letter", () => {
    expect(gpaToLetter(4)).toBe("A");
    expect(gpaToLetter(3.5)).toBe("A-");
    expect(gpaToLetter(3.49)).toBe("B+");
    expect(gpaToLetter(0.49)).toBe("F");
    expect(gpaToLetter(-1)).toBe("F");
  });
});

describe("parseGrade", () => {
  it("accepts letters, grade points and percentages", () => {
    expect(parseGrade("B-")).toEqual({ points: 2.7, letter: "B-" });
    expect(parseGrade("3.2")).toEqual({ points: 3.2, letter: "B+" });
    expect(parseGrade("3,5")).toEqual({ points: 3.5, letter: "A-" });
    expect(parseGrade("92%")).toEqual({ points: 3.7, letter: "A-" });
    // above 4.0 can only be a percentage
    expect(parseGrade("85")).toEqual({ points: 3, letter: "B" });
  });

  it("treats 4.2 as a grade point on the 4.3 scale and refuses it on 4.0", () => {
    expect(parseGrade("4.2", "4.3")).toEqual({ points: 4.2, letter: "A" });
    // Must be refused, not read as 4.2 % (an F).
    expect(parseGrade("4.2", "4.0")).toBeNull();
    expect(parseGrade("4.2%", "4.0")?.letter).toBe("F");
  });

  it("rejects empty, negative, >100 and garbage", () => {
    for (const v of ["", "  ", "-1", "101", "abc", "150%"]) {
      expect(parseGrade(v)).toBeNull();
    }
  });
});

describe("calculateGpa", () => {
  it("weights grade points by credits (hand-calculated)", () => {
    // A (4 x 3) + B (3 x 4) + C+ (2.3 x 2) = 12 + 12 + 4.6 = 28.6 over 9 credits = 3.1778
    const r = calculateGpa([
      { name: "Math", grade: "A", credits: 3 },
      { name: "Bio", grade: "B", credits: "4" },
      { name: "Art", grade: "C+", credits: 2 },
    ]);
    expect(r.valid).toBe(true);
    expect(r.totalCredits).toBe(9);
    expect(r.totalQualityPoints).toBeCloseTo(28.6, 10);
    expect(r.gpa).toBeCloseTo(28.6 / 9, 10);
    expect(r.unweightedGpa).toBeCloseTo(28.6 / 9, 10);
    expect(r.weighted).toBe(false);
  });

  it("adds 0.5 for honors and 1.0 for AP in the weighted GPA only", () => {
    // weighted: (4+1)*3 + (3+0.5)*3 = 15 + 10.5 = 25.5 / 6 = 4.25 ; unweighted: (12 + 9) / 6 = 3.5
    const r = calculateGpa([
      { name: "AP Calc", grade: "A", credits: 3, level: "ap" },
      { name: "Hon Eng", grade: "B", credits: 3, level: "honors" },
    ]);
    expect(r.weighted).toBe(true);
    expect(r.gpa).toBeCloseTo(4.25, 10);
    expect(r.unweightedGpa).toBeCloseTo(3.5, 10);
    expect(r.courses[0].points).toBe(5);
    expect(r.courses[0].basePoints).toBe(4);
  });

  it("accepts decimal-comma credits", () => {
    expect(calculateGpa([{ name: "x", grade: "B", credits: "1,5" }]).totalCredits).toBe(1.5);
  });

  it("skips invalid rows and keeps them marked invalid", () => {
    const r = calculateGpa([
      { name: "ok", grade: "A", credits: 3 },
      { name: "bad grade", grade: "?", credits: 3 },
      { name: "no credits", grade: "B", credits: "" },
      { name: "neg credits", grade: "B", credits: -2 },
    ]);
    expect(r.totalCredits).toBe(3);
    expect(r.gpa).toBe(4);
    expect(r.courses.map((c) => c.valid)).toEqual([true, false, false, false]);
    expect(r.courses[1].credits).toBe(3);
    expect(r.courses[3].credits).toBe(0);
  });

  it("returns the invalid result when nothing counts", () => {
    expect(calculateGpa([])).toMatchObject({ valid: false, gpa: 0, totalCredits: 0 });
    expect(calculateGpa([{ name: "", grade: "", credits: "" }]).valid).toBe(false);
  });

  it("uses 4.3 for A+ on the 4.3 scale", () => {
    expect(calculateGpa([{ name: "x", grade: "A+", credits: 1 }], "4.3").gpa).toBe(4.3);
  });
});

describe("cumulativeGpa", () => {
  it("blends prior and term GPA by credits", () => {
    // (3.2 * 60 + 3.8 * 15) / 75 = (192 + 57) / 75 = 3.32
    const r = cumulativeGpa(3.2, 60, 3.8, 15);
    expect(r.gpa).toBeCloseTo(3.32, 10);
    expect(r.credits).toBe(75);
    expect(r.valid).toBe(true);
  });

  it("falls back to whichever half is valid", () => {
    expect(cumulativeGpa(Number.NaN, 0, 3.5, 12)).toEqual({ gpa: 3.5, credits: 12, valid: true });
    expect(cumulativeGpa(3.1, 30, 4, 0)).toEqual({ gpa: 3.1, credits: 30, valid: true });
    expect(cumulativeGpa(0, 0, 0, 0)).toEqual({ gpa: 0, credits: 0, valid: false });
  });
});

describe("grade scales, excluded rows and credits", () => {
  it("does not read 4.5, 5 or 10 as a percentage (a silent F)", () => {
    expect(parseGrade("5")).toBeNull();
    expect(parseGrade("4.5")).toBeNull();
    expect(parseGrade("10")).toBeNull();
    expect(parseGrade("4.2", "4.3")).toEqual({ points: 4.2, letter: "A" });
    expect(parseGrade("59")?.letter).toBe("F"); // a real percentage
    expect(parseGrade("3abc")).toBeNull();
  });

  it("converts Russian marks 5/4/3/2 to 4.0/3.0/2.0/0 in the ru5 system", () => {
    expect(parseGrade("5", "4.0", "ru5")).toMatchObject({ points: 4, ruMark: 5 });
    expect(parseGrade("4", "4.0", "ru5")).toMatchObject({ points: 3, ruMark: 4 });
    expect(parseGrade("3", "4.0", "ru5")).toMatchObject({ points: 2, ruMark: 3 });
    expect(parseGrade("2", "4.0", "ru5")).toMatchObject({ points: 0, ruMark: 2 });
    expect(parseGrade("отл.", "4.0", "ru5")).toMatchObject({ ruMark: 5 });
    expect(parseGrade("Хорошо", "4.0", "ru5")).toMatchObject({ ruMark: 4 });
    // Letters, decimals and percentages keep working.
    expect(parseGrade("A-", "4.0", "ru5")?.points).toBe(3.7);
    expect(parseGrade("3.7", "4.0", "ru5")?.points).toBe(3.7);
    expect(parseGrade("92", "4.0", "ru5")?.letter).toBe("A-");
  });

  it("ru5: marks without credits weigh the same, and the 5-point average is reported", () => {
    const r = calculateGpa(
      [
        { name: "Матанализ", grade: "5", credits: "" },
        { name: "Физика", grade: "4", credits: "" },
        { name: "История", grade: "5", credits: "" },
      ],
      "4.0",
      { system: "ru5" },
    );
    expect(r.valid).toBe(true);
    expect(r.gpa).toBeCloseTo(11 / 3, 10);
    expect(r.fivePointAverage).toBeCloseTo(14 / 3, 10);
    expect(r.totalCredits).toBe(3);
  });

  it("excludes pass/fail, withdrawals, «зачёт» and 0-credit rows without an error", () => {
    const r = calculateGpa(
      [
        { name: "a", grade: "A", credits: 3 },
        { name: "p", grade: "P", credits: 3 },
        { name: "z", grade: "A", credits: 0 },
        { name: "w", grade: "w", credits: 2 },
        { name: "зач", grade: "зачёт", credits: 2 },
      ],
      "4.0",
      { system: "ru5" },
    );
    expect(r.gpa).toBe(4);
    expect(r.totalCredits).toBe(3);
    expect(r.courses.slice(1).map((c) => [c.valid, c.excluded])).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [true, true],
    ]);
  });

  it("adds fractional credits without float noise", () => {
    const r = calculateGpa([
      { name: "a", grade: "A", credits: "0.1" },
      { name: "b", grade: "A", credits: "0.2" },
    ]);
    expect(r.totalCredits).toBe(0.3);
  });

  it("builds the letter / percent / points table from the engine's own scale", () => {
    const t = letterScaleTable();
    expect(t[0]).toEqual({ letter: "A+", minPercent: 97, points: 4 });
    expect(t.find((r) => r.letter === "B")).toEqual({ letter: "B", minPercent: 83, points: 3 });
    expect(t[t.length - 1]).toEqual({ letter: "F", minPercent: 0, points: 0 });
  });
});
