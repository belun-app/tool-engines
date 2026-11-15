import { describe, expect, it } from "vitest";
import { calculateDate } from "./date-calculator.js";

describe("calculateDate", () => {
  it("adds plain days (30/60/90 days from a date)", () => {
    // 2024-01-15 + 30 = 2024-02-14 ; + 90 = 2024-04-14 (Feb 2024 has 29 days)
    expect(calculateDate("2024-01-15", { days: 30 }).date).toBe("2024-02-14");
    expect(calculateDate("2024-01-15", { days: 90 }).date).toBe("2024-04-14");
    const r = calculateDate("2024-01-15", { days: 30 });
    expect(r.totalDaysOffset).toBe(30);
    expect(r.startDayOfWeek).toBe(1); // Monday
    expect(r.dayOfWeek).toBe(3); // Wednesday
  });

  it("subtracts weeks and days", () => {
    expect(calculateDate("2024-03-01", { weeks: 1, days: 1 }, "subtract").date).toBe("2024-02-22");
    expect(calculateDate("2024-03-01", { days: 1 }, "subtract").totalDaysOffset).toBe(-1);
  });

  it("clamps month arithmetic to the end of the target month", () => {
    expect(calculateDate("2024-01-31", { months: 1 }).date).toBe("2024-02-29");
    expect(calculateDate("2023-01-31", { months: 1 }).date).toBe("2023-02-28");
    expect(calculateDate("2024-02-29", { years: 1 }).date).toBe("2025-02-28");
    expect(calculateDate("2024-03-31", { months: 1 }, "subtract").date).toBe("2024-02-29");
  });

  it("applies months before days", () => {
    // 2024-01-30 + 1 month = 2024-02-29, + 1 day = 2024-03-01
    expect(calculateDate("2024-01-30", { months: 1, days: 1 }).date).toBe("2024-03-01");
  });

  it("reports day of year, ISO week, leap year and days left", () => {
    const r = calculateDate("2024-12-31", {});
    expect(r.dayOfYear).toBe(366);
    expect(r.isLeapYear).toBe(true);
    expect(r.daysLeftInYear).toBe(0);
    // 2024-12-31 is a Tuesday in ISO week 1 of 2025
    expect(r.isoWeek).toBe(1);
    expect(r.isoWeekYear).toBe(2025);
    // 2021-01-01 (Friday) belongs to ISO week 53 of 2020
    const jan = calculateDate("2021-01-01", {});
    expect(jan.isoWeek).toBe(53);
    expect(jan.isoWeekYear).toBe(2020);
    expect(calculateDate("1900-03-01", {}).isLeapYear).toBe(false);
    expect(calculateDate("2000-03-01", {}).isLeapYear).toBe(true);
  });

  it("counts business days and the weekends skipped", () => {
    // Friday 2024-11-15 + 1 business day = Monday 2024-11-18
    const r = calculateDate("2024-11-15", { days: 1 }, "add", true);
    expect(r.date).toBe("2024-11-18");
    expect(r.weekendDaysSkipped).toBe(2);
    expect(r.isWeekend).toBe(false);
    // + 1 business week = 5 weekdays: Fri -> next Fri
    expect(calculateDate("2024-11-15", { weeks: 1 }, "add", true).date).toBe("2024-11-22");
    // Monday - 1 business day = previous Friday
    expect(calculateDate("2024-11-18", { days: 1 }, "subtract", true).date).toBe("2024-11-15");
  });

  it("moves a weekend start to the next weekday before counting (as the page documents)", () => {
    // Saturday 2024-11-16 -> Monday 18 (2 skipped), then +1 -> Tuesday 19.
    // Note: Excel's WORKDAY(Sat, 1) would give Monday; the page explicitly documents this rule.
    const r = calculateDate("2024-11-16", { days: 1 }, "add", true);
    expect(r.date).toBe("2024-11-19");
    expect(r.weekendDaysSkipped).toBe(2);
  });

  it("leaves a weekend date alone for a zero business-day offset", () => {
    const r = calculateDate("2024-11-16", {}, "add", true);
    expect(r.date).toBe("2024-11-16");
    expect(r.isWeekend).toBe(true);
    expect(r.weekendDaysSkipped).toBe(0);
  });

  it("truncates fractional offsets and ignores NaN", () => {
    expect(calculateDate("2024-01-01", { days: 2.9 }).date).toBe("2024-01-03");
    expect(calculateDate("2024-01-01", { days: Number.NaN }).date).toBe("2024-01-01");
  });

  it("rejects invalid dates and results outside years 1–9999", () => {
    for (const d of ["", "2024-02-30", "2023-02-29", "2024-13-01", "24-01-01", "2024/01/01"]) {
      expect(calculateDate(d, { days: 1 }).isValid).toBe(false);
    }
    expect(calculateDate("9999-12-31", { days: 1 }).isValid).toBe(false);
    expect(calculateDate("2024-01-01", { years: 10000 }).isValid).toBe(false);
  });

  it("returns a fresh empty object each time", () => {
    const a = calculateDate("bad", {});
    a.date = "mutated";
    expect(calculateDate("bad", {}).date).toBe("");
  });
});
