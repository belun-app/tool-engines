/**
 * Stopwatch and timer arithmetic: time formatting, lap splits and statistics, and countdown
 * alarm timing.
 */

export interface FormattedTime {
  hours: number;
  minutes: number;
  seconds: number;
  centiseconds: number;
  /** Human-readable clock string, e.g. "01:23.45" or "1:02:03.45" */
  display: string;
}

export interface LapSplit {
  /** 1-based lap number */
  index: number;
  /** Time since the previous lap, in milliseconds */
  duration: number;
  /** Cumulative elapsed time at this lap, in milliseconds */
  total: number;
}

export interface LapStats {
  laps: LapSplit[];
  /** Position in laps[] of the fastest lap, or -1 when there are fewer than two laps */
  fastestIndex: number;
  /** Position in laps[] of the slowest lap, or -1 when there are fewer than two laps */
  slowestIndex: number;
}

function pad(value: number, width = 2): string {
  return String(Math.floor(value)).padStart(width, "0");
}

/**
 * Turn a millisecond duration into clock parts and a display string.
 * The hours segment is dropped when the duration is under an hour.
 * Centiseconds (hundredths) are included by default — handy for stopwatch precision.
 * `decimalSeparator` is "," on Russian pages ("00:01,51").
 */
export function formatDuration(
  ms: number,
  showCentiseconds = true,
  decimalSeparator = ".",
): FormattedTime {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((safe % 1000) / 10);

  let display =
    hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  if (showCentiseconds) display += `${decimalSeparator}${pad(centiseconds)}`;

  return { hours, minutes, seconds, centiseconds, display };
}

export const MAX_HOURS = 99;

/**
 * A countdown shows whole seconds rounded UP: a fresh 1:00 timer reads 01:00, the
 * last second before the alarm reads 00:01, and 00:00 appears together with it.
 */
export function formatCountdown(remainingMs: number): FormattedTime {
  const safe = Number.isFinite(remainingMs) && remainingMs > 0 ? remainingMs : 0;
  return formatDuration(Math.ceil(safe / 1000) * 1000, false);
}

/**
 * Convert hours / minutes / seconds inputs into a total millisecond duration.
 * Negative, non-finite, or fractional inputs are clamped to safe whole values.
 */
export function toMilliseconds(hours: number, minutes: number, seconds: number): number {
  // The hours field goes up to 99 (the display has room for two digits).
  const h = Number.isFinite(hours) && hours > 0 ? Math.min(MAX_HOURS, Math.floor(hours)) : 0;
  const m = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return (h * 3600 + m * 60 + s) * 1000;
}

/**
 * Given the cumulative elapsed times recorded at each lap press, return the
 * per-lap durations plus which lap was fastest and slowest. Fastest/slowest
 * are only marked once there are at least two laps to compare.
 */
export function computeLaps(cumulative: number[]): LapStats {
  const valid = cumulative.filter((t) => Number.isFinite(t) && t >= 0);
  const laps: LapSplit[] = [];
  let prev = 0;
  for (let i = 0; i < valid.length; i++) {
    const total = valid[i];
    laps.push({ index: i + 1, duration: total - prev, total });
    prev = total;
  }

  let fastestIndex = -1;
  let slowestIndex = -1;
  if (laps.length >= 2) {
    fastestIndex = 0;
    slowestIndex = 0;
    for (let i = 1; i < laps.length; i++) {
      if (laps[i].duration < laps[fastestIndex].duration) fastestIndex = i;
      if (laps[i].duration > laps[slowestIndex].duration) slowestIndex = i;
    }
    // All laps equal: nothing is fastest or slowest.
    if (laps[fastestIndex].duration === laps[slowestIndex].duration) {
      fastestIndex = -1;
      slowestIndex = -1;
    }
  }

  return { laps, fastestIndex, slowestIndex };
}

/**
 * How far (ms) the alarm queued on the audio clock may disagree with the countdown on
 * the system clock. The audio clock stops while a phone sleeps or another app takes
 * the audio, the system clock does not; past this gap the beeps are re-queued.
 */
export const ALARM_TOLERANCE_MS = 250;

/**
 * Whether the beeps queued on the audio clock (due in `audioRemainingMs`) drifted from
 * the countdown on the screen (`wallRemainingMs` left) and must be queued again.
 */
export function alarmNeedsReschedule(
  audioRemainingMs: number,
  wallRemainingMs: number,
  toleranceMs = ALARM_TOLERANCE_MS,
): boolean {
  if (!Number.isFinite(audioRemainingMs) || !Number.isFinite(wallRemainingMs)) return true;
  return Math.abs(audioRemainingMs - Math.max(0, wallRemainingMs)) > toleranceMs;
}

/**
 * The countdown just reached 00:00: true when the queued beeps are sounding now (due
 * within the tolerance or already started), false when they are still far ahead on a
 * stalled audio clock and have to be replaced by beeps right away.
 */
export function alarmIsDue(audioRemainingMs: number, toleranceMs = ALARM_TOLERANCE_MS): boolean {
  return Number.isFinite(audioRemainingMs) && audioRemainingMs <= toleranceMs;
}
