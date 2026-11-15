import { describe, expect, it } from "vitest";
import {
  durationBetween,
  formatMinutesAsTime,
  parseDuration,
  parseTimeToMinutes,
  shiftTime,
  sumDurations,
} from "./time-duration-calculator.js";

describe("parseTimeToMinutes / formatMinutesAsTime", () => {
  it("parses valid times and rejects invalid ones", () => {
    expect(parseTimeToMinutes("09:00")).toBe(540);
    expect(parseTimeToMinutes(" 9:05 ")).toBe(545);
    expect(parseTimeToMinutes("23:59")).toBe(1439);
    for (const v of ["24:00", "10:60", "", "9", "9:5", "09:00:00", "ab:cd"]) {
      expect(parseTimeToMinutes(v)).toBeNull();
    }
  });

  it("formats and wraps minutes", () => {
    expect(formatMinutesAsTime(0)).toBe("00:00");
    expect(formatMinutesAsTime(1440 + 75)).toBe("01:15");
    expect(formatMinutesAsTime(-30)).toBe("23:30");
  });
});

describe("durationBetween", () => {
  it("computes 09:00 -> 17:30 as 8 h 30 min (the page's example)", () => {
    const r = durationBetween("09:00", "17:30");
    expect(r).toEqual({
      valid: true,
      totalMinutes: 510,
      hours: 8,
      minutes: 30,
      decimalHours: 8.5,
      crossesMidnight: false,
      breakDeducted: 0,
    });
  });

  it("handles overnight shifts", () => {
    // 22:00 -> 06:15 = 2 h + 6 h 15 = 495 min
    const r = durationBetween("22:00", "06:15");
    expect(r.totalMinutes).toBe(495);
    expect(r.crossesMidnight).toBe(true);
    expect(r.decimalHours).toBe(8.25);
  });

  it("treats equal start and end as zero", () => {
    expect(durationBetween("08:00", "08:00").totalMinutes).toBe(0);
  });

  it("deducts a break, never below zero, and ignores negative/NaN breaks", () => {
    expect(durationBetween("09:00", "17:30", 30).totalMinutes).toBe(480);
    const capped = durationBetween("09:00", "09:20", 45);
    expect(capped.totalMinutes).toBe(0);
    expect(capped.breakDeducted).toBe(20);
    expect(durationBetween("09:00", "10:00", -10).totalMinutes).toBe(60);
    expect(durationBetween("09:00", "10:00", Number.NaN).totalMinutes).toBe(60);
  });

  it("rounds decimal hours to 2 places", () => {
    // 20 min = 0.3333 h
    expect(durationBetween("09:00", "09:20").decimalHours).toBe(0.33);
  });

  it("returns the invalid result for bad times", () => {
    const r = durationBetween("", "17:00");
    expect(r.valid).toBe(false);
    expect(r.totalMinutes).toBe(0);
  });
});

describe("shiftTime", () => {
  it("adds and subtracts durations with a day offset", () => {
    expect(shiftTime("22:30", 3, 45, "add")).toEqual({ valid: true, time: "02:15", dayOffset: 1 });
    expect(shiftTime("01:00", 2, 30, "subtract")).toEqual({
      valid: true,
      time: "22:30",
      dayOffset: -1,
    });
    expect(shiftTime("10:00", 1, 0, "add")).toEqual({ valid: true, time: "11:00", dayOffset: 0 });
  });

  it("handles multi-day spans", () => {
    expect(shiftTime("00:00", 50, 0, "add")).toEqual({ valid: true, time: "02:00", dayOffset: 2 });
  });

  it("keeps the sign of the amount", () => {
    expect(shiftTime("10:00", -1, -30, "add").time).toBe("08:30");
  });

  it("accepts fractional hours", () => {
    expect(shiftTime("08:00", 1.5, 0, "add").time).toBe("09:30");
  });

  it("returns the invalid result for bad input", () => {
    expect(shiftTime("nope", 1, 0, "add")).toEqual({ valid: false, time: "", dayOffset: 0 });
    expect(shiftTime("10:00", Number.NaN, 0, "add").valid).toBe(false);
  });

  it("always renders a whole-minute HH:MM time", () => {
    expect(shiftTime("08:00", 0, 30.5, "add").time).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("breaks, signs and free-form durations", () => {
  it("rounds a fractional break to whole minutes", () => {
    const r = durationBetween("09:00", "17:30", 0.5);
    expect(`${r.hours}:${r.minutes}`).toBe("8:29");
    expect(Number.isInteger(r.totalMinutes)).toBe(true);
  });

  it("keeps the sign of the amount: adding −3 h is subtracting 3 h", () => {
    expect(shiftTime("09:00", -3, 0, "add").time).toBe("06:00");
    expect(shiftTime("09:00", -3, 0, "subtract").time).toBe("12:00");
    expect(shiftTime("01:00", -2, 0, "add")).toMatchObject({ time: "23:00", dayOffset: -1 });
  });
});

describe("parseDuration", () => {
  it("reads clock style, units and bare minutes", () => {
    expect(parseDuration("1:45")).toBe(105 * 60);
    expect(parseDuration("27:05")).toBe((27 * 60 + 5) * 60);
    expect(parseDuration("0:01:30")).toBe(90);
    expect(parseDuration("2ч 30м")).toBe(150 * 60);
    expect(parseDuration("2 ч 30 мин")).toBe(150 * 60);
    expect(parseDuration("1 h 15 min 20 s")).toBe(4520);
    expect(parseDuration("2,5 ч")).toBe(9000);
    expect(parseDuration("1.5h")).toBe(5400);
    expect(parseDuration("90 мин")).toBe(5400);
    expect(parseDuration("45")).toBe(2700);
  });

  it("refuses what it cannot read", () => {
    for (const bad of ["", "abc", "1:75", "2 лет", "1:2:3:4", "5 ч x"]) {
      expect(parseDuration(bad)).toBeNull();
    }
  });
});

describe("sumDurations", () => {
  it("carries 60 minutes into an hour: 2:45 + 1:30 = 4:15", () => {
    const r = sumDurations([
      { sign: 1, text: "2:45" },
      { sign: 1, text: "1:30" },
    ]);
    expect(r).toMatchObject({ valid: true, hours: 4, minutes: 15, seconds: 0, decimalHours: 4.25 });
    expect(r.totalMinutes).toBe(255);
  });

  it("goes past 24 hours and keeps seconds", () => {
    const r = sumDurations([
      { sign: 1, text: "20:00:30" },
      { sign: 1, text: "5:59:45" },
    ]);
    expect(r).toMatchObject({ hours: 26, minutes: 0, seconds: 15, hasSeconds: true });
  });

  it("subtracts and can go negative", () => {
    const r = sumDurations([
      { sign: 1, text: "1:00" },
      { sign: -1, text: "1:30" },
    ]);
    expect(r).toMatchObject({ negative: true, hours: 0, minutes: 30, decimalHours: -0.5 });
  });

  it("skips empty rows and reports unreadable ones", () => {
    const r = sumDurations([
      { sign: 1, text: "1:00" },
      { sign: 1, text: "" },
      { sign: 1, text: "много" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.invalid).toEqual([2]);
    expect(r.counted).toBe(1);
    expect(sumDurations([{ sign: 1, text: " " }]).valid).toBe(false);
  });
});
