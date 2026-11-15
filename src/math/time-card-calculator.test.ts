import { describe, expect, it } from "vitest";
import {
  type TimeCardDay,
  type TimeCardOptions,
  calculateTimeCard,
  formatDuration,
  formatPunch,
  parsePunch,
  roundPunch,
} from "./time-card-calculator.js";

const opts: TimeCardOptions = {
  payRate: 0,
  overtimeMultiplier: 1.5,
  dailyOvertimeAfter: 0,
  weeklyOvertimeAfter: 0,
  roundTo: 0,
};

const day = (
  in1: string,
  out1: string,
  breakMinutes: string | number = 0,
  in2 = "",
  out2 = "",
): TimeCardDay => ({
  in1,
  out1,
  in2,
  out2,
  breakMinutes,
});

describe("parsePunch", () => {
  it("reads 24-hour and 12-hour forms", () => {
    expect(parsePunch("09:30")).toBe(570);
    expect(parsePunch("9")).toBe(540);
    expect(parsePunch("9:30 am")).toBe(570);
    expect(parsePunch("5pm")).toBe(1020);
    expect(parsePunch("12.45 PM")).toBe(765);
    expect(parsePunch("12 am")).toBe(0);
    expect(parsePunch("12pm")).toBe(720);
    expect(parsePunch("0930")).toBe(570);
    expect(parsePunch("24:00")).toBe(1440);
  });

  it("rejects impossible times", () => {
    for (const v of ["", "25:00", "13pm", "0am", "9:60", "24:30", "abc"]) {
      expect(parsePunch(v)).toBeNull();
    }
  });
});

describe("formatting and rounding", () => {
  it("formats punches and durations", () => {
    expect(formatPunch(570)).toBe("09:30");
    expect(formatPunch(1440 + 15)).toBe("00:15");
    expect(formatDuration(495)).toBe("8:15");
    expect(formatDuration(-30)).toBe("-0:30");
  });

  it("applies the seven-minute rule for quarter-hour rounding", () => {
    expect(roundPunch(487, 15)).toBe(480); // 8:07 -> 8:00
    expect(roundPunch(488, 15)).toBe(495); // 8:08 -> 8:15
    expect(roundPunch(487, 1)).toBe(487);
    expect(roundPunch(487, 0)).toBe(487);
  });
});

describe("calculateTimeCard", () => {
  it("sums a simple day minus the unpaid break", () => {
    // 09:00 -> 17:30 = 510 min - 30 = 480
    const r = calculateTimeCard([day("09:00", "17:30", 30)], opts);
    expect(r.days[0]).toMatchObject({
      workedMinutes: 510,
      breakMinutes: 30,
      totalMinutes: 480,
      decimalHours: 8,
      clock: "8:00",
    });
    expect(r.totalMinutes).toBe(480);
    expect(r.daysWorked).toBe(1);
  });

  it("adds a second punch pair and handles a night shift", () => {
    const split = calculateTimeCard([day("08:00", "12:00", 0, "13:00", "17:15")], opts);
    expect(split.days[0].totalMinutes).toBe(495);
    const night = calculateTimeCard([day("22:00", "06:00")], opts);
    expect(night.days[0].totalMinutes).toBe(480);
    expect(night.days[0].crossesMidnight).toBe(true);
    expect(night.anyCrossesMidnight).toBe(true);
  });

  it("never deducts more break than was worked", () => {
    const r = calculateTimeCard([day("09:00", "09:20", 60)], opts);
    expect(r.days[0].breakMinutes).toBe(20);
    expect(r.days[0].totalMinutes).toBe(0);
  });

  it("splits daily and weekly overtime without double counting", () => {
    // 5 days x 10 h with OT after 8 h/day and 40 h/week:
    // daily OT 5 x 2 h = 10 h ; regular 40 h -> weekly OT 0 ; pay 40*20 + 10*30 = 1100
    const week = Array.from({ length: 5 }, () => day("08:00", "18:00"));
    const r = calculateTimeCard(week, {
      ...opts,
      payRate: 20,
      dailyOvertimeAfter: 8,
      weeklyOvertimeAfter: 40,
    });
    expect(r.totalMinutes).toBe(3000);
    expect(r.overtimeMinutes).toBe(600);
    expect(r.weeklyOvertimeMinutes).toBe(0);
    expect(r.regularMinutes).toBe(2400);
    expect(r.regularPay).toBe(800);
    expect(r.overtimePay).toBe(300);
    expect(r.totalPay).toBe(1100);
    expect(r.effectiveRate).toBe(22); // 1100 / 50 h
    expect(r.totalClock).toBe("50:00");
    expect(r.averageDailyMinutes).toBe(600);
    expect(r.longestDayMinutes).toBe(600);
  });

  it("applies weekly overtime alone", () => {
    // 6 x 8 h = 48 h, weekly threshold 40 -> 8 h OT
    const week = Array.from({ length: 6 }, () => day("09:00", "17:00"));
    const r = calculateTimeCard(week, { ...opts, payRate: "10", weeklyOvertimeAfter: "40" });
    expect(r.weeklyOvertimeMinutes).toBe(480);
    expect(r.totalPay).toBe(520); // 40*10 + 8*15
  });

  it("rounds punches before summing", () => {
    // 08:07 -> 08:00, 16:53 -> 17:00 => 9 h
    const r = calculateTimeCard([day("08:07", "16:53")], { ...opts, roundTo: 15 });
    expect(r.days[0].totalMinutes).toBe(540);
  });

  it("marks half-filled or unparseable days invalid and ignores blank ones", () => {
    const r = calculateTimeCard(
      [day("09:00", ""), day("xx", "17:00"), day("", "", 30), day("09:00", "10:00")],
      opts,
    );
    expect(r.days.map((d) => d.invalid)).toEqual([true, true, false, false]);
    expect(r.days[2].used).toBe(false);
    expect(r.hasInvalid).toBe(true);
    expect(r.totalMinutes).toBe(60);
    expect(r.daysWorked).toBe(1);
  });

  it("accepts a decimal-comma pay rate and returns zeros for an empty card", () => {
    const r = calculateTimeCard([day("09:00", "10:00")], { ...opts, payRate: "12,5" });
    expect(r.totalPay).toBe(12.5);
    const empty = calculateTimeCard([], opts);
    expect(empty).toMatchObject({ totalMinutes: 0, totalPay: 0, effectiveRate: 0, daysWorked: 0 });
  });
});
