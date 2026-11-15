import { describe, expect, it } from "vitest";
import { daysBetweenDates } from "./days-between-dates-calculator.js";

describe("daysBetweenDates", () => {
  it("counts days across a leap year", () => {
    // 2024 is a leap year: Jan 1 -> Dec 31 is 365 days, 366 with the end date
    const r = daysBetweenDates("2024-01-01", "2024-12-31", false);
    expect(r.totalDays).toBe(365);
    expect(r.fullWeeks).toBe(52);
    expect(r.weekRemainderDays).toBe(1);
    expect(r).toMatchObject({ years: 0, months: 11, days: 30, totalMonths: 11 });
    const inc = daysBetweenDates("2024-01-01", "2024-12-31", true);
    expect(inc.totalDays).toBe(366);
    expect(inc).toMatchObject({ years: 1, months: 0, days: 0, totalMonths: 12 });
  });

  it("counts weekdays and weekend days", () => {
    // 2024-01-01 is a Monday; 366 days inclusive = 52 weeks (260 weekdays) + Mon, Tue
    const inc = daysBetweenDates("2024-01-01", "2024-12-31", true);
    expect(inc.weekdays).toBe(262);
    expect(inc.weekendDays).toBe(104);
    // Mon 2024-11-11 -> Mon 2024-11-18 exclusive: 5 weekdays, 2 weekend days
    const week = daysBetweenDates("2024-11-11", "2024-11-18", false);
    expect(week.weekdays).toBe(5);
    expect(week.weekendDays).toBe(2);
    // Sat -> Mon exclusive: Sat, Sun
    expect(daysBetweenDates("2024-11-16", "2024-11-18", false).weekdays).toBe(0);
  });

  it("is order independent", () => {
    const a = daysBetweenDates("2020-03-15", "2024-07-04", false);
    const b = daysBetweenDates("2024-07-04", "2020-03-15", false);
    expect(a).toEqual(b);
    // 2020-03-15 -> 2024-03-15 = 4 y ; -> 2024-07-04 = 3 m 19 d
    expect(a).toMatchObject({ years: 4, months: 3, days: 19 });
    // Date.UTC diff: 1572 days
    expect(a.totalDays).toBe(1572);
  });

  it("handles the same date", () => {
    expect(daysBetweenDates("2024-05-05", "2024-05-05", false).totalDays).toBe(0);
    expect(daysBetweenDates("2024-05-05", "2024-05-05", true).totalDays).toBe(1);
  });

  it("breaks month-end spans down with clamping", () => {
    // Jan 31 -> Feb 29 2024: one clamped month, 0 days
    expect(daysBetweenDates("2024-01-31", "2024-02-29", false)).toMatchObject({
      months: 1,
      days: 0,
      totalDays: 29,
    });
  });

  it("returns the invalid result for bad dates", () => {
    for (const [a, b] of [
      ["", "2024-01-01"],
      ["2024-02-30", "2024-03-01"],
      ["2024-01-01", "01/02/2024"],
    ]) {
      const r = daysBetweenDates(a, b, false);
      expect(r.isValid).toBe(false);
      expect(r.totalDays).toBe(0);
    }
  });
});
