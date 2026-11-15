import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateOvulation } from "./ovulation-calculator.js";

describe("calculateOvulation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("places ovulation at cycleLength - lutealPhase for a 28-day cycle", () => {
    // LMP 2024-03-01 + 14 = 2024-03-15 ; next period 2024-03-29
    const r = calculateOvulation({ lastPeriod: "2024-03-01", today: "2024-03-05", cycles: 3 });
    expect(r.valid).toBe(true);
    const c = r.cycles[0];
    expect(c.ovulationDate).toBe("2024-03-15");
    expect(c.periodEnd).toBe("2024-03-05"); // 5-day period
    expect(c.fertileStart).toBe("2024-03-10"); // ovulation - 5
    expect(c.peakStart).toBe("2024-03-13");
    expect(c.nextPeriod).toBe("2024-03-29");
    expect(c.implantationStart).toBe("2024-03-21");
    expect(c.implantationEnd).toBe("2024-03-27");
    expect(c.testDate).toBe("2024-03-29");
    // 2024-03-15 + 266 days = 2024-12-06
    expect(c.dueDate).toBe("2024-12-06");
    expect(r.cycles.map((x) => x.periodStart)).toEqual(["2024-03-01", "2024-03-29", "2024-04-26"]);
  });

  it("moves ovulation later on a long cycle", () => {
    // 35-day cycle: day 21 -> 2024-03-22
    const r = calculateOvulation({
      lastPeriod: "2024-03-01",
      cycleLength: 35,
      today: "2024-03-01",
    });
    expect(r.cycles[0].ovulationDate).toBe("2024-03-22");
  });

  it("reports the current phase and countdowns", () => {
    const at = (today: string) =>
      calculateOvulation({ lastPeriod: "2024-03-01", today, cycles: 2 });
    expect(at("2024-03-03").phase).toBe("menstrual");
    expect(at("2024-03-03").cycleDay).toBe(3);
    expect(at("2024-03-07").phase).toBe("follicular");
    expect(at("2024-03-12").phase).toBe("fertile");
    expect(at("2024-03-12").inFertileWindow).toBe(true);
    const ov = at("2024-03-15");
    expect(ov.phase).toBe("ovulation");
    expect(ov.ovulationToday).toBe(true);
    expect(ov.daysToOvulation).toBe(0);
    expect(at("2024-03-20").phase).toBe("luteal");
    const early = at("2024-03-05");
    expect(early.daysToOvulation).toBe(10);
    expect(early.daysToFertileStart).toBe(5);
    expect(early.daysToNextPeriod).toBe(24);
  });

  it("rolls to the next cycle after this one's ovulation", () => {
    const r = calculateOvulation({ lastPeriod: "2024-03-01", today: "2024-03-20", cycles: 3 });
    expect(r.nextOvulation).toBe("2024-04-12");
    expect(r.cycles[0].past).toBe(true);
    expect(r.cycleDay).toBe(20);
  });

  it("gives cycle day 0 and phase unknown before the period date", () => {
    const r = calculateOvulation({ lastPeriod: "2024-03-01", today: "2024-02-20" });
    expect(r.cycleDay).toBe(0);
    expect(r.phase).toBe("unknown");
  });

  it("clamps the inputs", () => {
    const r = calculateOvulation({
      lastPeriod: "2024-03-01",
      cycleLength: 100,
      lutealPhase: 1,
      periodLength: 50,
      cycles: 99,
      today: "2024-03-01",
    });
    expect(r.cycleLength).toBe(45);
    expect(r.lutealPhase).toBe(9);
    expect(r.cycles).toHaveLength(12);
  });

  it("keeps ovulation after the period on a short cycle with a long luteal phase", () => {
    // 20-day cycle, 17-day luteal -> offset max(5, 3) = 5
    const r = calculateOvulation({
      lastPeriod: "2024-03-01",
      cycleLength: 20,
      lutealPhase: 17,
      today: "2024-03-01",
    });
    expect(r.cycles[0].ovulationDate).toBe("2024-03-06");
  });

  it("defaults today to the system date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 2, 5, 9, 0, 0));
    expect(calculateOvulation({ lastPeriod: "2024-03-01" }).cycleDay).toBe(5);
  });

  it("returns the invalid result for a bad date", () => {
    for (const d of ["", "2024-02-30", "01.03.2024"]) {
      const r = calculateOvulation({ lastPeriod: d });
      expect(r.valid).toBe(false);
      expect(r.cycles).toEqual([]);
    }
  });

  it("ends the six-day fertile window on ovulation day", () => {
    const c = calculateOvulation({ lastPeriod: "2024-03-01", today: "2024-03-01" }).cycles[0];
    expect(c.fertileEnd).toBe(c.ovulationDate);
  });

  it("never reports a next ovulation before today", () => {
    const r = calculateOvulation({ lastPeriod: "2024-01-01", cycles: 1, today: "2024-03-20" });
    expect(r.nextOvulation >= "2024-03-20").toBe(true);
    expect(r.nextPeriod >= "2024-03-20").toBe(true);
  });
});
