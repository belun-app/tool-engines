import { describe, expect, it } from "vitest";
import {
  type SalaryInput,
  calculateSalary,
  periodsPerYear,
} from "./salary-to-hourly-calculator.js";

const base: SalaryInput = {
  amount: 52_000,
  period: "annual",
  hoursPerWeek: 40,
  daysPerWeek: 5,
  holidaysPerYear: 0,
  vacationDaysPerYear: 0,
};

describe("periodsPerYear", () => {
  it("uses the 52-week payroll calendar", () => {
    expect(periodsPerYear("hourly", 40, 5)).toBe(2080);
    expect(periodsPerYear("daily", 40, 5)).toBe(260);
    expect(periodsPerYear("weekly", 40, 5)).toBe(52);
    expect(periodsPerYear("biweekly", 40, 5)).toBe(26);
    expect(periodsPerYear("semiMonthly", 40, 5)).toBe(24);
    expect(periodsPerYear("monthly", 40, 5)).toBe(12);
    expect(periodsPerYear("quarterly", 40, 5)).toBe(4);
    expect(periodsPerYear("annual", 40, 5)).toBe(1);
  });
});

describe("calculateSalary", () => {
  it("converts $52,000 a year to $25 an hour", () => {
    // 52000 / 2080 = 25 ; / 260 = 200 ; / 52 = 1000 ; / 26 = 2000 ; / 24 = 2166.67 ; / 12 = 4333.33
    const r = calculateSalary(base);
    expect(r.valid).toBe(true);
    expect(r.unadjusted).toEqual({
      hourly: 25,
      daily: 200,
      weekly: 1000,
      biweekly: 2000,
      semiMonthly: 2166.67,
      monthly: 4333.33,
      quarterly: 13_000,
      annual: 52_000,
    });
    expect(r.adjusted).toEqual(r.unadjusted);
    expect(r.workedFraction).toBe(1);
    expect(r.effectiveHourlyPaidLeave).toBe(25);
    expect(r.dayValue).toBe(200);
  });

  it("converts an hourly rate up to an annual salary", () => {
    // $30/h * 37.5 h * 52 = 58 500
    const r = calculateSalary({ ...base, amount: 30, period: "hourly", hoursPerWeek: 37.5 });
    expect(r.unadjusted.annual).toBe(58_500);
    expect(r.unadjusted.hourly).toBe(30);
  });

  it("adjusts for unpaid holidays and vacation", () => {
    // 10 holidays + 15 vacation = 25 of 260 days -> worked fraction 235/260
    const r = calculateSalary({ ...base, holidaysPerYear: 10, vacationDaysPerYear: 15 });
    expect(r.scheduledDays).toBe(260);
    expect(r.daysOff).toBe(25);
    expect(r.workedDays).toBe(235);
    expect(r.workedFraction).toBeCloseTo(235 / 260, 12);
    // 52000 * 235/260 = 47000
    expect(r.adjusted.annual).toBe(47_000);
    expect(r.workedHours).toBe(1880); // 2080 * 235/260
    // paid leave: 52000 / 1880 = 27.66
    expect(r.effectiveHourlyPaidLeave).toBe(27.66);
  });

  it("caps days off at the scheduled year", () => {
    const r = calculateSalary({ ...base, vacationDaysPerYear: 400 });
    expect(r.workedDays).toBe(0);
    expect(r.adjusted.annual).toBe(0);
    expect(r.effectiveHourlyPaidLeave).toBe(0);
  });

  it("ignores negative or NaN time off", () => {
    const r = calculateSalary({ ...base, holidaysPerYear: -5, vacationDaysPerYear: Number.NaN });
    expect(r.daysOff).toBe(0);
  });

  it("returns the invalid result for bad schedules or amounts", () => {
    for (const bad of [
      { ...base, amount: 0 },
      { ...base, amount: -1 },
      { ...base, hoursPerWeek: 0 },
      { ...base, hoursPerWeek: 169 },
      { ...base, daysPerWeek: 8 },
      { ...base, daysPerWeek: Number.NaN },
    ]) {
      const r = calculateSalary(bad);
      expect(r.valid).toBe(false);
      expect(r.unadjusted.hourly).toBe(0);
    }
  });
});
