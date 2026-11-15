import { describe, expect, it } from "vitest";
import { MAX_MONTHS, calculateRunway } from "./burn-rate-calculator.js";

describe("calculateRunway", () => {
  it("runs out exactly after cash / burn months with flat numbers", () => {
    // 100 000 / 10 000 = 10 months
    const r = calculateRunway(100_000, 0, 10_000);
    expect(r.runwayMonths).toBe(10);
    expect(r.outOfCash).toBe(true);
    expect(r.grossBurn).toBe(10_000);
    expect(r.netBurn).toBe(10_000);
    expect(r.breakEvenMonth).toBeNull();
    expect(r.defaultAlive).toBe(false);
    expect(r.months).toBe(10);
    expect(r.schedule[9]).toEqual({
      month: 10,
      revenue: 0,
      spend: 10_000,
      netBurn: 10_000,
      cash: 0,
    });
  });

  it("interpolates the runway inside the last month", () => {
    // 25 000 at net 10 000/month: 2 full months then half of the third
    const r = calculateRunway(25_000, 2_000, 12_000);
    expect(r.netBurn).toBe(10_000);
    expect(r.runwayMonths).toBe(2.5);
    expect(r.schedule).toHaveLength(3);
    expect(r.schedule[2].cash).toBe(0);
  });

  it("reports zero runway with no cash", () => {
    expect(calculateRunway(0, 0, 5_000).runwayMonths).toBe(0);
  });

  it("is default alive when revenue already covers spend", () => {
    const r = calculateRunway(10_000, 10_000, 5_000);
    expect(r.runwayMonths).toBe(Number.POSITIVE_INFINITY);
    expect(r.outOfCash).toBe(false);
    expect(r.breakEvenMonth).toBe(1);
    expect(r.defaultAlive).toBe(true);
    expect(r.months).toBe(MAX_MONTHS);
    expect(r.netBurn).toBe(-5_000);
  });

  it("finds the break-even month from compounding growth", () => {
    // revenue 1 000 doubling monthly vs flat spend 5 000: month 4 revenue = 8 000 >= 5 000
    // burn: m1 4000, m2 3000, m3 1000 -> needs 8 000 to survive
    const r = calculateRunway(100_000, 1_000, 5_000, 100, 0);
    expect(r.breakEvenMonth).toBe(4);
    expect(r.defaultAlive).toBe(true);
    expect(r.schedule[1].revenue).toBe(2_000);
    expect(r.schedule[3].netBurn).toBe(-3_000);
  });

  it("runs out before break-even when cash is too short", () => {
    const r = calculateRunway(5_000, 1_000, 5_000, 100, 0);
    // m1 burns 4 000 (1 000 left), m2 burns 3 000 -> runs out 1/3 into month 2
    expect(r.outOfCash).toBe(true);
    expect(r.runwayMonths).toBe(1.3);
    expect(r.breakEvenMonth).toBeNull();
    expect(r.defaultAlive).toBe(false);
  });

  it("grows spend by its own rate", () => {
    const r = calculateRunway(1_000_000, 0, 10_000, 0, 10);
    expect(r.schedule[1].spend).toBe(11_000);
    expect(r.schedule[2].spend).toBe(12_100);
  });

  it("returns the empty result for invalid input", () => {
    const bad: Array<[number, number, number, number?, number?]> = [
      [-1, 0, 100],
      [100, -1, 100],
      [100, 0, -1],
      [100, 0, 0],
      [100, 0, 100, -100],
      [100, 0, 100, 0, -150],
      [Number.NaN, 0, 100],
      [100, 0, Number.POSITIVE_INFINITY],
    ];
    for (const args of bad) {
      const r = calculateRunway(...args);
      expect(r.months).toBe(0);
      expect(r.schedule).toEqual([]);
    }
  });
});
