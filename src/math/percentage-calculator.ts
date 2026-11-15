/**
 * Percentage calculations: X% of Y, what percent X is of Y, and the percentage change from X
 * to Y.
 */

export interface PercentageResult {
  percentOf: number | null;
  percentChange: number | null;
  percentDifference: number | null;
  whatPercent: number | null;
}

/** What is X% of Y? */
export function calcPercentOf(percent: number, value: number): number | null {
  if (!Number.isFinite(percent) || !Number.isFinite(value)) return null;
  return (percent / 100) * value;
}

/** X is what percent of Y? */
export function calcWhatPercent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return null;
  return (part / whole) * 100;
}

/** Percentage change from X to Y */
export function calcPercentChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

/** Percentage difference between X and Y (symmetric) */
export function calcPercentDifference(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  if (avg === 0) return 0;
  return (Math.abs(a - b) / avg) * 100;
}

/** Multiply by 10^exp by moving the decimal exponent, which is exact (1.005e2 is 100.5). */
function shiftDecimal(value: number, exp: number): number {
  const [mantissa, exponent] = String(value).split("e");
  return Number(`${mantissa}e${Number(exponent ?? 0) + exp}`);
}

export function roundTo(value: number, decimals: number): number {
  // value * 100 would give 100.49999999999999 for 1.005, so half-way cases rounded down.
  if (!Number.isFinite(value)) return value;
  return shiftDecimal(Math.round(shiftDecimal(value, decimals)), -decimals);
}
