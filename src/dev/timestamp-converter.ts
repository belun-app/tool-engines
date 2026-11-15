/**
 * Converts between Unix timestamps (seconds or milliseconds) and dates, giving ISO, UTC,
 * local and relative forms.
 */

export interface TimestampResult {
  valid: boolean;
  timestampSec: number;
  timestampMs: number;
  iso: string;
  utc: string;
  local: string;
  relative: string;
  /**
   * The same relative distance as numbers, for `Intl.RelativeTimeFormat`
   * in the page language: negative = past ("-2, hour" -> "2 hours ago").
   */
  relativeValue: number;
  relativeUnit: RelativeUnit;
}

export type RelativeUnit = "second" | "minute" | "hour" | "day" | "month" | "year";

/** Whole units between `ms` and now, signed like Intl.RelativeTimeFormat expects. */
export function relativeParts(ms: number, now = Date.now()): { value: number; unit: RelativeUnit } {
  const diff = now - ms;
  const abs = Math.abs(diff);
  const sign = diff < 0 ? 1 : -1;
  const seconds = Math.floor(abs / 1000);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  const pick = (value: number, unit: RelativeUnit) => ({
    value: value === 0 ? 0 : sign * value,
    unit,
  });
  if (seconds < 60) return pick(seconds, "second");
  if (minutes < 60) return pick(minutes, "minute");
  if (hours < 24) return pick(hours, "hour");
  if (days < 30) return pick(days, "day");
  if (months < 12) return pick(months, "month");
  return pick(years, "year");
}

export interface TimestampOptions {
  /** Locale for the `local` field (BCP 47). Default: the host's default locale. */
  locale?: string | string[];
  /** IANA time zone for the `local` field, e.g. "UTC". Default: the host's time zone. */
  timeZone?: string;
  /** Current time in milliseconds (or a function returning it) for the relative fields. */
  now?: number | (() => number);
}

function nowOf(options: TimestampOptions | undefined): number {
  const now = options?.now;
  if (typeof now === "function") return now();
  return typeof now === "number" && Number.isFinite(now) ? now : Date.now();
}

/** `toLocaleString` with the given locale and zone; an invalid locale or zone falls back. */
function localString(date: Date, options: TimestampOptions | undefined): string {
  try {
    return options?.timeZone
      ? date.toLocaleString(options.locale, { timeZone: options.timeZone })
      : date.toLocaleString(options?.locale);
  } catch {
    return date.toLocaleString();
  }
}

function formatRelative(ms: number, now: number): string {
  const diff = now - ms;
  const abs = Math.abs(diff);
  const future = diff < 0;

  const seconds = Math.floor(abs / 1000);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  let label: string;
  if (seconds < 60) label = `${seconds} second${seconds !== 1 ? "s" : ""}`;
  else if (minutes < 60) label = `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  else if (hours < 24) label = `${hours} hour${hours !== 1 ? "s" : ""}`;
  else if (days < 30) label = `${days} day${days !== 1 ? "s" : ""}`;
  else if (months < 12) label = `${months} month${months !== 1 ? "s" : ""}`;
  else label = `${years} year${years !== 1 ? "s" : ""}`;

  return future ? `in ${label}` : `${label} ago`;
}

function invalidResult(): TimestampResult {
  return {
    valid: false,
    timestampSec: 0,
    timestampMs: 0,
    iso: "",
    utc: "",
    local: "",
    relative: "",
    relativeValue: 0,
    relativeUnit: "second",
  };
}

function result(ms: number, date: Date, options: TimestampOptions | undefined): TimestampResult {
  const now = nowOf(options);
  const parts = relativeParts(ms, now);
  return {
    valid: true,
    timestampSec: Math.floor(ms / 1000),
    timestampMs: Math.round(ms),
    iso: date.toISOString(),
    utc: date.toUTCString(),
    local: localString(date, options),
    relative: formatRelative(ms, now),
    relativeValue: parts.value,
    relativeUnit: parts.unit,
  };
}

/**
 * A Unix timestamp (seconds, or milliseconds when its magnitude is above 1e10) in ISO, UTC,
 * local and relative form. `local` and `relative` depend on the host's locale, time zone and
 * clock unless `options` pins them.
 */
export function fromTimestamp(input: string, options: TimestampOptions = {}): TimestampResult {
  if (typeof input !== "string" && typeof input !== "number") return invalidResult();
  const trimmed = String(input).trim();
  if (!trimmed) return invalidResult();

  const num = Number(trimmed);
  if (Number.isNaN(num) || !Number.isFinite(num)) return invalidResult();

  // Auto-detect ms vs seconds: values > 1e10 are treated as ms
  const ms = Math.abs(num) > 1e10 ? num : num * 1000;
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return invalidResult();

  return result(ms, date, options);
}

/** A date string (anything `new Date()` parses) as a timestamp; see {@link fromTimestamp}. */
export function fromDateString(input: string, options: TimestampOptions = {}): TimestampResult {
  if (typeof input !== "string" || !input.trim()) return invalidResult();

  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return invalidResult();

  return result(date.getTime(), date, options);
}
