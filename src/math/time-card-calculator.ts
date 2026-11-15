/**
 * Weekly time card maths: punch pairs per day, unpaid breaks, punch rounding,
 * and the two-tier overtime rule (daily threshold first, then weekly).
 *
 * Everything is kept in whole minutes until the last step, because adding decimal
 * hours is exactly where hand-built spreadsheets go wrong — 8.5 + 7.75 is fine,
 * but 8:30 typed as 8.30 is not, and the error compounds over seven rows.
 */

export interface TimeCardDay {
  /** Morning punch in, "HH:MM" in 24-hour form. */
  in1: string;
  out1: string;
  /** Afternoon punch pair, for a card that clocks out over lunch. */
  in2: string;
  out2: string;
  /** Unpaid break in minutes, deducted after the punches are summed. */
  breakMinutes: string | number;
}

export interface TimeCardOptions {
  /** Pay per hour. 0 or blank disables every money readout. */
  payRate: string | number;
  /** Overtime rate multiplier, typically 1.5. */
  overtimeMultiplier: string | number;
  /** Daily overtime threshold in hours. 0 disables daily overtime. */
  dailyOvertimeAfter: string | number;
  /** Weekly overtime threshold in hours. 0 disables weekly overtime. */
  weeklyOvertimeAfter: string | number;
  /** Punch rounding increment in minutes: 0 or 1 keeps punches exact. */
  roundTo: string | number;
  /**
   * Optional second overtime step. When it is set (1 or more), only the first
   * `overtimeTierHours` of each day's overtime — and of the weekly overtime — are
   * paid at `overtimeMultiplier`, and the rest at this one. Russian Labour Code
   * art. 152: the first two hours at 1.5, the following ones at 2.
   * Omitted, blank or 0 keeps the single multiplier.
   */
  overtimeTierMultiplier?: string | number;
  /** Overtime hours per day paid at the first multiplier when a second step is set. Default 2. */
  overtimeTierHours?: string | number;
}

export interface TimeCardDayResult {
  /** At least one punch field held a value. */
  used: boolean;
  /** A field held something that is not a time, or a pair is half-filled. */
  invalid: boolean;
  /** Minutes between the punches, before the break is taken off. */
  workedMinutes: number;
  /** Minutes actually deducted — never more than was worked. */
  breakMinutes: number;
  /** Paid minutes for the day: worked minus break. */
  totalMinutes: number;
  decimalHours: number;
  /** "8:30" — hours and minutes, not a decimal. */
  clock: string;
  /** A punch pair that ends earlier than it starts, i.e. a night shift. */
  crossesMidnight: boolean;
  regularMinutes: number;
  /** Minutes over the daily threshold. Weekly overtime is not folded in here. */
  overtimeMinutes: number;
  /** Part of `overtimeMinutes` paid at the second step. 0 without a second step. */
  overtimeHighMinutes: number;
}

export interface TimeCardResult {
  days: TimeCardDayResult[];
  /** Paid minutes across the week. */
  totalMinutes: number;
  totalDecimalHours: number;
  /** "41:15" for the whole week. */
  totalClock: string;
  regularMinutes: number;
  /** Daily overtime plus whatever the weekly threshold adds on top. */
  overtimeMinutes: number;
  /** Overtime that only exists because the week passed the weekly threshold. */
  weeklyOvertimeMinutes: number;
  /** Part of `overtimeMinutes` paid at the second step. 0 without a second step. */
  overtimeHighMinutes: number;
  totalBreakMinutes: number;
  daysWorked: number;
  averageDailyMinutes: number;
  longestDayMinutes: number;
  regularPay: number;
  overtimePay: number;
  totalPay: number;
  /** Effective hourly rate once overtime is averaged in. */
  effectiveRate: number;
  hasInvalid: boolean;
  anyCrossesMidnight: boolean;
}

/**
 * Accepts the 24-hour "HH:MM" an `<input type="time">` produces, and also the
 * 12-hour forms people type by hand: "9", "9:30 am", "5pm", "12.45 PM".
 * A bare "9" is read as 09:00 — the only reading that makes sense on a time card.
 */
export function parsePunch(value: string): number | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;

  const match = /^(\d{1,2})(?:[:.\s]?(\d{2}))?\s*(am|pm|a|p)?$/.exec(raw);
  if (!match) return null;

  let hours = Number.parseInt(match[1], 10);
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const suffix = match[3];

  if (minutes > 59) return null;

  if (suffix) {
    if (hours < 1 || hours > 12) return null;
    const pm = suffix.startsWith("p");
    if (pm && hours !== 12) hours += 12;
    if (!pm && hours === 12) hours = 0;
  } else if (hours === 24 && minutes === 0) {
    return 1440;
  } else if (hours > 23) {
    return null;
  }

  return hours * 60 + minutes;
}

/** Minutes since midnight back to "HH:MM", wrapping at the day boundary. */
export function formatPunch(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Duration in whole minutes as "H:MM". 495 becomes "8:15", never "8.25". */
export function formatDuration(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(totalMinutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Punch rounding to the nearest increment. The quarter-hour case is the US
 * "seven-minute rule": 8:07 rounds back to 8:00, 8:08 forward to 8:15.
 * Ties go up, which is what every payroll package does.
 */
export function roundPunch(minutes: number, increment: number): number {
  if (!Number.isFinite(increment) || increment <= 1) return minutes;
  return Math.round(minutes / increment) * increment;
}

function toNumber(value: string | number, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function emptyDay(): TimeCardDayResult {
  return {
    used: false,
    invalid: false,
    workedMinutes: 0,
    breakMinutes: 0,
    totalMinutes: 0,
    decimalHours: 0,
    clock: "0:00",
    crossesMidnight: false,
    regularMinutes: 0,
    overtimeMinutes: 0,
    overtimeHighMinutes: 0,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One punch pair. An end earlier than the start is read as a shift running past
 * midnight rather than as a mistake — graveyard shifts are the reason most
 * spreadsheet time cards show a negative number on Friday night.
 */
function segment(
  inValue: string,
  outValue: string,
  increment: number,
): { minutes: number; invalid: boolean; used: boolean; crossesMidnight: boolean } {
  const hasIn = inValue.trim().length > 0;
  const hasOut = outValue.trim().length > 0;
  if (!hasIn && !hasOut) return { minutes: 0, invalid: false, used: false, crossesMidnight: false };

  const start = parsePunch(inValue);
  const end = parsePunch(outValue);
  if (start === null || end === null) {
    return { minutes: 0, invalid: true, used: true, crossesMidnight: false };
  }

  const roundedStart = roundPunch(start, increment);
  const roundedEnd = roundPunch(end, increment);
  const crossesMidnight = roundedEnd < roundedStart;
  const minutes = crossesMidnight ? 1440 - roundedStart + roundedEnd : roundedEnd - roundedStart;

  return { minutes, invalid: false, used: true, crossesMidnight };
}

export function calculateTimeCard(days: TimeCardDay[], options: TimeCardOptions): TimeCardResult {
  const increment = Math.max(0, toNumber(options.roundTo, 0));
  const dailyThreshold = Math.max(0, toNumber(options.dailyOvertimeAfter, 0)) * 60;
  const weeklyThreshold = Math.max(0, toNumber(options.weeklyOvertimeAfter, 0)) * 60;
  const payRate = Math.max(0, toNumber(options.payRate, 0));
  const multiplier = Math.max(1, toNumber(options.overtimeMultiplier, 1.5));
  const tierMultiplier = toNumber(options.overtimeTierMultiplier ?? 0, 0);
  const tiered = tierMultiplier >= 1;
  const tierMinutes = tiered ? Math.max(0, toNumber(options.overtimeTierHours ?? 2, 2)) * 60 : 0;
  /** Overtime minutes past the first step — 0 when there is no second step. */
  const highPart = (minutes: number) => (tiered ? Math.max(0, minutes - tierMinutes) : 0);

  const results: TimeCardDayResult[] = days.map((day) => {
    const first = segment(day.in1 ?? "", day.out1 ?? "", increment);
    const second = segment(day.in2 ?? "", day.out2 ?? "", increment);

    const breakRaw = Math.max(0, Math.round(toNumber(day.breakMinutes, 0)));
    const used = first.used || second.used;
    if (!used) {
      const blank = emptyDay();
      // A break typed with no punches is a data-entry slip, not a negative day.
      return blank;
    }

    const invalid = first.invalid || second.invalid;
    if (invalid) return { ...emptyDay(), used: true, invalid: true };

    const workedMinutes = first.minutes + second.minutes;
    const breakMinutes = Math.min(breakRaw, workedMinutes);
    const totalMinutes = workedMinutes - breakMinutes;
    const overtimeMinutes = dailyThreshold > 0 ? Math.max(0, totalMinutes - dailyThreshold) : 0;

    return {
      used: true,
      invalid: false,
      workedMinutes,
      breakMinutes,
      totalMinutes,
      decimalHours: round2(totalMinutes / 60),
      clock: formatDuration(totalMinutes),
      crossesMidnight: first.crossesMidnight || second.crossesMidnight,
      regularMinutes: totalMinutes - overtimeMinutes,
      overtimeMinutes,
      overtimeHighMinutes: highPart(overtimeMinutes),
    };
  });

  const worked = results.filter((d) => d.used && !d.invalid && d.totalMinutes > 0);
  const totalMinutes = worked.reduce((sum, d) => sum + d.totalMinutes, 0);
  const dailyOvertime = worked.reduce((sum, d) => sum + d.overtimeMinutes, 0);
  const regularBeforeWeekly = totalMinutes - dailyOvertime;

  // Hours already paid as daily overtime do not count again towards the weekly
  // threshold — that double-count is the classic payroll error.
  const weeklyOvertimeMinutes =
    weeklyThreshold > 0 ? Math.max(0, regularBeforeWeekly - weeklyThreshold) : 0;

  const overtimeMinutes = dailyOvertime + weeklyOvertimeMinutes;
  const regularMinutes = totalMinutes - overtimeMinutes;

  // With a second step, each day's overtime and the weekly overtime are split on
  // their own: the first hours at `multiplier`, whatever is left at `tierMultiplier`.
  const overtimeHighMinutes = tiered
    ? worked.reduce((sum, d) => sum + d.overtimeHighMinutes, 0) + highPart(weeklyOvertimeMinutes)
    : 0;

  const regularPay = round2((regularMinutes / 60) * payRate);
  const overtimePay = tiered
    ? round2(
        ((overtimeMinutes - overtimeHighMinutes) / 60) * payRate * multiplier +
          (overtimeHighMinutes / 60) * payRate * tierMultiplier,
      )
    : round2((overtimeMinutes / 60) * payRate * multiplier);
  const totalPay = round2(regularPay + overtimePay);

  return {
    days: results,
    totalMinutes,
    totalDecimalHours: round2(totalMinutes / 60),
    totalClock: formatDuration(totalMinutes),
    regularMinutes,
    overtimeMinutes,
    weeklyOvertimeMinutes,
    overtimeHighMinutes,
    totalBreakMinutes: worked.reduce((sum, d) => sum + d.breakMinutes, 0),
    daysWorked: worked.length,
    averageDailyMinutes: worked.length ? Math.round(totalMinutes / worked.length) : 0,
    longestDayMinutes: worked.reduce((max, d) => (d.totalMinutes > max ? d.totalMinutes : max), 0),
    regularPay,
    overtimePay,
    totalPay,
    effectiveRate: totalMinutes > 0 ? round2(totalPay / (totalMinutes / 60)) : 0,
    hasInvalid: results.some((d) => d.invalid),
    anyCrossesMidnight: worked.some((d) => d.crossesMidnight),
  };
}
