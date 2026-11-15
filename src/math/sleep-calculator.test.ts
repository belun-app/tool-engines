import { describe, expect, it } from "vitest";
import { calculateSleep, formatClock, parseClock, splitDuration } from "./sleep-calculator.js";

describe("parseClock", () => {
  it("parses HH:MM, H:MM and HH:MM:SS", () => {
    expect(parseClock("07:30")).toBe(450);
    expect(parseClock("7:05")).toBe(425);
    expect(parseClock(" 23:59:30 ")).toBe(1439);
    expect(parseClock("00:00")).toBe(0);
  });

  it("rejects out-of-range and malformed times", () => {
    for (const v of ["24:00", "12:60", "", "7", "7:5", "abc", "07-30", "-1:00"]) {
      expect(parseClock(v)).toBeNull();
    }
  });
});

describe("formatClock", () => {
  it("wraps around the day in both directions", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(1440)).toBe("00:00");
    expect(formatClock(1500)).toBe("01:00");
    expect(formatClock(-15)).toBe("23:45");
    expect(formatClock(90.4)).toBe("01:30");
  });
});

describe("splitDuration", () => {
  it("splits minutes into hours and minutes, never negative", () => {
    expect(splitDuration(465)).toEqual({ hours: 7, minutes: 45 });
    expect(splitDuration(-30)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("calculateSleep", () => {
  it("bedtime mode: wake at 07:00 with 90-minute cycles and 15-minute buffer", () => {
    // 6 cycles: 540 + 15 = 555 min before 07:00 -> 21:45 previous day
    // 5 cycles: 450 + 15 = 465 -> 23:15 previous day
    // 4 cycles: 375 -> 00:45 same day ; 3 cycles: 285 -> 02:15
    const r = calculateSleep({ mode: "bedtime", time: "07:00" });
    expect(r.valid).toBe(true);
    expect(r.anchor).toBe("07:00");
    expect(r.options.map((o) => o.time)).toEqual(["21:45", "23:15", "00:45", "02:15"]);
    expect(r.options.map((o) => o.dayOffset)).toEqual([-1, -1, 0, 0]);
    expect(r.options.map((o) => o.cycles)).toEqual([6, 5, 4, 3]);
    expect(r.options.map((o) => o.recommended)).toEqual([true, true, false, false]);
    expect(r.options[0].sleepMinutes).toBe(540);
    expect(r.options[0].inBedMinutes).toBe(555);
    expect(r.options[0].timeMinutes).toBe(21 * 60 + 45);
  });

  it("wakeup mode: in bed at 23:00", () => {
    // 3 cycles: 23:00 + 285 = 03:45 (+1) ... 6 cycles: + 555 = 08:15 (+1)
    const r = calculateSleep({ mode: "wakeup", time: "23:00" });
    expect(r.options.map((o) => o.time)).toEqual(["03:45", "05:15", "06:45", "08:15"]);
    expect(r.options.every((o) => o.dayOffset === 1)).toBe(true);
  });

  it("wakeup mode on the same day", () => {
    const r = calculateSleep({ mode: "wakeup", time: "00:30", fallAsleepMinutes: 0 });
    expect(r.options[0].time).toBe("05:00"); // 0:30 + 270
    expect(r.options[0].dayOffset).toBe(0);
  });

  it("clamps cycle length, buffer and cycle counts", () => {
    const r = calculateSleep({
      mode: "wakeup",
      time: "22:00",
      cycleMinutes: 10,
      fallAsleepMinutes: 500,
      minCycles: 0,
      maxCycles: 50,
    });
    expect(r.cycleMinutes).toBe(60);
    expect(r.fallAsleepMinutes).toBe(180); // the buffer may be up to 3 h
    expect(r.options.map((o) => o.cycles)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const big = calculateSleep({ mode: "wakeup", time: "22:00", cycleMinutes: 999 });
    expect(big.cycleMinutes).toBe(120);
  });

  it("raises maxCycles to minCycles when they are crossed", () => {
    const r = calculateSleep({ mode: "wakeup", time: "22:00", minCycles: 5, maxCycles: 2 });
    expect(r.options.map((o) => o.cycles)).toEqual([5]);
  });

  it("returns the invalid result for a bad anchor time", () => {
    const r = calculateSleep({ mode: "bedtime", time: "25:00" });
    expect(r.valid).toBe(false);
    expect(r.options).toEqual([]);
    expect(r.anchor).toBe("");
    expect(calculateSleep({ mode: "bedtime", time: "" }).valid).toBe(false);
  });
});

describe("naps and input limits", () => {
  it("nap mode: 10 and 20 minutes and one full cycle after the fall-asleep buffer", () => {
    const r = calculateSleep({ mode: "nap", time: "13:00", fallAsleepMinutes: 5 });
    expect(r.valid).toBe(true);
    expect(r.options.map((o) => o.time)).toEqual(["13:15", "13:25", "14:35"]);
    expect(r.options.map((o) => o.cycles)).toEqual([0, 0, 1]);
    expect(r.options.map((o) => o.shortNap)).toEqual([true, true, false]);
    expect(r.options.map((o) => o.recommended)).toEqual([false, true, false]);
  });

  it("nap mode crosses midnight like the other modes", () => {
    const r = calculateSleep({
      mode: "nap",
      time: "23:50",
      cycleMinutes: 90,
      fallAsleepMinutes: 15,
    });
    expect(r.options[2]).toMatchObject({ time: "01:35", dayOffset: 1 });
  });

  it("flags a cycle length outside 60–120 instead of hiding the change", () => {
    const r = calculateSleep({ mode: "bedtime", time: "07:00", cycleMinutes: 20 });
    expect(r.cycleMinutes).toBe(60);
    expect(r.cycleClamped).toBe(true);
    expect(calculateSleep({ mode: "bedtime", time: "07:00", cycleMinutes: 100 }).cycleClamped).toBe(
      false,
    );
  });

  it("accepts a fall-asleep buffer up to 180 minutes", () => {
    const r = calculateSleep({ mode: "bedtime", time: "07:00", fallAsleepMinutes: 120 });
    expect(r.fallAsleepMinutes).toBe(120);
    expect(r.fallAsleepClamped).toBe(false);
    expect(r.options.find((o) => o.cycles === 6)?.inBedMinutes).toBe(540 + 120);
    expect(
      calculateSleep({ mode: "bedtime", time: "07:00", fallAsleepMinutes: 300 }),
    ).toMatchObject({ fallAsleepMinutes: 180, fallAsleepClamped: true });
  });

  it("falls back to the defaults for NaN instead of printing NaN:NaN", () => {
    const r = calculateSleep({ mode: "bedtime", time: "07:00", cycleMinutes: Number.NaN });
    expect(r.cycleMinutes).toBe(90);
    expect(r.options[0].time).toMatch(/^\d\d:\d\d$/);
  });
});
