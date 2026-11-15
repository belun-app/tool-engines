import { describe, expect, it } from "vitest";
import {
  CLICK_TEST_DURATIONS,
  computeClickRhythm,
  computeClickSpeed,
  formatCps,
  isPersonalBest,
  peakClicksInWindow,
  rankClickSpeed,
} from "./click-speed-test.js";

describe("rankClickSpeed", () => {
  it("maps CPS onto tiers at the documented boundaries", () => {
    expect(rankClickSpeed(0)).toBe("slow");
    expect(rankClickSpeed(3.99)).toBe("slow");
    expect(rankClickSpeed(4)).toBe("average");
    expect(rankClickSpeed(6.49)).toBe("average");
    expect(rankClickSpeed(6.5)).toBe("fast");
    expect(rankClickSpeed(8)).toBe("very-fast");
    expect(rankClickSpeed(10)).toBe("insane");
    expect(rankClickSpeed(25)).toBe("insane");
  });

  it("treats negative and non-finite as slow", () => {
    expect(rankClickSpeed(-5)).toBe("slow");
    expect(rankClickSpeed(Number.NaN)).toBe("slow");
    expect(rankClickSpeed(Number.POSITIVE_INFINITY)).toBe("slow");
  });
});

describe("computeClickSpeed", () => {
  it("offers the classic durations", () => {
    expect([...CLICK_TEST_DURATIONS]).toEqual([1, 5, 10, 30, 60]);
  });

  it("computes CPS and clicks per minute", () => {
    // 37 clicks / 5 s = 7.4 CPS = 444 CPM
    expect(computeClickSpeed(37, 5)).toEqual({
      clicks: 37,
      durationSeconds: 5,
      cps: 7.4,
      clicksPerMinute: 444,
      rank: "fast",
    });
    // 100 / 30 = 3.333 -> 3.33 CPS; 200 CPM
    expect(computeClickSpeed(100, 30)).toMatchObject({
      cps: 3.33,
      clicksPerMinute: 200,
      rank: "slow",
    });
  });

  it("floors fractional click counts", () => {
    expect(computeClickSpeed(10.9, 1).clicks).toBe(10);
  });

  it("returns zeroes for invalid input", () => {
    for (const r of [
      computeClickSpeed(-1, 5),
      computeClickSpeed(10, 0),
      computeClickSpeed(10, -5),
      computeClickSpeed(Number.NaN, 5),
      computeClickSpeed(5, Number.POSITIVE_INFINITY),
    ]) {
      expect(r).toEqual({
        clicks: 0,
        durationSeconds: 0,
        cps: 0,
        clicksPerMinute: 0,
        rank: "slow",
      });
    }
    expect(computeClickSpeed(0, 5)).toMatchObject({ cps: 0, rank: "slow" });
  });
});

describe("peakClicksInWindow", () => {
  it("finds the busiest sliding one-second window", () => {
    // 0,100,...,900 fall within [0, 1000) -> 10; 1000 opens a new window that drops 0
    const stamps = Array.from({ length: 11 }, (_, i) => i * 100);
    expect(peakClicksInWindow(stamps)).toBe(10);
    // a burst later in the run
    expect(peakClicksInWindow([0, 2000, 2100, 2200, 2999, 3000])).toBe(4);
  });

  it("handles empty input and a non-positive window", () => {
    expect(peakClicksInWindow([])).toBe(0);
    expect(peakClicksInWindow([1, 2, 3], 0)).toBe(0);
    expect(peakClicksInWindow([5])).toBe(1);
  });
});

describe("computeClickRhythm", () => {
  it("returns zeroes for fewer than two clicks", () => {
    expect(computeClickRhythm([])).toEqual({
      peakCps: 0,
      averageIntervalMs: 0,
      fastestIntervalMs: 0,
      slowestIntervalMs: 0,
      consistency: 0,
    });
    expect(computeClickRhythm([100]).consistency).toBe(0);
  });

  it("scores a metronome 100", () => {
    const r = computeClickRhythm([0, 125, 250, 375, 500]);
    expect(r).toEqual({
      peakCps: 5,
      averageIntervalMs: 125,
      fastestIntervalMs: 125,
      slowestIntervalMs: 125,
      consistency: 100,
    });
  });

  it("derives consistency from the coefficient of variation", () => {
    // intervals 100, 300: mean 200, population sd 100 -> CV 50 % -> 50
    const r = computeClickRhythm([0, 100, 400]);
    expect(r.averageIntervalMs).toBe(200);
    expect(r.fastestIntervalMs).toBe(100);
    expect(r.slowestIntervalMs).toBe(300);
    expect(r.consistency).toBe(50);
    // intervals 10, 990: mean 500, sd 490 -> 2 (clamped at 0 would need CV > 100 %)
    expect(computeClickRhythm([0, 10, 1000]).consistency).toBe(2);
  });

  it("sorts unsorted stamps and drops non-finite ones", () => {
    const r = computeClickRhythm([400, Number.NaN, 0, 100]);
    expect(r.averageIntervalMs).toBe(200);
  });

  it("scores 0 when all clicks share one timestamp", () => {
    expect(computeClickRhythm([5, 5, 5]).consistency).toBe(0);
  });
});

describe("isPersonalBest / formatCps", () => {
  it("compares against the stored best", () => {
    expect(isPersonalBest(7, null)).toBe(true);
    expect(isPersonalBest(7, Number.NaN)).toBe(true);
    expect(isPersonalBest(7, 6.99)).toBe(true);
    expect(isPersonalBest(7, 7)).toBe(false);
    expect(isPersonalBest(0, null)).toBe(false);
    expect(isPersonalBest(Number.NaN, 1)).toBe(false);
  });

  it("formats with two decimals", () => {
    expect(formatCps(7)).toBe("7.00");
    expect(formatCps(6.456)).toBe("6.46");
    expect(formatCps(0)).toBe("0.00");
    expect(formatCps(-3)).toBe("0.00");
    expect(formatCps(Number.NaN)).toBe("0.00");
  });
});
