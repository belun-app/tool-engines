/**
 * Descriptive statistics of a list of numbers: count, sum, mean, median, mode, range,
 * variance and standard deviation, quartiles, interquartile range and outliers.
 */

export interface StatisticsResult {
  valid: boolean;
  count: number;
  sum: number;
  mean: number;
  median: number;
  /** Every value tied for the highest frequency; empty when no value repeats */
  mode: number[];
  modeFrequency: number;
  min: number;
  max: number;
  range: number;
  populationVariance: number;
  sampleVariance: number;
  populationStdDev: number;
  sampleStdDev: number;
  meanAbsoluteDeviation: number;
  q1: number;
  q3: number;
  iqr: number;
  /** Values outside the 1.5 × IQR fences */
  outliers: number[];
  sorted: number[];
}

const EMPTY: StatisticsResult = {
  valid: false,
  count: 0,
  sum: 0,
  mean: 0,
  median: 0,
  mode: [],
  modeFrequency: 0,
  min: 0,
  max: 0,
  range: 0,
  populationVariance: 0,
  sampleVariance: 0,
  populationStdDev: 0,
  sampleStdDev: 0,
  meanAbsoluteDeviation: 0,
  q1: 0,
  q3: 0,
  iqr: 0,
  outliers: [],
  sorted: [],
};

/**
 * Split a free-form string into numbers. Commas, semicolons, spaces, tabs, and
 * newlines all count as separators, so pasted spreadsheet columns just work.
 */
export function parseNumberList(input: string): number[] {
  if (!input) return [];

  const out: number[] = [];
  for (const token of input.split(/[\s,;]+/)) {
    if (!token) continue;
    const value = Number.parseFloat(token);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Linear-interpolation percentile, the same method Excel's QUARTILE.INC uses. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];

  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function findMode(sorted: number[]): { mode: number[]; frequency: number } {
  const counts = new Map<number, number>();
  for (const value of sorted) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let frequency = 0;
  for (const count of counts.values()) {
    if (count > frequency) frequency = count;
  }

  // Every value appears once — by convention the set has no mode.
  if (frequency < 2) return { mode: [], frequency: 1 };

  const mode: number[] = [];
  for (const [value, count] of counts) {
    if (count === frequency) mode.push(value);
  }
  mode.sort((a, b) => a - b);

  return { mode, frequency };
}

export function calculateStatistics(values: number[]): StatisticsResult {
  const numbers = values.filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return { ...EMPTY };

  const sorted = [...numbers].sort((a, b) => a - b);
  const count = sorted.length;

  let sum = 0;
  for (const value of sorted) sum += value;
  const mean = sum / count;

  let squaredDeviations = 0;
  let absoluteDeviations = 0;
  for (const value of sorted) {
    const delta = value - mean;
    squaredDeviations += delta * delta;
    absoluteDeviations += Math.abs(delta);
  }

  const populationVariance = squaredDeviations / count;
  const sampleVariance = count > 1 ? squaredDeviations / (count - 1) : 0;

  const median = percentile(sorted, 0.5);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;

  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const outliers = sorted.filter((value) => value < lowerFence || value > upperFence);

  const { mode, frequency } = findMode(sorted);

  return {
    valid: true,
    count,
    sum,
    mean,
    median,
    mode,
    modeFrequency: frequency,
    min: sorted[0],
    max: sorted[count - 1],
    range: sorted[count - 1] - sorted[0],
    populationVariance,
    sampleVariance,
    populationStdDev: Math.sqrt(populationVariance),
    sampleStdDev: Math.sqrt(sampleVariance),
    meanAbsoluteDeviation: absoluteDeviations / count,
    q1,
    q3,
    iqr,
    outliers,
    sorted,
  };
}

/** Convenience wrapper: parse a raw string and run the full calculation. */
export function calculateStatisticsFromText(input: string): StatisticsResult {
  return calculateStatistics(parseNumberList(input));
}
