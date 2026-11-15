/**
 * Fair dice rolls (d4 to d20 or any number of sides) and statistics over a roll history.
 */
import { type RandomSource, hasSecureRandom, randomInt } from "../_random.js";

export const DIE_TYPES = [4, 6, 8, 10, 12, 20] as const;
export type DieSides = (typeof DIE_TYPES)[number];

export const MAX_DICE = 100;

export interface DiceRoll {
  sides: number;
  values: number[];
  total: number;
  /** Set (and `values` empty) when there is no Web Crypto and no `rng` was given. */
  error?: "no-secure-random";
}

export interface DiceOptions {
  /** Source of random 32-bit words; defaults to `crypto.getRandomValues` (see `_random`). */
  rng?: RandomSource;
}

export interface DiceRollStats {
  /** Number of roll events in the history */
  rolls: number;
  /** Total number of individual dice rolled */
  dice: number;
  /** Sum of every die value across the history */
  sum: number;
  /** Average value of a single die, rounded to one decimal */
  average: number;
  highest: number;
  lowest: number;
}

/**
 * Roll a single die with the given number of sides, from crypto.getRandomValues or `rng`.
 * Rejection sampling removes modulo bias, so every face is exactly equally likely.
 * Returns 0 for fewer than two sides.
 * @throws SecureRandomUnavailableError without Web Crypto and without `rng`.
 */
export function rollDie(sides: number, rng?: RandomSource): number {
  const s = Number.isFinite(sides) ? Math.floor(sides) : 0;
  if (s < 2) return 0;
  return randomInt(s, rng) + 1;
}

/**
 * Roll several identical dice at once. Invalid sides or a non-positive count
 * yield an empty roll; the dice count is capped at MAX_DICE.
 */
export function rollDice(sides: number, count: number, options: DiceOptions = {}): DiceRoll {
  const s = Number.isFinite(sides) ? Math.floor(sides) : 0;
  const n = Number.isFinite(count) ? Math.min(Math.floor(count), MAX_DICE) : 0;
  if (s < 2 || n < 1) return { sides: s < 2 ? 0 : s, values: [], total: 0 };
  const { rng } = options;
  if (!rng && !hasSecureRandom()) {
    return { sides: s, values: [], total: 0, error: "no-secure-random" };
  }
  const values = Array.from({ length: n }, () => rollDie(s, rng));
  return { sides: s, values, total: values.reduce((sum, v) => sum + v, 0) };
}

/** Compute totals, the per-die average, and extremes from a roll history. */
export function computeStats(history: DiceRoll[]): DiceRollStats {
  const list = Array.isArray(history) ? history.filter((roll) => roll.values.length > 0) : [];
  const empty: DiceRollStats = { rolls: 0, dice: 0, sum: 0, average: 0, highest: 0, lowest: 0 };
  if (list.length === 0) return empty;

  let dice = 0;
  let sum = 0;
  let highest = Number.NEGATIVE_INFINITY;
  let lowest = Number.POSITIVE_INFINITY;
  for (const roll of list) {
    dice += roll.values.length;
    sum += roll.total;
    for (const v of roll.values) {
      if (v > highest) highest = v;
      if (v < lowest) lowest = v;
    }
  }

  return {
    rolls: list.length,
    dice,
    sum,
    average: Math.round((sum / dice) * 10) / 10,
    highest,
    lowest,
  };
}
