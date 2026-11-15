/**
 * Days between two dates, also as weeks, months and years plus days, with the number of
 * weekdays and weekend days.
 */

export interface DaysBetweenDatesResult {
  isValid: boolean;
  totalDays: number;
  fullWeeks: number;
  weekRemainderDays: number;
  totalMonths: number;
  years: number;
  months: number;
  days: number;
  weekdays: number;
  weekendDays: number;
}

const EMPTY_RESULT: DaysBetweenDatesResult = {
  isValid: false,
  totalDays: 0,
  fullWeeks: 0,
  weekRemainderDays: 0,
  totalMonths: 0,
  years: 0,
  months: 0,
  days: 0,
  weekdays: 0,
  weekendDays: 0,
};

const MS_PER_DAY = 86_400_000;

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

function addMonthsClamped(utc: number, count: number): number {
  const date = new Date(utc);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + count;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(date.getUTCDate(), lastDayOfTarget));
}

function calendarBreakdown(
  fromUtc: number,
  toUtc: number,
): { years: number; months: number; days: number } {
  const from = new Date(fromUtc);
  const to = new Date(toUtc);

  let totalMonths =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (addMonthsClamped(fromUtc, totalMonths) > toUtc) totalMonths -= 1;
  if (totalMonths < 0) totalMonths = 0;

  const days = Math.round((toUtc - addMonthsClamped(fromUtc, totalMonths)) / MS_PER_DAY);

  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, days };
}

function countWeekdays(startUtc: number, totalDays: number): number {
  const fullWeeks = Math.floor(totalDays / 7);
  let weekdays = fullWeeks * 5;
  for (let i = fullWeeks * 7; i < totalDays; i++) {
    const dayOfWeek = new Date(startUtc + i * MS_PER_DAY).getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) weekdays += 1;
  }
  return weekdays;
}

export function daysBetweenDates(
  startDate: string,
  endDate: string,
  includeEndDate: boolean,
): DaysBetweenDatesResult {
  const startUtc = parseIsoDate(startDate);
  const endUtc = parseIsoDate(endDate);
  if (startUtc === null || endUtc === null) return EMPTY_RESULT;

  const fromUtc = Math.min(startUtc, endUtc);
  const toUtc = Math.max(startUtc, endUtc);
  const toAdjustedUtc = includeEndDate ? toUtc + MS_PER_DAY : toUtc;

  const totalDays = Math.round((toAdjustedUtc - fromUtc) / MS_PER_DAY);
  const breakdown = calendarBreakdown(fromUtc, toAdjustedUtc);
  const weekdays = countWeekdays(fromUtc, totalDays);

  return {
    isValid: true,
    totalDays,
    fullWeeks: Math.floor(totalDays / 7),
    weekRemainderDays: totalDays % 7,
    totalMonths: breakdown.years * 12 + breakdown.months,
    years: breakdown.years,
    months: breakdown.months,
    days: breakdown.days,
    weekdays,
    weekendDays: totalDays - weekdays,
  };
}
