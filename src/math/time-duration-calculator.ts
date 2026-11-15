/**
 * Time arithmetic: the duration between two clock times, shifting a time by hours and
 * minutes, and adding or subtracting durations such as 1:30 or 2h 15m.
 */

export interface DurationBetweenResult {
  valid: boolean;
  totalMinutes: number;
  hours: number;
  minutes: number;
  decimalHours: number;
  crossesMidnight: boolean;
  breakDeducted: number;
}

export interface ShiftTimeResult {
  valid: boolean;
  time: string;
  dayOffset: number;
}

export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatMinutesAsTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function emptyDuration(): DurationBetweenResult {
  return {
    valid: false,
    totalMinutes: 0,
    hours: 0,
    minutes: 0,
    decimalHours: 0,
    crossesMidnight: false,
    breakDeducted: 0,
  };
}

export function durationBetween(
  start: string,
  end: string,
  breakMinutes = 0,
): DurationBetweenResult {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin === null || endMin === null) return emptyDuration();

  const crossesMidnight = endMin < startMin;
  const rawMinutes = crossesMidnight ? 1440 - startMin + endMin : endMin - startMin;
  // A clock shows whole minutes, so a fractional break (0.5) is rounded to one.
  const deduction =
    Number.isFinite(breakMinutes) && breakMinutes > 0 ? Math.round(breakMinutes) : 0;
  const breakDeducted = Math.min(deduction, rawMinutes);
  const totalMinutes = rawMinutes - breakDeducted;

  return {
    valid: true,
    totalMinutes,
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
    decimalHours: Math.round((totalMinutes / 60) * 100) / 100,
    crossesMidnight,
    breakDeducted,
  };
}

export function shiftTime(
  start: string,
  hours: number,
  minutes: number,
  direction: "add" | "subtract",
): ShiftTimeResult {
  const startMin = parseTimeToMinutes(start);
  if (startMin === null || !Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return { valid: false, time: "", dayOffset: 0 };
  }

  // A clock shows whole minutes, so fractional input (30.5 min, 1.33 h) is rounded to one.
  // The sign is kept: adding −3 h is subtracting 3 h, not adding 3.
  const delta = Math.round(hours * 60 + minutes);
  const shifted = direction === "add" ? startMin + delta : startMin - delta;
  const dayOffset = Math.floor(shifted / 1440);

  return { valid: true, time: formatMinutesAsTime(shifted), dayOffset };
}

export interface DurationSumItem {
  /** 1 adds the duration, -1 subtracts it. */
  sign: 1 | -1;
  /** "1:45", "1:45:30", "2ч 30м", "1 h 15 min", "90 мин", "45" (minutes), "2,5 ч". */
  text: string;
}

export interface DurationSumResult {
  valid: boolean;
  /** Signed total in whole seconds. */
  totalSeconds: number;
  negative: boolean;
  /** Parts of the absolute total. */
  hours: number;
  minutes: number;
  seconds: number;
  /** Absolute total in hours, rounded to 2 decimals (signed). */
  decimalHours: number;
  /** Absolute total in minutes, rounded to 2 decimals (signed). */
  totalMinutes: number;
  /** True when any entry had seconds, so the total is shown as h:mm:ss. */
  hasSeconds: boolean;
  /** Indexes of entries that are not empty and could not be read. */
  invalid: number[];
  /** How many entries were added up. */
  counted: number;
}

const UNIT_SECONDS: Array<[RegExp, number]> = [
  [/^(?:ч|час|часа|часов|h|hr|hrs|hour|hours)$/, 3600],
  [/^(?:м|мин|минута|минуты|минут|m|min|mins|minute|minutes)$/, 60],
  [/^(?:с|сек|секунда|секунды|секунд|s|sec|secs|second|seconds)$/, 1],
];

/**
 * Reads one duration and returns whole seconds, or null when it cannot be read.
 * Clock style "h:mm" and "h:mm:ss" (hours may exceed 24, minutes and seconds
 * stay below 60), unit style "2ч 30м", "1 h 15 min 20 s", "2,5 ч", or a bare
 * number, which counts as minutes.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (t === "") return null;

  const clock = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(t);
  if (clock) {
    return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0);
  }

  const bare = /^(\d+(?:[.,]\d+)?)$/.exec(t);
  if (bare) return Math.round(Number(bare[1].replace(",", ".")) * 60);

  // Unit style: number + unit, repeated ("1 h 30 min", "2ч30м", "2,5 ч").
  const token = /(\d+(?:[.,]\d+)?)\s*([a-zа-яё]+)\.?\s*/gy;
  let total = 0;
  let pos = 0;
  let found = false;
  for (let m = token.exec(t); m; m = token.exec(t)) {
    const unit = UNIT_SECONDS.find(([re]) => re.test(m[2]));
    if (!unit) return null;
    total += Number(m[1].replace(",", ".")) * unit[1];
    pos = token.lastIndex;
    found = true;
  }
  if (!found || pos !== t.length) return null;
  return Math.round(total);
}

/** Adds and subtracts durations, carrying 60 minutes into an hour. */
export function sumDurations(items: DurationSumItem[]): DurationSumResult {
  let total = 0;
  let counted = 0;
  let hasSeconds = false;
  const invalid: number[] = [];
  items.forEach((item, i) => {
    if (item.text.trim() === "") return;
    const seconds = parseDuration(item.text);
    if (seconds === null) {
      invalid.push(i);
      return;
    }
    if (seconds % 60 !== 0) hasSeconds = true;
    total += item.sign * seconds;
    counted++;
  });
  const abs = Math.abs(total);
  const sign = total < 0 ? -1 : 1;
  return {
    valid: counted > 0 && invalid.length === 0,
    totalSeconds: total,
    negative: total < 0,
    hours: Math.floor(abs / 3600),
    minutes: Math.floor((abs % 3600) / 60),
    seconds: abs % 60,
    decimalHours: sign * (Math.round((abs / 3600) * 100) / 100),
    totalMinutes: sign * (Math.round((abs / 60) * 100) / 100),
    hasSeconds,
    invalid,
    counted,
  };
}
