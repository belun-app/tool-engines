import { describe, expect, it, vi } from "vitest";
import {
  GRADE_SCALES,
  MAX_CHART_ROWS,
  buildGradeChart,
  calculateGrade,
  gradeFromPercent,
  gradeThresholds,
  roundPercent,
} from "./grade-calculator.js";

describe("calculateGrade", () => {
  it("scores 20 questions with 3 wrong as 85% B", () => {
    // 17 / 20 = 0.85 -> 85% -> B on the standard 90/80/70/60 scale
    const r = calculateGrade({ total: 20, wrong: 3 });
    expect(r.valid).toBe(true);
    expect(r.correct).toBe(17);
    expect(r.rawPercent).toBe(85);
    expect(r.percent).toBe(85);
    expect(r.letter).toBe("B");
    expect(r.gradePoints).toBe(3);
    expect(r.passed).toBe(true);
    expect(r.clamped).toBe(false);
  });

  it("rounds the percentage to the requested decimals", () => {
    // 2 / 3 = 66.666...%
    expect(calculateGrade({ total: 3, wrong: 1 }).percent).toBe(66.67);
    expect(calculateGrade({ total: 3, wrong: 1, decimals: 0 }).percent).toBe(67);
    expect(calculateGrade({ total: 3, wrong: 1, decimals: 1 }).percent).toBe(66.7);
  });

  it("puts band edges in the higher band (min is inclusive)", () => {
    expect(calculateGrade({ total: 10, wrong: 1 }).letter).toBe("A"); // 90%
    expect(calculateGrade({ total: 10, wrong: 4 }).letter).toBe("D"); // 60%
    expect(calculateGrade({ total: 10, wrong: 5 }).letter).toBe("F"); // 50%
    expect(calculateGrade({ total: 10, wrong: 5 }).passed).toBe(false);
  });

  it("applies a curve and caps the curved percentage at 100", () => {
    const r = calculateGrade({ total: 10, wrong: 2, curve: 5 }); // 80 + 5
    expect(r.rawPercent).toBe(80);
    expect(r.percent).toBe(85);
    expect(r.letter).toBe("B");
    expect(calculateGrade({ total: 10, wrong: 0, curve: 10 }).percent).toBe(100);
  });

  it("ignores a non-finite curve", () => {
    expect(calculateGrade({ total: 10, wrong: 2, curve: Number.NaN }).percent).toBe(80);
  });

  it("clamps wrong answers into 0…total and flags it", () => {
    const over = calculateGrade({ total: 10, wrong: 15 });
    expect(over.wrong).toBe(10);
    expect(over.correct).toBe(0);
    expect(over.percent).toBe(0);
    expect(over.clamped).toBe(true);
    const under = calculateGrade({ total: 10, wrong: -2 });
    expect(under.wrong).toBe(0);
    expect(under.percent).toBe(100);
    expect(under.clamped).toBe(true);
  });

  it("returns the invalid result for zero, negative or non-finite input", () => {
    for (const input of [
      { total: 0, wrong: 0 },
      { total: -5, wrong: 1 },
      { total: Number.NaN, wrong: 1 },
      { total: Number.POSITIVE_INFINITY, wrong: 1 },
      { total: 10, wrong: Number.NaN },
    ]) {
      const r = calculateGrade(input);
      expect(r.valid).toBe(false);
      expect(r.letter).toBe("—");
      expect(r.percent).toBe(0);
    }
  });

  it("uses the plus/minus scale and its grade points", () => {
    const bands = GRADE_SCALES["plus-minus"];
    expect(calculateGrade({ total: 100, wrong: 2, bands }).letter).toBe("A+"); // 98
    expect(calculateGrade({ total: 100, wrong: 12, bands }).letter).toBe("B+"); // 88
    expect(calculateGrade({ total: 100, wrong: 12, bands }).gradePoints).toBe(3.3);
    expect(calculateGrade({ total: 100, wrong: 38, bands }).letter).toBe("D-"); // 62
  });

  it("uses the seven-point scale", () => {
    const bands = GRADE_SCALES["seven-point"];
    expect(calculateGrade({ total: 100, wrong: 8, bands }).letter).toBe("B"); // 92
    expect(calculateGrade({ total: 100, wrong: 31, bands }).letter).toBe("F"); // 69
  });

  it("uses the Russian five-point scale (no 4.0 grade points)", () => {
    const bands = GRADE_SCALES["five-point"];
    const r = calculateGrade({ total: 20, wrong: 3, bands }); // 85%
    expect(r.letter).toBe("5");
    expect(r.gradePoints).toBe(0);
    expect(calculateGrade({ total: 20, wrong: 10, bands }).letter).toBe("3"); // 50%
    expect(calculateGrade({ total: 20, wrong: 11, bands }).passed).toBe(false); // 45% -> 2
  });

  it("uses pass/fail", () => {
    const bands = GRADE_SCALES["pass-fail"];
    expect(calculateGrade({ total: 10, wrong: 4, bands }).letter).toBe("Pass");
    expect(calculateGrade({ total: 10, wrong: 5, bands }).letter).toBe("Fail");
  });

  it("sorts custom bands and falls back to 60% pass with a single band", () => {
    const r = calculateGrade({
      total: 10,
      wrong: 3,
      bands: [
        { letter: "Low", min: 0 },
        { letter: "High", min: 50 },
      ],
    });
    expect(r.letter).toBe("High");
    expect(r.passed).toBe(true);
    const single = calculateGrade({ total: 10, wrong: 5, bands: [{ letter: "X", min: 0 }] });
    expect(single.letter).toBe("X");
    expect(single.passed).toBe(false); // 50 < 60
  });

  it("handles fractional point totals", () => {
    // 47.5 points possible, 2.5 lost -> 45 / 47.5 = 94.7368...%
    expect(calculateGrade({ total: 47.5, wrong: 2.5 }).percent).toBe(94.74);
  });
});

describe("gradeFromPercent", () => {
  it("returns the lowest band below every minimum and F for no bands", () => {
    expect(gradeFromPercent(-10, GRADE_SCALES.standard)).toBe("F");
    expect(gradeFromPercent(50, [])).toBe("F");
    expect(gradeFromPercent(10, [{ letter: "Z", min: 20 }])).toBe("Z");
  });
});

describe("buildGradeChart", () => {
  it("has one row per possible number of wrong answers", () => {
    const rows = buildGradeChart({ total: 4 });
    expect(rows.map((r) => r.percent)).toEqual([100, 75, 50, 25, 0]);
    expect(rows.map((r) => r.letter)).toEqual(["A", "C", "F", "F", "F"]);
    expect(rows[1]).toEqual({ wrong: 1, correct: 3, percent: 75, letter: "C" });
  });

  it("stops at MAX_CHART_ROWS rows", () => {
    expect(buildGradeChart({ total: 500 })).toHaveLength(MAX_CHART_ROWS);
  });

  it("returns no rows for invalid totals", () => {
    expect(buildGradeChart({ total: 0 })).toEqual([]);
    expect(buildGradeChart({ total: Number.NaN })).toEqual([]);
  });
});

describe("gradeThresholds", () => {
  it("gives fewest correct and most wrong for every letter", () => {
    // 20 questions: A >= 18, B >= 16, C >= 14, D >= 12, F >= 0
    const t = gradeThresholds({ total: 20 });
    expect(t.map((x) => [x.letter, x.minCorrect, x.maxWrong])).toEqual([
      ["A", 18, 2],
      ["B", 16, 4],
      ["C", 14, 6],
      ["D", 12, 8],
      ["F", 0, 20],
    ]);
  });

  it("takes the curve into account", () => {
    // +10 curve: A needs 80% raw -> 16 of 20
    expect(gradeThresholds({ total: 20, curve: 10 })[0].minCorrect).toBe(16);
  });

  it("marks a letter that cannot be reached with maxWrong null", () => {
    const t = gradeThresholds({ total: 10, curve: -20 }); // max 80%
    expect(t[0]).toEqual({ letter: "A", minPercent: 90, minCorrect: 10, maxWrong: null });
  });

  it("returns nothing for an invalid total", () => {
    expect(gradeThresholds({ total: -1 })).toEqual([]);
  });
});

describe("rounding, scales and threshold search", () => {
  it("rounds an exact .5 up even when the float is just below it", () => {
    // 23 / 40 * 100 = 57.49999999999999 in a double
    expect(calculateGrade({ total: 40, wrong: 17, decimals: 0 }).percent).toBe(58);
    expect(calculateGrade({ total: 80, wrong: 57, decimals: 1 }).percent).toBe(28.8);
    expect(roundPercent(89.5, 0)).toBe(90);
    expect(roundPercent(84.49, 0)).toBe(84);
  });

  it("agrees with exact integer rounding for every small test", () => {
    for (let total = 1; total <= 120; total++) {
      for (let correct = 0; correct <= total; correct++) {
        // exact half-up on integers: round(correct * 100 / total)
        const exact = Math.floor((correct * 200 + total) / (2 * total));
        expect(calculateGrade({ total, wrong: total - correct, decimals: 0 }).percent).toBe(exact);
      }
    }
  });

  it("has the Kazakhstan SOR/SOCh scale (85/65/40)", () => {
    const bands = GRADE_SCALES["kz-sor-soch"];
    // 13 of 20 = 65% is a 4 here and a 3 on the 85/70/50 norm
    expect(calculateGrade({ total: 20, wrong: 7, bands }).letter).toBe("4");
    expect(calculateGrade({ total: 20, wrong: 7, bands: GRADE_SCALES["five-point"] }).letter).toBe(
      "3",
    );
    expect(calculateGrade({ total: 20, wrong: 12, bands }).letter).toBe("3"); // 40%
    expect(calculateGrade({ total: 20, wrong: 13, bands }).letter).toBe("2"); // 35%
    expect(gradeThresholds({ total: 20, wrong: 0, bands }).map((t) => t.minCorrect)).toEqual([
      17, 13, 8, 0,
    ]);
  });

  it("finds thresholds for a huge total exactly, by binary search", () => {
    // Math.floor runs once per search step (and a few times per score); a linear scan over
    // 100 000 000 answers would call it hundreds of millions of times.
    const floor = vi.spyOn(Math, "floor");
    // 2 decimals: 89.995% already rounds to 90.00%
    const t = gradeThresholds({ total: 100_000_000, wrong: 0, decimals: 2 });
    expect(floor.mock.calls.length).toBeLessThan(10_000);
    floor.mockRestore();
    expect(t.map((r) => r.minCorrect)).toEqual([89_995_000, 79_995_000, 69_995_000, 59_995_000, 0]);
  });

  it("binary-searched thresholds match a linear scan", () => {
    for (const total of [7, 13, 20, 33, 40, 97]) {
      for (const curve of [0, 4.5, -10]) {
        for (const decimals of [0, 1, 2]) {
          const fast = gradeThresholds({ total, wrong: 0, curve, decimals });
          for (const row of fast) {
            let linear: number | null = null;
            for (let c = 0; c <= total; c++) {
              const p = calculateGrade({ total, wrong: total - c, curve, decimals }).percent;
              if (p >= row.minPercent) {
                linear = c;
                break;
              }
            }
            expect(row.maxWrong === null ? null : row.minCorrect).toBe(linear);
          }
        }
      }
    }
  });
});
