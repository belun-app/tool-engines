export interface DateOffset {
  years: number;
  months: number;
  weeks: number;
  days: number;
}

export type DateDirection = "add" | "subtract";

export interface DateCalculatorResult {
  isValid: boolean;
  /** Resulting date as yyyy-mm-dd. */
  date: string;
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** Day of week of the start date, same encoding. */
  startDayOfWeek: number;
  /** Signed calendar-day distance from the start date to the result. */
  totalDaysOffset: number;
  /** 1–366. */
  dayOfYear: number;
  /** ISO-8601 week number of the result, 1–53. */
  isoWeek: number;
  /** The year that ISO week belongs to — not always the calendar year. */
  isoWeekYear: number;
  /** Whether the result's calendar year is a leap year. */
  isLeapYear: boolean;
  /** Calendar days left in the result's year after the result date. */
  daysLeftInYear: number;
  /** Saturdays and Sundays stepped over — only non-zero in business-day mode. */
  weekendDaysSkipped: number;
  /** True when the result falls on a Saturday or Sunday. */
  isWeekend: boolean;
}

const MS_PER_DAY = 86_400_000;

const EMPTY_RESULT: DateCalculatorResult = {
  isValid: false,
  date: "",
  dayOfWeek: 0,
  startDayOfWeek: 0,
  totalDaysOffset: 0,
  dayOfYear: 0,
  isoWeek: 0,
  isoWeekYear: 0,
  isLeapYear: false,
  daysLeftInYear: 0,
  weekendDaysSkipped: 0,
  isWeekend: false,
};

export const EMPTY_OFFSET: DateOffset = { years: 0, months: 0, weeks: 0, days: 0 };

function parseIsoDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1) return null;
  if (check.getUTCDate() !== day) return null;
  return utc;
}

function toIso(utc: number): string {
  const date = new Date(utc);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${month}-${day}`;
}

/**
 * Calendar month arithmetic with end-of-month clamping: 31 January plus one month is
 * 28 (or 29) February, never 3 March. Spreadsheets settled on this with EDATE and every
 * serious date library copied it, so matching it keeps results comparable.
 */
function addMonthsClamped(utc: number, count: number): number {
  const date = new Date(utc);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + count;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(date.getUTCDate(), lastDayOfTarget));
}

const isWeekendDay = (utc: number): boolean => {
  const day = new Date(utc).getUTCDay();
  return day === 0 || day === 6;
};

/** Steps `count` weekdays in `step` direction, reporting how many Sat/Sun were crossed. */
function stepBusinessDays(
  utc: number,
  count: number,
  step: 1 | -1,
): { utc: number; skipped: number } {
  let current = utc;
  let skipped = 0;

  // An anchor sitting on a weekend has no business-day meaning, so it moves to the
  // first weekday in the direction of travel before any counting starts.
  while (isWeekendDay(current)) {
    current += step * MS_PER_DAY;
    skipped += 1;
  }

  for (let moved = 0; moved < count; ) {
    current += step * MS_PER_DAY;
    if (isWeekendDay(current)) {
      skipped += 1;
    } else {
      moved += 1;
    }
  }

  return { utc: current, skipped };
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** ISO-8601 week: weeks start on Monday and week 1 is the week holding 4 January. */
function isoWeekOf(utc: number): { week: number; year: number } {
  const date = new Date(utc);
  const dayOfWeek = date.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  const thursday = utc + (4 - dayOfWeek) * MS_PER_DAY;
  const year = new Date(thursday).getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday - jan1) / MS_PER_DAY / 7) + 1;
  return { week, year };
}

const clampOffsetPart = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-120_000, Math.min(120_000, Math.trunc(value)));
};

/**
 * Adds or subtracts a years/months/weeks/days offset from a date.
 *
 * Order matters and is fixed: years, then months (both clamped to the end of the target
 * month), then the plain day count. Doing days first would make "one month and one day
 * after 30 January" ambiguous.
 *
 * In business-day mode the years and months parts stay calendar-based, and the weeks and
 * days parts are counted in weekdays — a week being five business days.
 */
export function calculateDate(
  startDate: string,
  offset: Partial<DateOffset>,
  direction: DateDirection = "add",
  businessDaysOnly = false,
): DateCalculatorResult {
  const startUtc = parseIsoDate(startDate);
  if (startUtc === null) return { ...EMPTY_RESULT };

  const sign = direction === "subtract" ? -1 : 1;
  const years = clampOffsetPart(offset.years ?? 0);
  const months = clampOffsetPart(offset.months ?? 0);
  const weeks = clampOffsetPart(offset.weeks ?? 0);
  const days = clampOffsetPart(offset.days ?? 0);

  const monthShift = sign * (years * 12 + months);
  let resultUtc = monthShift === 0 ? startUtc : addMonthsClamped(startUtc, monthShift);
  let weekendDaysSkipped = 0;

  if (businessDaysOnly) {
    const businessTotal = sign * (weeks * 5 + days);
    // A zero offset leaves the date alone, weekend or not — nudging it would be a
    // surprise for someone who only changed the checkbox.
    if (businessTotal !== 0) {
      const stepped = stepBusinessDays(
        resultUtc,
        Math.abs(businessTotal),
        businessTotal < 0 ? -1 : 1,
      );
      resultUtc = stepped.utc;
      weekendDaysSkipped = stepped.skipped;
    }
  } else {
    resultUtc += sign * (weeks * 7 + days) * MS_PER_DAY;
  }

  const resultDate = new Date(resultUtc);
  const year = resultDate.getUTCFullYear();
  if (!Number.isFinite(resultUtc) || year < 1 || year > 9999) return { ...EMPTY_RESULT };

  const jan1 = Date.UTC(year, 0, 1);
  const dayOfYear = Math.round((resultUtc - jan1) / MS_PER_DAY) + 1;
  const yearLength = isLeap(year) ? 366 : 365;
  const iso = isoWeekOf(resultUtc);

  return {
    isValid: true,
    date: toIso(resultUtc),
    dayOfWeek: resultDate.getUTCDay(),
    startDayOfWeek: new Date(startUtc).getUTCDay(),
    totalDaysOffset: Math.round((resultUtc - startUtc) / MS_PER_DAY),
    dayOfYear,
    isoWeek: iso.week,
    isoWeekYear: iso.year,
    isLeapYear: isLeap(year),
    daysLeftInYear: yearLength - dayOfYear,
    weekendDaysSkipped,
    isWeekend: isWeekendDay(resultUtc),
  };
}
