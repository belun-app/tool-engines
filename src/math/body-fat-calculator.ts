/**
 * Body fat percentage by the US Navy tape method, with the Deurenberg BMI-based estimate for
 * comparison and a category for the person's sex.
 */

export type Sex = "male" | "female";

/** American Council on Exercise body-fat bands. */
export type BodyFatCategory = "essential" | "athletes" | "fitness" | "average" | "obese" | "";

export interface BodyFatInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  /** Narrowest point of the neck, just below the larynx. */
  neckCm: number;
  /** Men: at the navel. Women: at the narrowest point of the waist. */
  waistCm: number;
  /** Widest point of the hips. Only used for women. */
  hipCm: number;
}

export interface BodyFatResult {
  /** U.S. Navy tape-method body fat in percent, one decimal. Null when a measurement is missing. */
  navyPercent: number | null;
  /** Deurenberg BMI-method body fat in percent — printed next to the Navy figure for comparison. */
  bmiPercent: number | null;
  bmi: number | null;
  /** Band for whichever estimate is available, Navy first. */
  category: BodyFatCategory;
  fatMassKg: number | null;
  leanMassKg: number | null;
  /** Jackson & Pollock ideal body fat for this age and sex. */
  idealPercent: number | null;
  /** Fat to shed to reach idealPercent with lean mass held constant. Negative means already leaner. */
  fatToLoseKg: number | null;
  /** Body weight at idealPercent, lean mass held constant. */
  idealWeightKg: number | null;
}

const EMPTY: BodyFatResult = {
  navyPercent: null,
  bmiPercent: null,
  bmi: null,
  category: "",
  fatMassKg: null,
  leanMassKg: null,
  idealPercent: null,
  fatToLoseKg: null,
  idealWeightKg: null,
};

/**
 * Jackson & Pollock reference body fat by age — the table calculator.net and most
 * fitness sites quote. Values rise with age because lean mass falls; ages between
 * two rows are interpolated, ages outside the table are clamped to the nearest row.
 */
const IDEAL_BY_AGE: Record<Sex, Array<[number, number]>> = {
  male: [
    [20, 8.5],
    [25, 10.5],
    [30, 12.7],
    [35, 13.7],
    [40, 15.3],
    [45, 16.4],
    [50, 18.9],
    [55, 20.9],
  ],
  female: [
    [20, 17.7],
    [25, 18.4],
    [30, 19.3],
    [35, 21.5],
    [40, 22.2],
    [45, 22.9],
    [50, 25.2],
    [55, 26.3],
  ],
};

const round1 = (n: number) => Math.round(n * 10) / 10;

const log10 = (n: number) => Math.log10(n);

function idealPercentFor(sex: Sex, age: number): number {
  const table = IDEAL_BY_AGE[sex];
  const first = table[0];
  const last = table[table.length - 1];
  if (age <= first[0]) return first[1];
  if (age >= last[0]) return last[1];

  for (let i = 1; i < table.length; i++) {
    const [upperAge, upperValue] = table[i];
    if (age <= upperAge) {
      const [lowerAge, lowerValue] = table[i - 1];
      const t = (age - lowerAge) / (upperAge - lowerAge);
      return round1(lowerValue + t * (upperValue - lowerValue));
    }
  }
  return last[1];
}

export function classifyBodyFat(percent: number, sex: Sex): BodyFatCategory {
  if (!Number.isFinite(percent)) return "";
  if (sex === "male") {
    if (percent < 6) return "essential";
    if (percent < 14) return "athletes";
    if (percent < 18) return "fitness";
    if (percent < 25) return "average";
    return "obese";
  }
  if (percent < 14) return "essential";
  if (percent < 21) return "athletes";
  if (percent < 25) return "fitness";
  if (percent < 32) return "average";
  return "obese";
}

/**
 * The U.S. Navy circumference formula (Hodgdon & Beckett, 1984). It reads body fat
 * from the ratio between girth at the waist and at the neck, scaled by height — the
 * reason a tape measure gets within about 3–4 percentage points of a DEXA scan.
 */
function navyBodyFat(input: BodyFatInput): number | null {
  const { sex, heightCm, neckCm, waistCm, hipCm } = input;
  if (heightCm <= 0 || neckCm <= 0 || waistCm <= 0) return null;

  if (sex === "male") {
    const girth = waistCm - neckCm;
    // A waist no bigger than the neck breaks the logarithm and means one of the two
    // was mistyped — a man's navel girth is always the larger of the pair.
    if (girth <= 0) return null;
    const value = 495 / (1.0324 - 0.19077 * log10(girth) + 0.15456 * log10(heightCm)) - 450;
    return Number.isFinite(value) ? value : null;
  }

  if (hipCm <= 0) return null;
  const girth = waistCm + hipCm - neckCm;
  if (girth <= 0) return null;
  const value = 495 / (1.29579 - 0.35004 * log10(girth) + 0.221 * log10(heightCm)) - 450;
  return Number.isFinite(value) ? value : null;
}

/**
 * Deurenberg (1991) estimates body fat from BMI, age and sex. It ignores where the
 * fat sits, so it overstates a lifter and understates a sedentary person of the same
 * BMI — useful only as a sanity check against the tape figure.
 */
function bmiBodyFat(bmi: number, age: number, sex: Sex): number {
  return 1.2 * bmi + 0.23 * age - 10.8 * (sex === "male" ? 1 : 0) - 5.4;
}

export function calculateBodyFat(input: BodyFatInput): BodyFatResult {
  const { sex, age, heightCm, weightKg } = input;

  const numbers = [age, heightCm, weightKg, input.neckCm, input.waistCm, input.hipCm];
  if (numbers.some((n) => !Number.isFinite(n))) return { ...EMPTY };
  if (age <= 0 || age > 130 || heightCm <= 0 || weightKg <= 0) return { ...EMPTY };

  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);

  const rawNavy = navyBodyFat(input);
  // Both formulas can run off the end of their valid range on extreme input; 2% is
  // below essential fat and 75% is past the heaviest body ever measured.
  const clamp = (n: number) => Math.min(75, Math.max(2, n));

  const navyPercent = rawNavy === null ? null : round1(clamp(rawNavy));
  const bmiPercent = round1(clamp(bmiBodyFat(bmi, age, sex)));

  const effective = navyPercent ?? bmiPercent;
  const fatMassKg = round1((weightKg * effective) / 100);
  const leanMassKg = round1(weightKg - fatMassKg);

  const idealPercent = idealPercentFor(sex, age);
  const leanExact = weightKg * (1 - effective / 100);
  const idealWeightKg = round1(leanExact / (1 - idealPercent / 100));

  return {
    navyPercent,
    bmiPercent,
    bmi: round1(bmi),
    category: classifyBodyFat(effective, sex),
    fatMassKg,
    leanMassKg,
    idealPercent,
    fatToLoseKg: round1(weightKg - idealWeightKg),
    idealWeightKg,
  };
}

export function inchesToCm(inches: number): number {
  return inches * 2.54;
}

export function lbsToKg(lbs: number): number {
  return lbs * 0.45359237;
}

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * 2.54;
}
