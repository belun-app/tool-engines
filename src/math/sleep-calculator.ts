/**
 * Sleep-cycle arithmetic. A night of sleep is not one block but a repeating
 * architecture — light, deep, REM — that runs roughly 90 minutes per lap. Waking at
 * the seam between two laps feels easier than being pulled out of deep sleep, so the
 * calculator lands every suggestion on a whole number of cycles and adds a buffer for
 * the time it takes to actually fall asleep.
 */

/**
 * `bedtime`: "I must wake at X, when do I go to bed?"
 * `wakeup`: "I go to bed at X, when should I wake?"
 * `nap`: "I lie down for a nap at X, when should the alarm ring?" — a 10- or
 * 20-minute nap that stays in light sleep, or one full cycle.
 */
export type SleepMode = "bedtime" | "wakeup" | "nap";

/** Nap lengths offered besides one full cycle: short enough to stay in light sleep. */
export const NAP_MINUTES = [10, 20] as const;

/** Accepted ranges; values outside are pulled in and the result says so. */
export const SLEEP_LIMITS = {
  cycleMinutes: { min: 60, max: 120 },
  fallAsleepMinutes: { min: 0, max: 180 },
} as const;

export interface SleepOption {
  /** Whole sleep cycles this option gives you. */
  cycles: number;
  /** Time actually asleep, in minutes (cycles × cycle length). */
  sleepMinutes: number;
  /** Time in bed, in minutes (sleep + the fall-asleep buffer). */
  inBedMinutes: number;
  /** Suggested clock time as minutes past midnight, always 0–1439. */
  timeMinutes: number;
  /** Same time as a 24-hour "HH:MM" string. */
  time: string;
  /** 0 = same calendar day as the anchor, -1 = day before, 1 = day after. */
  dayOffset: number;
  /** True for 5–6 cycles (7.5–9 h), the band that matches adult sleep guidance; for naps, 20 min. */
  recommended: boolean;
  /** Nap mode: a short nap that ends before the first full cycle (cycles is 0). */
  shortNap?: boolean;
}

export interface SleepInput {
  /**
   * `bedtime` answers "I must wake at X, when do I go to bed?".
   * `wakeup` answers "I go to bed at X, when should I wake?".
   */
  mode: SleepMode;
  /** Anchor time as "HH:MM" (24-hour) — the wake-up time or the bedtime. */
  time: string;
  /** Length of one cycle in minutes. Defaults to 90, clamped to 60–120 (see `cycleClamped`). */
  cycleMinutes?: number;
  /** Minutes to fall asleep. Defaults to 15, clamped to 0–180. */
  fallAsleepMinutes?: number;
  /** Fewest cycles to list. Defaults to 3, clamped to 1–9. */
  minCycles?: number;
  /** Most cycles to list. Defaults to 6, clamped to minCycles–9. */
  maxCycles?: number;
}

export interface SleepResult {
  valid: boolean;
  mode: SleepMode;
  /** Anchor time as minutes past midnight. */
  anchorMinutes: number;
  /** Anchor time as "HH:MM". */
  anchor: string;
  cycleMinutes: number;
  fallAsleepMinutes: number;
  /** The cycle length asked for was outside 60–120 and `cycleMinutes` is the clamped value. */
  cycleClamped: boolean;
  /** The fall-asleep time asked for was outside 0–180 and was clamped. */
  fallAsleepClamped: boolean;
  /** Chronological order: earliest bedtime first, or earliest wake-up first. */
  options: SleepOption[];
}

const MINUTES_PER_DAY = 1440;
const DEFAULT_CYCLE = 90;
const DEFAULT_FALL_ASLEEP = 15;
const DEFAULT_MIN_CYCLES = 3;
const DEFAULT_MAX_CYCLES = 6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Parse "HH:MM" (or "H:MM", or "HH:MM:SS") into minutes past midnight, or null. */
export function parseClock(value: string): number | null {
  const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Render minutes past midnight as a 24-hour "HH:MM" string. */
export function formatClock(totalMinutes: number): string {
  const wrapped =
    ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Render a duration in minutes as "7 h 30 min" style parts the caller can label. */
export function splitDuration(totalMinutes: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** Rounds and clamps; non-finite input falls back to the default. */
function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  const asked = Number.isFinite(value) ? Math.round(value as number) : fallback;
  const used = clamp(asked, min, max);
  return { used, clamped: used !== asked };
}

export function calculateSleep(input: SleepInput): SleepResult {
  const { cycleMinutes: cycleLimits, fallAsleepMinutes: fallLimits } = SLEEP_LIMITS;
  const cycle = bounded(input.cycleMinutes, DEFAULT_CYCLE, cycleLimits.min, cycleLimits.max);
  const fall = bounded(
    input.fallAsleepMinutes,
    DEFAULT_FALL_ASLEEP,
    fallLimits.min,
    fallLimits.max,
  );
  const cycleMinutes = cycle.used;
  const fallAsleepMinutes = fall.used;
  const minCycles = clamp(Math.round(input.minCycles ?? DEFAULT_MIN_CYCLES), 1, 9);
  const maxCycles = clamp(Math.round(input.maxCycles ?? DEFAULT_MAX_CYCLES), minCycles, 9);

  const base = {
    mode: input.mode,
    cycleMinutes,
    fallAsleepMinutes,
    cycleClamped: cycle.clamped,
    fallAsleepClamped: fall.clamped,
  };

  const anchorMinutes = parseClock(input.time);
  if (anchorMinutes === null) {
    return { ...base, valid: false, anchorMinutes: 0, anchor: "", options: [] };
  }

  const at = (raw: number) => ({
    timeMinutes: ((raw % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY,
    time: formatClock(raw),
    dayOffset: Math.floor(raw / MINUTES_PER_DAY),
  });

  if (input.mode === "nap") {
    // A short nap ends before deep sleep; a full cycle ends at its seam.
    const naps: SleepOption[] = [...NAP_MINUTES, cycleMinutes].map((sleepMinutes) => {
      const inBedMinutes = sleepMinutes + fallAsleepMinutes;
      const full = sleepMinutes === cycleMinutes;
      return {
        cycles: full ? 1 : 0,
        sleepMinutes,
        inBedMinutes,
        ...at(anchorMinutes + inBedMinutes),
        recommended: sleepMinutes === 20,
        shortNap: !full,
      };
    });
    return {
      ...base,
      valid: true,
      anchorMinutes,
      anchor: formatClock(anchorMinutes),
      options: naps,
    };
  }

  const options: SleepOption[] = [];
  for (let cycles = minCycles; cycles <= maxCycles; cycles++) {
    const sleepMinutes = cycles * cycleMinutes;
    const inBedMinutes = sleepMinutes + fallAsleepMinutes;
    // Going to bed means stepping back in time; waking up means stepping forward.
    const offset = input.mode === "bedtime" ? -inBedMinutes : inBedMinutes;
    options.push({
      cycles,
      sleepMinutes,
      inBedMinutes,
      ...at(anchorMinutes + offset),
      recommended: cycles >= 5 && cycles <= 6,
    });
  }

  // Chronological: for bedtimes, more sleep means an earlier hour, so reverse.
  if (input.mode === "bedtime") options.reverse();

  return { ...base, valid: true, anchorMinutes, anchor: formatClock(anchorMinutes), options };
}
