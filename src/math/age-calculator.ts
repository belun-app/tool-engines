export interface AgeResult {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  nextBirthdayDays: number;
  weekdayBorn: string;
  /**
   * Set when no age could be calculated; every number is then 0. Absent on success.
   * - `invalid-birthdate`: not a real YYYY-MM-DD date.
   * - `invalid-reference-date`: a reference date was given but is not a real YYYY-MM-DD date.
   * - `birthdate-after-reference`: the birth date is after the reference date.
   */
  error?: AgeErrorCode;
}

export type AgeErrorCode =
  | "invalid-birthdate"
  | "invalid-reference-date"
  | "birthdate-after-reference";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Age from a birth date (YYYY-MM-DD) to a reference date (YYYY-MM-DD, default: today in the
 * host's local time zone). Invalid input gives all-zero numbers and an `error` code.
 */
export function calculateAge(birthdate: string, referenceDate?: string): AgeResult {
  const fail = (error: AgeErrorCode): AgeResult => ({
    years: 0,
    months: 0,
    days: 0,
    totalDays: 0,
    nextBirthdayDays: 0,
    weekdayBorn: "",
    error,
  });

  if (typeof birthdate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
    return fail("invalid-birthdate");
  }

  const [by, bm, bd] = birthdate.split("-").map(Number);
  // "2023-02-30" or "2023-13-01" would silently roll over into another date.
  const isRealDate = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  if (!isRealDate(by, bm, bd)) return fail("invalid-birthdate");

  let ry: number;
  let rm: number;
  let rd: number;
  if (referenceDate !== undefined && referenceDate !== "") {
    const ref =
      typeof referenceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)
        ? referenceDate.split("-").map(Number)
        : null;
    if (!ref || !isRealDate(ref[0], ref[1], ref[2])) return fail("invalid-reference-date");
    [ry, rm, rd] = ref;
  } else {
    const today = new Date();
    ry = today.getFullYear();
    rm = today.getMonth() + 1;
    rd = today.getDate();
  }

  const birthDate = new Date(by, bm - 1, bd);
  const refDate = new Date(ry, rm - 1, rd);

  if (birthDate > refDate) return fail("birthdate-after-reference");

  // Total months elapsed from birth to reference date, then adjust if anniversary is still in the future
  let totalMonths = (ry - by) * 12 + (rm - bm);
  let annYear = by + Math.floor((bm - 1 + totalMonths) / 12);
  let annMonth = ((bm - 1 + totalMonths) % 12) + 1;
  let annDay = Math.min(bd, daysInMonth(annYear, annMonth));
  let annDate = new Date(annYear, annMonth - 1, annDay);

  if (annDate > refDate) {
    totalMonths--;
    annYear = by + Math.floor((bm - 1 + totalMonths) / 12);
    annMonth = ((bm - 1 + totalMonths) % 12) + 1;
    annDay = Math.min(bd, daysInMonth(annYear, annMonth));
    annDate = new Date(annYear, annMonth - 1, annDay);
  }

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const days = Math.round((refDate.getTime() - annDate.getTime()) / 86400000);
  const totalDays = Math.round((refDate.getTime() - birthDate.getTime()) / 86400000);

  let nextBirthday = new Date(ry, bm - 1, bd);
  if (nextBirthday < refDate) nextBirthday = new Date(ry + 1, bm - 1, bd);
  const nextBirthdayDays = Math.round((nextBirthday.getTime() - refDate.getTime()) / 86400000);

  const weekdayBorn = WEEKDAYS[new Date(by, bm - 1, bd).getDay()];

  return { years, months, days, totalDays, nextBirthdayDays, weekdayBorn };
}
