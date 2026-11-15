import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateAge } from "./age-calculator.js";

describe("calculateAge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes years, months, days and total days (hand-calculated)", () => {
    // 1990-05-15 + 33 y = 2023-05-15, + 9 m = 2024-02-15, + 24 d (Feb 2024 has 29) = 2024-03-10
    const r = calculateAge("1990-05-15", "2024-03-10");
    expect(r.years).toBe(33);
    expect(r.months).toBe(9);
    expect(r.days).toBe(24);
    // Date.UTC(2024,2,10) - Date.UTC(1990,4,15) = 12353 days
    expect(r.totalDays).toBe(12353);
    // next birthday 2024-05-15: 21 days left in March + 30 April + 15 May = 66
    expect(r.nextBirthdayDays).toBe(66);
    expect(r.weekdayBorn).toBe("Tuesday");
  });

  it("returns zero days to the next birthday on the birthday itself", () => {
    const r = calculateAge("2000-06-01", "2020-06-01");
    expect(r).toMatchObject({ years: 20, months: 0, days: 0, nextBirthdayDays: 0 });
  });

  it("handles a birth on the 31st and short months", () => {
    // 2000-01-31 -> 2000-03-01: one month (to Feb 29, clamped) + 1 day
    const r = calculateAge("2000-01-31", "2000-03-01");
    expect(r).toMatchObject({ years: 0, months: 1, days: 1, totalDays: 30 });
  });

  it("handles a 29 February birthday in a non-leap year", () => {
    const r = calculateAge("2000-02-29", "2001-02-28");
    expect(r.years).toBe(1);
    expect(r.months).toBe(0);
    expect(r.days).toBe(0);
    expect(r.totalDays).toBe(365);
  });

  it("is zero for a birth date on the reference date", () => {
    const r = calculateAge("2024-01-01", "2024-01-01");
    expect(r).toMatchObject({ years: 0, months: 0, days: 0, totalDays: 0 });
    expect(r.weekdayBorn).toBe("Monday");
  });

  it("returns zeros and an error code for a future birth date or a bad format", () => {
    const empty = (error: string) => ({
      years: 0,
      months: 0,
      days: 0,
      totalDays: 0,
      nextBirthdayDays: 0,
      weekdayBorn: "",
      error,
    });
    expect(calculateAge("2030-01-01", "2024-01-01")).toEqual(empty("birthdate-after-reference"));
    expect(calculateAge("", "2024-01-01")).toEqual(empty("invalid-birthdate"));
    expect(calculateAge("15.05.1990", "2024-01-01")).toEqual(empty("invalid-birthdate"));
    expect(calculateAge("1990-5-15", "2024-01-01")).toEqual(empty("invalid-birthdate"));
  });

  it("has no error field on success", () => {
    expect(calculateAge("1990-05-15", "2024-03-10")).not.toHaveProperty("error");
  });

  it("does not crash on non-string input", () => {
    expect(calculateAge(undefined as unknown as string, "2024-01-01").error).toBe(
      "invalid-birthdate",
    );
    expect(calculateAge("1990-05-15", 20240101 as unknown as string).error).toBe(
      "invalid-reference-date",
    );
  });

  it("defaults the reference date to today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 2, 10, 12, 0, 0));
    expect(calculateAge("1990-05-15").years).toBe(33);
    expect(calculateAge("1990-05-15", "").years).toBe(33);
  });

  it("reports a malformed or impossible reference date instead of using today", () => {
    expect(calculateAge("1990-05-15", "garbage")).toMatchObject({
      totalDays: 0,
      error: "invalid-reference-date",
    });
    expect(calculateAge("1990-05-15", "2024-02-30").error).toBe("invalid-reference-date");
  });

  it("rejects impossible calendar dates", () => {
    expect(calculateAge("2023-02-30", "2024-01-01")).toMatchObject({
      weekdayBorn: "",
      error: "invalid-birthdate",
    });
    expect(calculateAge("2023-13-01", "2025-01-01").error).toBe("invalid-birthdate");
  });
});
