/**
 * Random integers in an inclusive range, optionally unique and sorted, drawn without
 * modulo bias over ranges up to 2^53 wide.
 */
import { type RandomSource, hasSecureRandom, randomInt } from "../_random.js";

export type SortOrder = "none" | "asc" | "desc";

export interface RandomNumberOptions {
  min: number;
  max: number;
  count: number;
  /** No value twice (default false). */
  unique?: boolean;
  /** Order of the result (default "none": draw order). */
  sort?: SortOrder;
  /** Source of random 32-bit words; defaults to `crypto.getRandomValues` (see `_random`). */
  rng?: RandomSource;
}

export type RandomNumberErrorCode =
  | ""
  | "invalid-input"
  | "no-secure-random"
  | "min-greater-than-max"
  | "too-many"
  | "unsafe-range"
  | "range-too-wide"
  | "not-enough-unique";

export interface RandomNumberResult {
  numbers: number[];
  /** English message, kept for callers without page texts; prefer `errorCode`. */
  error: string;
  /** What went wrong as a code; the page maps it to its own words. */
  errorCode: RandomNumberErrorCode;
  /** Values the message needs: the requested count and the range size. */
  errorParams?: { count?: number; rangeSize?: number; max?: number };
}

/** Upper bound on how many numbers one click may produce (keeps the tab responsive). */
export const MAX_COUNT = 10_000;
const MAX_COUNT_LABEL = "10,000";
const TWO_53 = 2 ** 53;

/**
 * Draw `count` integers from [ceil(min), floor(max)]. Every value is equally likely
 * (rejection sampling, see `_random`); `unique` uses a partial Fisher–Yates over the range,
 * so it never loops. Problems come back as `errorCode` (plus an English `error`), never as
 * an exception: missing or non-numeric min, max or count give "invalid-input", and no Web
 * Crypto (without `rng`) gives "no-secure-random". A count below 1 returns no numbers and
 * no error.
 */
export function generateRandomNumbers(options: RandomNumberOptions): RandomNumberResult {
  const o = (options ?? {}) as Partial<RandomNumberOptions>;
  const num = (v: unknown) => (typeof v === "number" ? v : Number.NaN);
  const min = Math.ceil(num(o.min));
  const max = Math.floor(num(o.max));
  const count = Math.floor(num(o.count));
  const rng = o.rng;

  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(count)) {
    return {
      numbers: [],
      error: "Minimum, maximum and count must be finite numbers.",
      errorCode: "invalid-input",
    };
  }

  if (min > max) {
    return {
      numbers: [],
      error: "Minimum must be less than or equal to maximum.",
      errorCode: "min-greater-than-max",
    };
  }

  if (count < 1) {
    return { numbers: [], error: "", errorCode: "" };
  }

  if (count > MAX_COUNT) {
    return {
      numbers: [],
      error: `You can generate at most ${MAX_COUNT_LABEL} numbers at a time.`,
      errorCode: "too-many",
      errorParams: { max: MAX_COUNT },
    };
  }

  if (Math.abs(min) > Number.MAX_SAFE_INTEGER || Math.abs(max) > Number.MAX_SAFE_INTEGER) {
    return {
      numbers: [],
      error: "Minimum and maximum must be between -9007199254740991 and 9007199254740991.",
      errorCode: "unsafe-range",
    };
  }

  const rangeSize = max - min + 1;
  if (rangeSize > TWO_53) {
    return {
      numbers: [],
      error: "The range is too wide: at most 2^53 different values.",
      errorCode: "range-too-wide",
    };
  }

  if (o.unique && count > rangeSize) {
    return {
      numbers: [],
      error: `Cannot generate ${count} unique numbers from a range of only ${rangeSize}.`,
      errorCode: "not-enough-unique",
      errorParams: { count, rangeSize },
    };
  }

  if (!rng && !hasSecureRandom()) {
    return {
      numbers: [],
      error: "Secure random numbers are not available in this environment.",
      errorCode: "no-secure-random",
    };
  }

  let numbers: number[];

  if (o.unique) {
    // Partial Fisher–Yates over the value range — exact, no retry on duplicates.
    const pool = new Map<number, number>();
    numbers = [];
    for (let i = 0; i < count; i++) {
      const j = i + randomInt(rangeSize - i, rng);
      const valI = pool.get(i) ?? i;
      const valJ = pool.get(j) ?? j;
      numbers.push(min + valJ);
      pool.set(j, valI);
    }
  } else {
    numbers = [];
    for (let i = 0; i < count; i++) {
      numbers.push(min + randomInt(rangeSize, rng));
    }
  }

  if (o.sort === "asc") {
    numbers.sort((a, b) => a - b);
  } else if (o.sort === "desc") {
    numbers.sort((a, b) => b - a);
  }

  return { numbers, error: "", errorCode: "" };
}
