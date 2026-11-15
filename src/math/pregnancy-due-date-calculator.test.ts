import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateDueDate } from "./pregnancy-due-date-calculator.js";

describe("calculateDueDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds 280 days to the LMP", () => {
    // 2024-01-01 + 280 days (leap year) = 2024-10-07
    const r = calculateDueDate({ method: "lmp", date: "2024-01-01", today: "2024-03-01" });
    expect(r.valid).toBe(true);
    expect(r.dueDate).toBe("2024-10-07");
    expect(r.lmpDate).toBe("2024-01-01");
    expect(r.conceptionDate).toBe("2024-01-15");
    // 2024-01-01 -> 2024-03-01 = 60 days = 8 w 4 d
    expect(r.totalDays).toBe(60);
    expect(r.weeks).toBe(8);
    expect(r.days).toBe(4);
    expect(r.trimester).toBe(1);
    expect(r.daysRemaining).toBe(220);
    expect(r.weeksRemaining).toBe(31);
    expect(r.progressPercent).toBe(21); // 60 / 280
    expect(r.overdue).toBe(false);
    expect(r.dueWeekday).toBe(1); // 2024-10-07 is a Monday
    expect(r.fullTermDate).toBe("2024-09-16"); // + 259
    expect(r.viabilityDate).toBe("2024-06-17"); // + 168
  });

  it("corrects the LMP for a long cycle", () => {
    // 35-day cycle shifts by 7 days
    const r = calculateDueDate({
      method: "lmp",
      date: "2024-01-01",
      cycleLength: 35,
      today: "2024-01-01",
    });
    expect(r.dueDate).toBe("2024-10-14");
    // cycle clamped to 20–45
    const c = calculateDueDate({
      method: "lmp",
      date: "2024-01-01",
      cycleLength: 99,
      today: "2024-01-01",
    });
    expect(c.lmpDate).toBe("2024-01-18");
  });

  it("dates conception and IVF transfers back to a notional LMP", () => {
    expect(
      calculateDueDate({ method: "conception", date: "2024-01-15", today: "2024-01-15" }).dueDate,
    ).toBe("2024-10-07");
    expect(
      calculateDueDate({ method: "ivf-day3", date: "2024-01-18", today: "2024-01-18" }).lmpDate,
    ).toBe("2024-01-01");
    expect(
      calculateDueDate({ method: "ivf-day5", date: "2024-01-20", today: "2024-01-20" }).lmpDate,
    ).toBe("2024-01-01");
  });

  it("dates from an ultrasound gestational age", () => {
    // scan 2024-03-01 at 8w4d = 60 days -> LMP 2024-01-01
    const r = calculateDueDate({
      method: "ultrasound",
      date: "2024-03-01",
      scanWeeks: 8,
      scanDays: 4,
      today: "2024-03-01",
    });
    expect(r.lmpDate).toBe("2024-01-01");
    expect(r.dueDate).toBe("2024-10-07");
    expect(
      calculateDueDate({ method: "ultrasound", date: "2024-03-01", scanWeeks: 0, scanDays: 0 })
        .valid,
    ).toBe(false);
  });

  it("switches trimesters at weeks 14 and 28", () => {
    const tri = (today: string) =>
      calculateDueDate({ method: "lmp", date: "2024-01-01", today }).trimester;
    expect(tri("2024-04-07")).toBe(1); // day 97 = 13w6d
    expect(tri("2024-04-08")).toBe(2); // day 98 = 14w0d
    expect(tri("2024-07-14")).toBe(2); // day 195 = 27w6d
    expect(tri("2024-07-15")).toBe(3); // day 196 = 28w0d
  });

  it("marks the current trimester range and past milestones", () => {
    const r = calculateDueDate({ method: "lmp", date: "2024-01-01", today: "2024-05-20" });
    expect(r.trimesters.map((t) => t.current)).toEqual([false, true, false]);
    expect(r.trimesters[0]).toMatchObject({ start: "2024-01-01", end: "2024-04-07" });
    expect(r.trimesters[2].end).toBe("2024-10-07");
    const anatomy = r.milestones.find((m) => m.key === "anatomy-scan");
    expect(anatomy).toMatchObject({ week: 20, date: "2024-05-20", past: true });
    expect(r.milestones.find((m) => m.key === "viability")?.past).toBe(false);
  });

  it("reports overdue days after the due date", () => {
    const r = calculateDueDate({ method: "lmp", date: "2024-01-01", today: "2024-10-10" });
    expect(r.overdue).toBe(true);
    expect(r.daysOverdue).toBe(3);
    expect(r.daysRemaining).toBe(0);
    expect(r.progressPercent).toBe(100);
  });

  it("reports trimester 0 for an LMP in the future", () => {
    const r = calculateDueDate({ method: "lmp", date: "2024-06-01", today: "2024-05-01" });
    expect(r.trimester).toBe(0);
    expect(r.totalDays).toBe(0);
    expect(r.trimesters.every((t) => !t.current)).toBe(true);
  });

  it("defaults today to the system date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 2, 1, 15, 0, 0));
    expect(calculateDueDate({ method: "lmp", date: "2024-01-01" }).totalDays).toBe(60);
  });

  it("returns the invalid result for a bad date", () => {
    for (const d of ["", "2023-02-29", "2024-1-1"]) {
      expect(calculateDueDate({ method: "lmp", date: d }).valid).toBe(false);
    }
  });
});
