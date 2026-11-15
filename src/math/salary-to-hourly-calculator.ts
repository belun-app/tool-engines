/**
 * Converts pay between hourly, daily, weekly, biweekly, semi-monthly, monthly, quarterly and
 * annual amounts, from hours and days worked per week and days off.
 */

export type PayPeriod =
  | "hourly"
  | "daily"
  | "weekly"
  | "biweekly"
  | "semiMonthly"
  | "monthly"
  | "quarterly"
  | "annual";

export interface SalaryBreakdown {
  hourly: number;
  daily: number;
  weekly: number;
  biweekly: number;
  semiMonthly: number;
  monthly: number;
  quarterly: number;
  annual: number;
}

export interface SalaryInput {
  /** Pay amount for one unit of `period`. */
  amount: number;
  period: PayPeriod;
  hoursPerWeek: number;
  daysPerWeek: number;
  /** Public holidays in the year. Counted as days not worked. */
  holidaysPerYear: number;
  /** Vacation days in the year. Counted as days not worked. */
  vacationDaysPerYear: number;
}

export interface SalaryResult {
  valid: boolean;
  /** Straight conversion across a full 52-week year — the figure payroll quotes. */
  unadjusted: SalaryBreakdown;
  /** The same pay spread over a year in which holidays and vacation are unpaid. */
  adjusted: SalaryBreakdown;
  /** Scheduled working days in a 52-week year, before any time off. */
  scheduledDays: number;
  /** Days actually spent working. */
  workedDays: number;
  /** Holidays plus vacation, clamped to the scheduled year. */
  daysOff: number;
  /** Paid hours in a nominal year: hours per week × 52. */
  scheduledHours: number;
  /** Hours actually spent working. */
  workedHours: number;
  /** Share of the scheduled year actually worked, 0–1. */
  workedFraction: number;
  /**
   * Annual pay divided by the hours actually worked — what an hour of your time is
   * really worth when the time off is paid. Always at or above the nominal rate.
   */
  effectiveHourlyPaidLeave: number;
  /** What one day away from work is worth at the nominal daily rate. */
  dayValue: number;
}

/**
 * Payroll arithmetic runs on whole weeks: 52 of them, which is 26 fortnights, 24
 * semi-monthly runs and 12 months. The calendar year is 52.18 weeks long, so this
 * convention quietly drops a day or two — every payroll system does the same thing,
 * and matching them matters more here than matching the calendar.
 */
const WEEKS_PER_YEAR = 52;
const BIWEEKLY_PERIODS = 26;
const SEMI_MONTHLY_PERIODS = 24;
const MONTHS_PER_YEAR = 12;
const QUARTERS_PER_YEAR = 4;

const ZERO_BREAKDOWN: SalaryBreakdown = {
  hourly: 0,
  daily: 0,
  weekly: 0,
  biweekly: 0,
  semiMonthly: 0,
  monthly: 0,
  quarterly: 0,
  annual: 0,
};

const EMPTY: SalaryResult = {
  valid: false,
  unadjusted: { ...ZERO_BREAKDOWN },
  adjusted: { ...ZERO_BREAKDOWN },
  scheduledDays: 0,
  workedDays: 0,
  daysOff: 0,
  scheduledHours: 0,
  workedHours: 0,
  workedFraction: 0,
  effectiveHourlyPaidLeave: 0,
  dayValue: 0,
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * How many times the chosen period occurs in a 52-week year. Hourly and daily depend
 * on the schedule; everything else is fixed by the payroll calendar.
 */
export function periodsPerYear(
  period: PayPeriod,
  hoursPerWeek: number,
  daysPerWeek: number,
): number {
  switch (period) {
    case "hourly":
      return hoursPerWeek * WEEKS_PER_YEAR;
    case "daily":
      return daysPerWeek * WEEKS_PER_YEAR;
    case "weekly":
      return WEEKS_PER_YEAR;
    case "biweekly":
      return BIWEEKLY_PERIODS;
    case "semiMonthly":
      return SEMI_MONTHLY_PERIODS;
    case "monthly":
      return MONTHS_PER_YEAR;
    case "quarterly":
      return QUARTERS_PER_YEAR;
    default:
      return 1;
  }
}

function breakdownFromAnnual(
  annual: number,
  hoursPerWeek: number,
  daysPerWeek: number,
): SalaryBreakdown {
  return {
    hourly: round2(annual / (hoursPerWeek * WEEKS_PER_YEAR)),
    daily: round2(annual / (daysPerWeek * WEEKS_PER_YEAR)),
    weekly: round2(annual / WEEKS_PER_YEAR),
    biweekly: round2(annual / BIWEEKLY_PERIODS),
    semiMonthly: round2(annual / SEMI_MONTHLY_PERIODS),
    monthly: round2(annual / MONTHS_PER_YEAR),
    quarterly: round2(annual / QUARTERS_PER_YEAR),
    annual: round2(annual),
  };
}

export function calculateSalary(input: SalaryInput): SalaryResult {
  const { amount, period, hoursPerWeek, daysPerWeek } = input;
  const holidays = Number.isFinite(input.holidaysPerYear) ? Math.max(0, input.holidaysPerYear) : 0;
  const vacation = Number.isFinite(input.vacationDaysPerYear)
    ? Math.max(0, input.vacationDaysPerYear)
    : 0;

  if (![amount, hoursPerWeek, daysPerWeek].every(Number.isFinite)) return { ...EMPTY };
  if (amount <= 0 || hoursPerWeek <= 0 || daysPerWeek <= 0) return { ...EMPTY };
  // A week has 168 hours and 7 days; anything past that is a typo, not a schedule.
  if (hoursPerWeek > 168 || daysPerWeek > 7) return { ...EMPTY };

  const annual = amount * periodsPerYear(period, hoursPerWeek, daysPerWeek);
  const unadjusted = breakdownFromAnnual(annual, hoursPerWeek, daysPerWeek);

  const scheduledDays = daysPerWeek * WEEKS_PER_YEAR;
  // Someone who enters 300 vacation days on a 5-day week gets zero worked days, not a
  // negative salary.
  const daysOff = Math.min(holidays + vacation, scheduledDays);
  const workedDays = scheduledDays - daysOff;
  const workedFraction = workedDays / scheduledDays;

  const scheduledHours = hoursPerWeek * WEEKS_PER_YEAR;
  const workedHours = scheduledHours * workedFraction;

  const adjusted = breakdownFromAnnual(annual * workedFraction, hoursPerWeek, daysPerWeek);

  return {
    valid: true,
    unadjusted,
    adjusted,
    scheduledDays: round1(scheduledDays),
    workedDays: round1(workedDays),
    daysOff: round1(daysOff),
    scheduledHours: round1(scheduledHours),
    workedHours: round1(workedHours),
    workedFraction,
    effectiveHourlyPaidLeave: workedHours > 0 ? round2(annual / workedHours) : 0,
    dayValue: unadjusted.daily,
  };
}
