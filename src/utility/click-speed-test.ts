/**
 * Click speed test scoring: clicks per second over a run and the speed tier it falls into.
 */

/** Durations offered by the classic CPS test, in seconds. */
export const CLICK_TEST_DURATIONS = [1, 5, 10, 30, 60] as const;

export type ClickTestDuration = (typeof CLICK_TEST_DURATIONS)[number];

/** Coarse speed tier, derived from clicks per second alone. */
export type ClickSpeedRank = "slow" | "average" | "fast" | "very-fast" | "insane";

export interface ClickSpeedResult {
  clicks: number;
  durationSeconds: number;
  /** Clicks per second, rounded to two decimals. */
  cps: number;
  /** Clicks per minute, rounded to a whole number. */
  clicksPerMinute: number;
  rank: ClickSpeedRank;
}

export interface ClickRhythmStats {
  /** Highest number of clicks landing inside any one-second window. */
  peakCps: number;
  /** Mean gap between consecutive clicks, in milliseconds. */
  averageIntervalMs: number;
  fastestIntervalMs: number;
  slowestIntervalMs: number;
  /**
   * How even the rhythm was, 0–100. Derived from the standard deviation of the
   * intervals relative to their mean: a metronome scores 100, wild bursts score low.
   */
  consistency: number;
}

const EMPTY_RESULT: ClickSpeedResult = {
  clicks: 0,
  durationSeconds: 0,
  cps: 0,
  clicksPerMinute: 0,
  rank: "slow",
};

const EMPTY_RHYTHM: ClickRhythmStats = {
  peakCps: 0,
  averageIntervalMs: 0,
  fastestIntervalMs: 0,
  slowestIntervalMs: 0,
  consistency: 0,
};

/** Tier boundaries in clicks per second, checked in order. */
const RANK_THRESHOLDS: Array<{ min: number; rank: ClickSpeedRank }> = [
  { min: 10, rank: "insane" },
  { min: 8, rank: "very-fast" },
  { min: 6.5, rank: "fast" },
  { min: 4, rank: "average" },
];

/** Map a clicks-per-second figure onto a speed tier. */
export function rankClickSpeed(cps: number): ClickSpeedRank {
  if (!Number.isFinite(cps) || cps <= 0) return "slow";
  for (const { min, rank } of RANK_THRESHOLDS) {
    if (cps >= min) return rank;
  }
  return "slow";
}

/**
 * Score one finished run. A zero or negative duration, or a click count that is not
 * a finite non-negative number, yields zeroes rather than an error.
 */
export function computeClickSpeed(clicks: number, durationSeconds: number): ClickSpeedResult {
  if (!Number.isFinite(clicks) || !Number.isFinite(durationSeconds)) return { ...EMPTY_RESULT };
  if (clicks < 0 || durationSeconds <= 0) return { ...EMPTY_RESULT };

  const total = Math.floor(clicks);
  const cps = Math.round((total / durationSeconds) * 100) / 100;

  return {
    clicks: total,
    durationSeconds,
    cps,
    clicksPerMinute: Math.round((total / durationSeconds) * 60),
    rank: rankClickSpeed(cps),
  };
}

/**
 * Rhythm breakdown from the raw click timestamps (milliseconds, ascending).
 * Fewer than two timestamps leaves nothing to measure, so zeroes come back.
 */
export function computeClickRhythm(timestamps: number[], windowMs = 1000): ClickRhythmStats {
  const stamps = (timestamps ?? []).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (stamps.length < 2) return { ...EMPTY_RHYTHM };

  const intervals: number[] = [];
  for (let i = 1; i < stamps.length; i++) {
    intervals.push(stamps[i] - stamps[i - 1]);
  }

  const sum = intervals.reduce((acc, v) => acc + v, 0);
  const mean = sum / intervals.length;
  const variance = intervals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / intervals.length;
  const deviation = Math.sqrt(variance);
  const consistency = mean > 0 ? Math.max(0, Math.min(100, 100 - (deviation / mean) * 100)) : 0;

  return {
    peakCps: peakClicksInWindow(stamps, windowMs),
    averageIntervalMs: Math.round(mean),
    fastestIntervalMs: Math.round(Math.min(...intervals)),
    slowestIntervalMs: Math.round(Math.max(...intervals)),
    consistency: Math.round(consistency),
  };
}

/**
 * Largest number of clicks that fall inside any sliding window of `windowMs`.
 * Timestamps must already be sorted ascending.
 */
export function peakClicksInWindow(timestamps: number[], windowMs = 1000): number {
  if (!timestamps || timestamps.length === 0 || windowMs <= 0) return 0;
  let best = 0;
  let start = 0;
  for (let end = 0; end < timestamps.length; end++) {
    while (timestamps[end] - timestamps[start] >= windowMs) start++;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

/** True when `cps` beats the stored personal best (no best yet also counts). */
export function isPersonalBest(cps: number, previousBest: number | null): boolean {
  if (!Number.isFinite(cps) || cps <= 0) return false;
  if (previousBest === null || !Number.isFinite(previousBest)) return true;
  return cps > previousBest;
}

/** Fixed two-decimal display string, e.g. 7 -> "7.00". */
export function formatCps(cps: number): string {
  if (!Number.isFinite(cps) || cps <= 0) return "0.00";
  return cps.toFixed(2);
}
