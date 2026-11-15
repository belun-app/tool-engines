/**
 * Test grade from the number of questions and the number missed, with grading scales, an
 * optional curve, a full grade chart and the score needed for each letter.
 */

import { letterToPoints } from "./gpa-calculator.js";

/** Named grading scales. `bands` on the input overrides these. */
export type GradeScaleId =
  | "standard"
  | "plus-minus"
  | "seven-point"
  | "pass-fail"
  | "five-point"
  | "kz-sor-soch";

export interface GradeBand {
  letter: string;
  /** Lowest percentage (inclusive) that still earns this letter */
  min: number;
}

export interface GradeInput {
  /** Questions on the test, or total points possible */
  total: number;
  /** Questions answered wrong, or points lost */
  wrong: number;
  /** Percentage points added to every score. 0 means no curve. */
  curve?: number;
  /** Decimal places the percentage is rounded to before the letter is picked */
  decimals?: number;
  bands?: GradeBand[];
}

/** Input of the grade chart and the thresholds, which do not need the number wrong. */
export type GradeScaleInput = Omit<GradeInput, "wrong"> & { wrong?: number };

export interface GradeResult {
  valid: boolean;
  total: number;
  wrong: number;
  correct: number;
  /** Percentage before the curve */
  rawPercent: number;
  /** Percentage after the curve, capped at 100 */
  percent: number;
  letter: string;
  /** 4.0-scale grade points for the letter, or 0 when the scale has none */
  gradePoints: number;
  passed: boolean;
  /** True when `wrong` fell outside 0…total and had to be pulled back in */
  clamped: boolean;
}

export interface GradeChartRow {
  wrong: number;
  correct: number;
  percent: number;
  letter: string;
}

export interface GradeThreshold {
  letter: string;
  minPercent: number;
  /** Fewest correct answers that still reach this letter */
  minCorrect: number;
  /** Most answers you can miss and still reach it, or null when it is out of reach */
  maxWrong: number | null;
}

/** Rows above this and the chart becomes unusable, so it stops there. */
export const MAX_CHART_ROWS = 101;

export const GRADE_SCALES: Record<GradeScaleId, GradeBand[]> = {
  standard: [
    { letter: "A", min: 90 },
    { letter: "B", min: 80 },
    { letter: "C", min: 70 },
    { letter: "D", min: 60 },
    { letter: "F", min: 0 },
  ],
  "plus-minus": [
    { letter: "A+", min: 97 },
    { letter: "A", min: 93 },
    { letter: "A-", min: 90 },
    { letter: "B+", min: 87 },
    { letter: "B", min: 83 },
    { letter: "B-", min: 80 },
    { letter: "C+", min: 77 },
    { letter: "C", min: 73 },
    { letter: "C-", min: 70 },
    { letter: "D+", min: 67 },
    { letter: "D", min: 63 },
    { letter: "D-", min: 60 },
    { letter: "F", min: 0 },
  ],
  "seven-point": [
    { letter: "A", min: 93 },
    { letter: "B", min: 85 },
    { letter: "C", min: 77 },
    { letter: "D", min: 70 },
    { letter: "F", min: 0 },
  ],
  "pass-fail": [
    { letter: "Pass", min: 60 },
    { letter: "Fail", min: 0 },
  ],
  /** Russian/CIS school marks: 5 from 85%, 4 from 70%, 3 from 50%. */
  "five-point": [
    { letter: "5", min: 85 },
    { letter: "4", min: 70 },
    { letter: "3", min: 50 },
    { letter: "2", min: 0 },
  ],
  /**
   * Kazakhstan, summative assessment (СОР/СОЧ), grades 2–12:
   * 5 from 85%, 4 from 65%, 3 from 40%.
   */
  "kz-sor-soch": [
    { letter: "5", min: 85 },
    { letter: "4", min: 65 },
    { letter: "3", min: 40 },
    { letter: "2", min: 0 },
  ],
};

/**
 * Half-up rounding that is not fooled by binary floats: 23 / 40 * 100 is
 * 57.49999999999999 in a double, but it is 57.5 and rounds to 58. Snapping to
 * 12 significant digits first removes that representation error.
 */
export function roundPercent(value: number, decimals: number): number {
  const factor = 10 ** Math.max(0, Math.min(6, Math.trunc(decimals)));
  return Math.round(Number((value * factor).toPrecision(12))) / factor;
}

const round = roundPercent;

/** Percentage for `correct` out of `total`, with the curve, capped at 100, rounded. */
function scoreFor(correct: number, total: number, curve: number, decimals: number): number {
  return round(Math.min((correct / total) * 100 + curve, 100), decimals);
}

function resolveBands(input: Pick<GradeInput, "bands">): GradeBand[] {
  const bands = input.bands?.length ? input.bands : GRADE_SCALES.standard;
  return [...bands].sort((a, b) => b.min - a.min);
}

/** Pick the letter for a percentage. `bands` must be sorted high to low. */
export function gradeFromPercent(percent: number, bands: GradeBand[]): string {
  for (const band of bands) {
    if (percent >= band.min) return band.letter;
  }
  return bands[bands.length - 1]?.letter ?? "F";
}

/** Score a test from its question count and the number missed. */
export function calculateGrade(input: GradeInput): GradeResult {
  const decimals = input.decimals ?? 2;
  const curve = Number.isFinite(input.curve) ? (input.curve as number) : 0;
  const bands = resolveBands(input);
  const total = input.total;

  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(input.wrong)) {
    return {
      valid: false,
      total: 0,
      wrong: 0,
      correct: 0,
      rawPercent: 0,
      percent: 0,
      letter: "—",
      gradePoints: 0,
      passed: false,
      clamped: false,
    };
  }

  const wrong = Math.min(Math.max(input.wrong, 0), total);
  const clamped = wrong !== input.wrong;
  const correct = total - wrong;

  const rawPercent = round((correct / total) * 100, decimals);
  const percent = scoreFor(correct, total, curve, decimals);
  const letter = gradeFromPercent(percent, bands);
  const lowest = bands[bands.length - 1];

  return {
    valid: true,
    total,
    wrong,
    correct,
    rawPercent,
    percent,
    letter,
    gradePoints: letterToPoints(letter) ?? 0,
    passed: bands.length > 1 ? letter !== lowest?.letter : percent >= 60,
    clamped,
  };
}

/**
 * One row per possible number of wrong answers — the printable chart teachers
 * keep next to the stack of tests. Stops at MAX_CHART_ROWS rows.
 */
export function buildGradeChart(input: GradeScaleInput): GradeChartRow[] {
  const decimals = input.decimals ?? 2;
  const curve = Number.isFinite(input.curve) ? (input.curve as number) : 0;
  const bands = resolveBands(input);
  const total = input.total;

  if (!Number.isFinite(total) || total <= 0) return [];

  const rows: GradeChartRow[] = [];
  const last = Math.min(Math.floor(total), MAX_CHART_ROWS - 1);

  for (let wrong = 0; wrong <= last; wrong++) {
    const correct = total - wrong;
    const percent = scoreFor(correct, total, curve, decimals);
    rows.push({ wrong, correct, percent, letter: gradeFromPercent(percent, bands) });
  }

  return rows;
}

/**
 * For each letter on the scale, the fewest correct answers that reach it —
 * the "how many can I miss and still get a B" question, answered for every grade.
 */
export function gradeThresholds(input: GradeScaleInput): GradeThreshold[] {
  const decimals = input.decimals ?? 2;
  const curve = Number.isFinite(input.curve) ? (input.curve as number) : 0;
  const bands = resolveBands(input);
  const total = input.total;

  if (!Number.isFinite(total) || total <= 0) return [];

  // Whole questions only: a student cannot answer 4.5 of them correctly.
  const steps = Math.max(1, Math.floor(total));

  return bands.map((band) => {
    // The score only grows with the number correct, so the first passing count
    // is found by binary search: O(log n) even for a 100 000 000-point test.
    let minCorrect: number | null = null;
    if (scoreFor(steps, total, curve, decimals) >= band.min) {
      let lo = 0;
      let hi = steps;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (scoreFor(mid, total, curve, decimals) >= band.min) hi = mid;
        else lo = mid + 1;
      }
      minCorrect = lo;
    }

    return {
      letter: band.letter,
      minPercent: band.min,
      minCorrect: minCorrect ?? steps,
      maxWrong: minCorrect === null ? null : steps - minCorrect,
    };
  });
}
