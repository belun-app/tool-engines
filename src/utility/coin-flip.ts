/** Fair coin flips and statistics (percentages, current streak) over a flip history. */
import { type RandomSource, randomInt } from "../_random.js";

export type CoinSide = "heads" | "tails";

export interface CoinFlipStats {
  total: number;
  heads: number;
  tails: number;
  headsPercent: number;
  tailsPercent: number;
  /** Length of the current run of identical results at the end of the history */
  streak: number;
  streakSide: CoinSide | null;
}

/**
 * Flip a fair coin from crypto.getRandomValues or `rng`. The lowest bit of a random
 * word decides the side, so heads and tails are exactly equally likely.
 * @throws SecureRandomUnavailableError without Web Crypto and without `rng`.
 */
export function flipCoin(rng?: RandomSource): CoinSide {
  return randomInt(2, rng) === 0 ? "heads" : "tails";
}

/**
 * Flip several coins at once. A non-positive or invalid count yields an empty array.
 * @throws SecureRandomUnavailableError without Web Crypto and without `rng`.
 */
export function flipCoins(count: number, rng?: RandomSource): CoinSide[] {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  if (n < 1) return [];
  return Array.from({ length: n }, () => flipCoin(rng));
}

/** Compute totals, percentages, and the current streak from a flip history. */
export function computeStats(history: CoinSide[]): CoinFlipStats {
  const list = Array.isArray(history)
    ? history.filter((side) => side === "heads" || side === "tails")
    : [];
  const total = list.length;
  const heads = list.filter((side) => side === "heads").length;
  const tails = total - heads;

  if (total === 0) {
    return {
      total: 0,
      heads: 0,
      tails: 0,
      headsPercent: 0,
      tailsPercent: 0,
      streak: 0,
      streakSide: null,
    };
  }

  const last = list[total - 1];
  let streak = 0;
  for (let i = total - 1; i >= 0 && list[i] === last; i--) {
    streak++;
  }

  return {
    total,
    heads,
    tails,
    headsPercent: Math.round((heads / total) * 1000) / 10,
    tailsPercent: Math.round((tails / total) * 1000) / 10,
    streak,
    streakSide: last,
  };
}
