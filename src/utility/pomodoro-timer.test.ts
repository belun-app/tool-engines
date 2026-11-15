import { describe, expect, it } from "vitest";
import {
  type PomodoroConfig,
  advancePhase,
  formatClock,
  normalizeConfig,
  phaseDurationSeconds,
} from "./pomodoro-timer.js";

const classic: PomodoroConfig = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsUntilLongBreak: 4,
};

describe("normalizeConfig", () => {
  it("keeps a valid config unchanged", () => {
    expect(normalizeConfig(classic)).toEqual(classic);
  });

  it("clamps minutes to 1..180 and sessions to 2..12, flooring fractions", () => {
    expect(
      normalizeConfig({
        workMinutes: 0,
        shortBreakMinutes: 500,
        longBreakMinutes: 14.9,
        sessionsUntilLongBreak: 1,
      }),
    ).toEqual({
      workMinutes: 1,
      shortBreakMinutes: 180,
      longBreakMinutes: 14,
      sessionsUntilLongBreak: 2,
    });
    expect(normalizeConfig({ ...classic, sessionsUntilLongBreak: 99 }).sessionsUntilLongBreak).toBe(
      12,
    );
  });

  it("maps non-finite values to the minimum", () => {
    expect(
      normalizeConfig({
        workMinutes: Number.NaN,
        shortBreakMinutes: Number.POSITIVE_INFINITY,
        longBreakMinutes: -5,
        sessionsUntilLongBreak: Number.NaN,
      }),
    ).toEqual({
      workMinutes: 1,
      shortBreakMinutes: 1,
      longBreakMinutes: 1,
      sessionsUntilLongBreak: 2,
    });
  });
});

describe("phaseDurationSeconds", () => {
  it("returns minutes * 60 per phase", () => {
    expect(phaseDurationSeconds("work", classic)).toBe(1500);
    expect(phaseDurationSeconds("shortBreak", classic)).toBe(300);
    expect(phaseDurationSeconds("longBreak", classic)).toBe(900);
    expect(phaseDurationSeconds("work", { ...classic, workMinutes: 1000 })).toBe(180 * 60);
  });
});

describe("advancePhase", () => {
  it("runs the classic 4-session cycle: work/short x3, then a long break", () => {
    let state = { phase: "work" as const, completedSessions: 0 } as {
      phase: "work" | "shortBreak" | "longBreak";
      completedSessions: number;
    };
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      state = advancePhase(state.phase, state.completedSessions, classic);
      seen.push(state.phase);
    }
    expect(seen).toEqual([
      "shortBreak",
      "work",
      "shortBreak",
      "work",
      "shortBreak",
      "work",
      "longBreak",
      "work",
    ]);
    expect(state.completedSessions).toBe(4);
  });

  it("does not count breaks as sessions", () => {
    expect(advancePhase("longBreak", 4, classic)).toEqual({ phase: "work", completedSessions: 4 });
    expect(advancePhase("shortBreak", 1, classic)).toEqual({ phase: "work", completedSessions: 1 });
  });

  it("sanitises the session count", () => {
    expect(advancePhase("work", -3, classic)).toEqual({
      phase: "shortBreak",
      completedSessions: 1,
    });
    expect(advancePhase("work", Number.NaN, classic).completedSessions).toBe(1);
    expect(advancePhase("work", 2.7, classic).completedSessions).toBe(3);
  });

  it("uses the normalised sessionsUntilLongBreak (min 2)", () => {
    // sessionsUntilLongBreak 1 clamps to 2, so the 2nd session earns a long break
    const cfg = { ...classic, sessionsUntilLongBreak: 1 };
    expect(advancePhase("work", 0, cfg).phase).toBe("shortBreak");
    expect(advancePhase("work", 1, cfg).phase).toBe("longBreak");
  });
});

describe("formatClock", () => {
  it("formats mm:ss with zero padding", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(59)).toBe("00:59");
    expect(formatClock(1500)).toBe("25:00");
    expect(formatClock(61)).toBe("01:01");
  });

  it("lets minutes grow past 59 (no hours segment)", () => {
    expect(formatClock(180 * 60)).toBe("180:00");
  });

  it("rounds fractional seconds and clamps invalid input to 00:00", () => {
    expect(formatClock(59.6)).toBe("01:00");
    expect(formatClock(-10)).toBe("00:00");
    expect(formatClock(Number.NaN)).toBe("00:00");
  });
});
