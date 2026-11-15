/**
 * Converts a time between time zones with Intl, daylight saving time included, and formats
 * one instant across many zones.
 */

export interface ZoneTime {
  /** IANA timezone identifier, e.g. "America/New_York" */
  timeZone: string;
  /** Formatted clock time, e.g. "14:30" (24h) or "2:30 PM" (12h) */
  time: string;
  /** Formatted date, e.g. "Sat, Jul 4" */
  date: string;
  /** UTC offset label, e.g. "UTC+02:00" */
  offsetLabel: string;
  /** Offset from UTC in minutes at the given instant (e.g. +120 for UTC+2) */
  offsetMinutes: number;
  /** Calendar-day difference versus the reference zone: -1, 0, or +1 (or more in extremes) */
  dayDiff: number;
  /** False when the timeZone is not a valid IANA identifier on this platform */
  isValid: boolean;
}

export interface ConvertOptions {
  /** Use 12-hour clock with AM/PM. Default: false (24-hour). */
  hour12?: boolean;
  /** BCP-47 locale for formatting the time and date strings. Default: "en-US". */
  locale?: string;
  /** Zone used as the "same day" baseline for dayDiff. Default: the first zone in the list. */
  referenceTimeZone?: string;
}

export interface TimeZoneOption {
  /** IANA identifier, e.g. "Europe/London" */
  id: string;
  /** Short human label, e.g. "London" */
  label: string;
}

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * A small curated set of well-known zones, used to seed the picker and as a
 * fallback when the platform does not expose Intl.supportedValuesOf.
 */
export const COMMON_TIMEZONES: TimeZoneOption[] = [
  { id: "UTC", label: "UTC" },
  { id: "Pacific/Honolulu", label: "Honolulu" },
  { id: "America/Anchorage", label: "Anchorage" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Denver", label: "Denver" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Sao_Paulo", label: "São Paulo" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/Madrid", label: "Madrid" },
  { id: "Europe/Moscow", label: "Moscow" },
  { id: "Africa/Cairo", label: "Cairo" },
  { id: "Africa/Johannesburg", label: "Johannesburg" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Karachi", label: "Karachi" },
  { id: "Asia/Kolkata", label: "Kolkata" },
  { id: "Asia/Bangkok", label: "Bangkok" },
  { id: "Asia/Shanghai", label: "Shanghai" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Australia/Sydney", label: "Sydney" },
  { id: "Pacific/Auckland", label: "Auckland" },
];

/** True when the runtime accepts the identifier as a valid IANA time zone. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The visitor's own IANA zone, or "UTC" if it cannot be resolved. */
export function getLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function getZoneParts(timeZone: string, date: Date): ZoneParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hour = Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // h23 should give 0–23, but guard against a stray 24 at midnight.
    hour: hour === 24 ? 0 : hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Offset of a zone from UTC, in minutes, at a specific instant.
 * Positive east of UTC (e.g. +120 for UTC+2). Returns NaN for invalid zones.
 */
export function getZoneOffsetMinutes(timeZone: string, epochMs: number): number {
  if (!Number.isFinite(epochMs)) return Number.NaN;
  try {
    const p = getZoneParts(timeZone, new Date(epochMs));
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUTC - epochMs) / 60000);
  } catch {
    return Number.NaN;
  }
}

/** Format an offset in minutes as "UTC+02:00" / "UTC-05:30" / "UTC+00:00". */
export function formatOffset(minutes: number): string {
  if (!Number.isFinite(minutes)) return "";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Whole day number (days since the Unix epoch) for the wall date in a zone. */
function zoneDayNumber(timeZone: string, epochMs: number): number {
  const p = getZoneParts(timeZone, new Date(epochMs));
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86400000);
}

/**
 * Interpret a wall-clock date and time as belonging to a given zone and return
 * the matching UTC instant (epoch ms). Handles DST gaps/overlaps by refining the
 * offset once at the candidate instant. Returns NaN on malformed input.
 */
export function zonedWallTimeToEpoch(dateStr: string, timeStr: string, timeZone: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return Number.NaN;
  if (!isValidTimeZone(timeZone)) return Number.NaN;

  const asUTC = Date.UTC(y, mo - 1, d, h, mi);
  const offset = getZoneOffsetMinutes(timeZone, asUTC);
  if (!Number.isFinite(offset)) return Number.NaN;

  const epoch = asUTC - offset * 60000;
  // Re-check the offset at the candidate instant; DST boundaries shift it.
  const offset2 = getZoneOffsetMinutes(timeZone, epoch);
  return offset2 === offset ? epoch : asUTC - offset2 * 60000;
}

/**
 * Format a single instant across many zones. Empty or invalid input yields an
 * empty array; invalid individual zones are returned flagged, never thrown.
 */
export function convertToZones(
  epochMs: number,
  timeZones: string[],
  options: ConvertOptions = {},
): ZoneTime[] {
  if (!Number.isFinite(epochMs) || timeZones.length === 0) return [];

  const hour12 = options.hour12 ?? false;
  const locale = options.locale ?? "en-US";
  const refZone = options.referenceTimeZone ?? timeZones[0];
  const refDay = isValidTimeZone(refZone) ? zoneDayNumber(refZone, epochMs) : 0;
  const date = new Date(epochMs);

  return timeZones.map((tz) => {
    if (!isValidTimeZone(tz)) {
      return {
        timeZone: tz,
        time: "",
        date: "",
        offsetLabel: "",
        offsetMinutes: Number.NaN,
        dayDiff: 0,
        isValid: false,
      };
    }
    const offsetMinutes = getZoneOffsetMinutes(tz, epochMs);
    const time = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12,
    }).format(date);
    const dateLabel = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
    return {
      timeZone: tz,
      time,
      date: dateLabel,
      offsetLabel: formatOffset(offsetMinutes),
      offsetMinutes,
      dayDiff: zoneDayNumber(tz, epochMs) - refDay,
      isValid: true,
    };
  });
}

/**
 * Wall-clock date and time of an instant in a zone, as HTML input values
 * ("YYYY-MM-DD" and "HH:MM"). Used to seed <input type="date"/type="time">.
 */
export function getZoneWallFields(
  timeZone: string,
  epochMs: number,
): { date: string; time: string } {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const p = getZoneParts(zone, new Date(epochMs));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** Prettify an IANA id for display: "America/New_York" → "America / New York". */
export function prettyZoneName(id: string): string {
  return id.replace(/_/g, " ").replace(/\//g, " / ");
}
