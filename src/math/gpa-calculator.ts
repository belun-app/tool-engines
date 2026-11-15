/**
 * Grade point average from course grades and credit hours on the 4.0 or 4.3 scale, with
 * honors and AP/IB weighting, cumulative GPA and US letter-grade conversions.
 */

/** 4.0 treats A and A+ alike; 4.3 gives A+ its own extra third of a point. */
export type GpaScale = "4.0" | "4.3";

/**
 * How whole numbers in the grade box are read.
 * `us`: letters, 4.0-scale points (3.7) or percentages (92, 92%).
 * `ru5`: also Russian / CIS marks 5, 4, 3, 2 (and «отлично»… «неуд»), which
 * convert to 4.0, 3.0, 2.0 and 0 — the usual conversion of a Russian diploma
 * or school certificate. Letters, decimals and percentages still work.
 */
export type GradeSystem = "us" | "ru5";

/** Russian / CIS mark → 4.0-scale grade points. */
export const RU5_TO_GPA: ReadonlyArray<{ mark: number; points: number }> = [
  { mark: 5, points: 4 },
  { mark: 4, points: 3 },
  { mark: 3, points: 2 },
  { mark: 2, points: 0 },
  { mark: 1, points: 0 },
];

const RU5_WORDS: Record<string, number> = {
  ОТЛ: 5,
  ОТЛИЧНО: 5,
  ХОР: 4,
  ХОРОШО: 4,
  УД: 3,
  УДОВЛ: 3,
  УДОВЛЕТВОРИТЕЛЬНО: 3,
  НЕУД: 2,
  НЕУДОВЛЕТВОРИТЕЛЬНО: 2,
};

/**
 * Grades that do not count toward a GPA: pass/fail, withdrawals, incompletes,
 * not-for-credit attendance (AU), and the Russian pass/fail grades.
 */
const EXCLUDED_GRADES = new Set([
  "P",
  "NP",
  "S",
  "U",
  "W",
  "WP",
  "I",
  "IP",
  "CR",
  "NC",
  "AU",
  "ЗАЧ",
  "ЗАЧЁТ",
  "ЗАЧЕТ",
  "ЗАЧТЕНО",
  "НЕЗАЧЁТ",
  "НЕЗАЧЕТ",
  "НЕЗАЧТЕНО",
]);

/** True for P, W, CR, «зачёт» and the like: listed, but not part of the GPA. */
export function isExcludedGrade(raw: string): boolean {
  return EXCLUDED_GRADES.has(normalizeLetter(raw).replace(/\.$/, ""));
}

/** Weighted-GPA course difficulty. Honors adds 0.5, AP/IB adds 1.0. */
export type CourseLevel = "regular" | "honors" | "ap";

export interface GpaCourseInput {
  name: string;
  /** Letter grade (A-, B+), a raw grade point (3.7), or a percentage (92%) */
  grade: string;
  credits: string | number;
  level?: CourseLevel;
}

export interface GpaCourseResult {
  name: string;
  /** Normalised letter grade, or the raw input when it could not be matched */
  grade: string;
  credits: number;
  /** Grade points on the chosen scale, before any honors/AP bonus */
  basePoints: number;
  /** Grade points after the honors/AP bonus */
  points: number;
  qualityPoints: number;
  level: CourseLevel;
  valid: boolean;
  /** Pass/fail, withdrawal or 0 credits: shown, not counted, not an error. */
  excluded: boolean;
  /** The Russian mark (5–2) when the grade was entered as one, else null. */
  ruMark: number | null;
}

export interface GpaResult {
  valid: boolean;
  /** Weighted for course level when any course is honors or AP */
  gpa: number;
  unweightedGpa: number;
  totalCredits: number;
  totalQualityPoints: number;
  /** True when at least one course is above regular level */
  weighted: boolean;
  /** Credit-weighted average of the courses entered as Russian marks, or null. */
  fivePointAverage: number | null;
  courses: GpaCourseResult[];
}

export interface GpaOptions {
  system?: GradeSystem;
}

const LEVEL_BONUS: Record<CourseLevel, number> = {
  regular: 0,
  honors: 0.5,
  ap: 1,
};

const LETTER_POINTS: Record<string, number> = {
  "A+": 4,
  A: 4,
  "A-": 3.7,
  "B+": 3.3,
  B: 3,
  "B-": 2.7,
  "C+": 2.3,
  C: 2,
  "C-": 1.7,
  "D+": 1.3,
  D: 1,
  "D-": 0.7,
  F: 0,
  E: 0,
};

/** Percentage floors used by the standard US letter scale. */
const PERCENT_SCALE: Array<[number, string]> = [
  [97, "A+"],
  [93, "A"],
  [90, "A-"],
  [87, "B+"],
  [83, "B"],
  [80, "B-"],
  [77, "C+"],
  [73, "C"],
  [70, "C-"],
  [67, "D+"],
  [63, "D"],
  [60, "D-"],
  [0, "F"],
];

/** Grade-point floors, used to turn a finished GPA back into a letter. */
const GPA_LETTERS: Array<[number, string]> = [
  [3.85, "A"],
  [3.5, "A-"],
  [3.15, "B+"],
  [2.85, "B"],
  [2.5, "B-"],
  [2.15, "C+"],
  [1.85, "C"],
  [1.5, "C-"],
  [1.15, "D+"],
  [0.85, "D"],
  [0.5, "D-"],
  [0, "F"],
];

export function normalizeLetter(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "").replace("−", "-").replace("–", "-");
}

/** Convert a percentage (0–100) to the matching US letter grade. */
export function percentToLetter(percent: number): string {
  for (const [floor, letter] of PERCENT_SCALE) {
    if (percent >= floor) return letter;
  }
  return "F";
}

/** Convert a final GPA to its closest letter equivalent. */
export function gpaToLetter(gpa: number): string {
  for (const [floor, letter] of GPA_LETTERS) {
    if (gpa >= floor) return letter;
  }
  return "F";
}

export function letterToPoints(letter: string, scale: GpaScale = "4.0"): number | null {
  const key = normalizeLetter(letter);
  const points = LETTER_POINTS[key];
  if (points === undefined) return null;
  if (key === "A+" && scale === "4.3") return 4.3;
  return points;
}

/**
 * Accepts a letter grade (A-), a grade point (3.7), or a percentage (92 / 92%)
 * and returns both the grade points and the letter it maps to.
 */
export function parseGrade(
  raw: string,
  scale: GpaScale = "4.0",
  system: GradeSystem = "us",
): { points: number; letter: string; ruMark?: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const asLetter = letterToPoints(trimmed, scale);
  if (asLetter !== null) return { points: asLetter, letter: normalizeLetter(trimmed) };

  if (system === "ru5") {
    const word = RU5_WORDS[normalizeLetter(trimmed).replace(/\.$/, "")];
    const mark = word ?? (/^[1-5]$/.test(trimmed) ? Number(trimmed) : undefined);
    if (mark !== undefined) {
      const points = RU5_TO_GPA.find((m) => m.mark === mark)?.points ?? 0;
      return { points, letter: gpaToLetter(points), ruMark: mark };
    }
  }

  const isPercent = trimmed.endsWith("%");
  const body = trimmed.replace("%", "").replace(",", ".").trim();
  // Whole input must be a number: "3abc" is not 3.0.
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(body)) return null;
  const value = Number(body);
  if (!Number.isFinite(value) || value < 0) return null;

  const max = scale === "4.3" ? 4.3 : 4;

  // Just above the ceiling (4.5, 5, 10) is another scale — a weighted point, a
  // Russian 5 or a 10-point mark — not 5 %. Refuse it instead of a silent F.
  if (!isPercent && value > max && value <= 10) return null;

  // Anything else above the scale ceiling can only be a percentage.
  if (isPercent || value > max) {
    if (value > 100) return null;
    const letter = percentToLetter(value);
    const points = letterToPoints(letter, scale);
    return points === null ? null : { points, letter };
  }

  return { points: value, letter: gpaToLetter(value) };
}

export function calculateGpa(
  courses: GpaCourseInput[],
  scale: GpaScale = "4.0",
  options: GpaOptions = {},
): GpaResult {
  const system = options.system ?? "us";
  const results: GpaCourseResult[] = [];

  let totalCredits = 0;
  let weightedQualityPoints = 0;
  let unweightedQualityPoints = 0;
  let weighted = false;
  let markCredits = 0;
  let markSum = 0;

  for (const course of courses) {
    const level: CourseLevel = course.level ?? "regular";
    const rawCredits = typeof course.credits === "number" ? String(course.credits) : course.credits;
    // A Russian transcript often has no credits: every mark then weighs the same.
    const credits =
      system === "ru5" && String(rawCredits).trim() === ""
        ? 1
        : Number.parseFloat(String(rawCredits).replace(",", "."));
    const base = {
      name: course.name,
      basePoints: 0,
      points: 0,
      qualityPoints: 0,
      level,
      ruMark: null,
    };

    // Pass/fail, withdrawals and 0-credit courses are listed but not counted.
    if (course.grade.trim() !== "" && (isExcludedGrade(course.grade) || credits === 0)) {
      results.push({
        ...base,
        grade: course.grade.trim(),
        credits: Number.isFinite(credits) && credits > 0 ? credits : 0,
        valid: true,
        excluded: true,
      });
      continue;
    }

    const parsed = parseGrade(course.grade, scale, system);
    const validCredits = Number.isFinite(credits) && credits > 0;

    if (!parsed || !validCredits) {
      results.push({
        ...base,
        grade: course.grade.trim(),
        credits: validCredits ? credits : 0,
        valid: false,
        excluded: false,
      });
      continue;
    }

    const points = parsed.points + LEVEL_BONUS[level];
    const qualityPoints = points * credits;

    if (level !== "regular") weighted = true;
    totalCredits += credits;
    weightedQualityPoints += qualityPoints;
    unweightedQualityPoints += parsed.points * credits;

    if (parsed.ruMark !== undefined) {
      markCredits += credits;
      markSum += parsed.ruMark * credits;
    }

    results.push({
      name: course.name,
      grade: parsed.letter,
      credits,
      basePoints: parsed.points,
      points,
      qualityPoints,
      level,
      valid: true,
      excluded: false,
      ruMark: parsed.ruMark ?? null,
    });
  }

  // 0.1 + 0.2 credits is 0.3, not 0.30000000000000004.
  const tidy = (n: number) => Number(n.toFixed(10));
  const fivePointAverage = markCredits > 0 ? markSum / markCredits : null;

  if (totalCredits === 0) {
    return {
      valid: false,
      gpa: 0,
      unweightedGpa: 0,
      totalCredits: 0,
      totalQualityPoints: 0,
      weighted: false,
      fivePointAverage,
      courses: results,
    };
  }

  return {
    valid: true,
    gpa: weightedQualityPoints / totalCredits,
    unweightedGpa: unweightedQualityPoints / totalCredits,
    totalCredits: tidy(totalCredits),
    totalQualityPoints: weightedQualityPoints,
    weighted,
    fivePointAverage,
    courses: results,
  };
}

/**
 * Combine a prior cumulative GPA with the current term.
 * Returns the running cumulative GPA across both.
 */
export function cumulativeGpa(
  priorGpa: number,
  priorCredits: number,
  termGpa: number,
  termCredits: number,
): { gpa: number; credits: number; valid: boolean } {
  const validPrior = Number.isFinite(priorGpa) && Number.isFinite(priorCredits) && priorCredits > 0;
  const validTerm = Number.isFinite(termGpa) && Number.isFinite(termCredits) && termCredits > 0;

  if (!validPrior && !validTerm) return { gpa: 0, credits: 0, valid: false };
  if (!validPrior) return { gpa: termGpa, credits: termCredits, valid: true };
  if (!validTerm) return { gpa: priorGpa, credits: priorCredits, valid: true };

  const credits = priorCredits + termCredits;
  return {
    gpa: (priorGpa * priorCredits + termGpa * termCredits) / credits,
    credits,
    valid: true,
  };
}

/** Percent floor → letter → 4.0 points, high to low: the page's scale table. */
export function letterScaleTable(): Array<{ letter: string; minPercent: number; points: number }> {
  return PERCENT_SCALE.map(([minPercent, letter]) => ({
    letter,
    minPercent,
    points: LETTER_POINTS[letter] ?? 0,
  }));
}
