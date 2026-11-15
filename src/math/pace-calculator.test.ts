import { describe, expect, it } from "vitest";
import { calculatePace, formatPace, formatTime } from "./pace-calculator.js";

describe("calculatePace", () => {
  it("solves pace for a 10 km run in 50:00", () => {
    // 3000 s / 10 km = 300 s/km ; 10 km = 6.2137 mi -> 482.80 s/mi ; 12 km/h
    const r = calculatePace({
      solveFor: "pace",
      unit: "km",
      distance: 10,
      timeSeconds: 3000,
      paceSeconds: 0,
    });
    expect(r.valid).toBe(true);
    expect(r.paceSecondsPerKm).toBe(300);
    expect(r.paceSecondsPerMi).toBeCloseTo(482.8032, 4);
    expect(r.speedKmh).toBeCloseTo(12, 10);
    expect(r.speedMph).toBeCloseTo(7.4565, 4);
    expect(r.distanceMi).toBeCloseTo(6.21371, 5);
    expect(r.splits).toHaveLength(10);
    expect(r.splits[4]).toEqual({ distance: 5, cumulativeSeconds: 1500 });
  });

  it("solves time from distance and pace in miles", () => {
    // 26.2 mi at 8:00/mi = 12576 s
    const r = calculatePace({
      solveFor: "time",
      unit: "mi",
      distance: 26.2,
      timeSeconds: 0,
      paceSeconds: 480,
    });
    expect(r.totalSeconds).toBeCloseTo(12_576, 6);
    expect(r.distanceKm).toBeCloseTo(26.2 * 1.609344, 10);
    // splits: 1..26 then 26.2
    expect(r.splits).toHaveLength(27);
    expect(r.splits[26].distance).toBe(26.2);
  });

  it("solves distance from time and pace", () => {
    const r = calculatePace({
      solveFor: "distance",
      unit: "km",
      distance: 0,
      timeSeconds: 1800,
      paceSeconds: 360,
    });
    expect(r.distance).toBe(5);
  });

  it("thins splits on very long distances to at most ~30 rows plus the finish", () => {
    // 42.195 km -> step 2: 2, 4, ... 42, then 42.195
    const r = calculatePace({
      solveFor: "time",
      unit: "km",
      distance: 42.195,
      timeSeconds: 0,
      paceSeconds: 300,
    });
    expect(r.splits).toHaveLength(22);
    expect(r.splits[0].distance).toBe(2);
    expect(r.splits[21].distance).toBe(42.195);
  });

  it("gives a single split for sub-unit distances", () => {
    const r = calculatePace({
      solveFor: "pace",
      unit: "km",
      distance: 0.4,
      timeSeconds: 80,
      paceSeconds: 0,
    });
    expect(r.splits).toEqual([{ distance: 0.4, cumulativeSeconds: 80 }]);
  });

  it("returns the invalid result when the needed inputs are zero, negative or NaN", () => {
    const bad = [
      { solveFor: "pace", distance: 0, timeSeconds: 100, paceSeconds: 0 },
      { solveFor: "pace", distance: 5, timeSeconds: -1, paceSeconds: 0 },
      { solveFor: "time", distance: 5, timeSeconds: 0, paceSeconds: 0 },
      { solveFor: "distance", distance: 0, timeSeconds: 0, paceSeconds: 300 },
      { solveFor: "pace", distance: Number.NaN, timeSeconds: 100, paceSeconds: 0 },
    ] as const;
    for (const b of bad) {
      const r = calculatePace({ ...b, unit: "km" });
      expect(r.valid).toBe(false);
      expect(r.splits).toEqual([]);
    }
  });
});

describe("formatTime / formatPace", () => {
  it("formats durations with and without hours", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3599.6)).toBe("1:00:00");
    expect(formatTime(12_600)).toBe("3:30:00");
  });

  it("formats paces as m:ss", () => {
    expect(formatPace(300)).toBe("5:00");
    expect(formatPace(298.61)).toBe("4:59"); // marathon in 3:30 per km
    expect(formatPace(59.6)).toBe("1:00");
  });
});
