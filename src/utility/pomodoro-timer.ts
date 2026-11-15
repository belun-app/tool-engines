/**
 * Pomodoro timer state machine: phase lengths and the move from work to a short or long
 * break after a set number of sessions.
 */

export type PomodoroPhase = "work" | "shortBreak" | "longBreak";

export interface PomodoroConfig {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Number of work sessions completed before a long break is inserted */
  sessionsUntilLongBreak: number;
}

export interface PomodoroTransition {
  phase: PomodoroPhase;
  /** Total work sessions completed so far, including the one that just ended */
  completedSessions: number;
}

const MIN_MINUTES = 1;
const MAX_MINUTES = 180;
const MIN_SESSIONS = 2;
const MAX_SESSIONS = 12;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Clamp a raw config (e.g. from user inputs) to sane ranges. */
export function normalizeConfig(config: PomodoroConfig): PomodoroConfig {
  return {
    workMinutes: clamp(config.workMinutes, MIN_MINUTES, MAX_MINUTES),
    shortBreakMinutes: clamp(config.shortBreakMinutes, MIN_MINUTES, MAX_MINUTES),
    longBreakMinutes: clamp(config.longBreakMinutes, MIN_MINUTES, MAX_MINUTES),
    sessionsUntilLongBreak: clamp(config.sessionsUntilLongBreak, MIN_SESSIONS, MAX_SESSIONS),
  };
}

/** Duration of a given phase, in whole seconds. */
export function phaseDurationSeconds(phase: PomodoroPhase, config: PomodoroConfig): number {
  const normalized = normalizeConfig(config);
  const minutes =
    phase === "work"
      ? normalized.workMinutes
      : phase === "shortBreak"
        ? normalized.shortBreakMinutes
        : normalized.longBreakMinutes;
  return minutes * 60;
}

/**
 * Given the phase that just finished and how many work sessions were completed
 * before it, return the next phase and the updated session count. A finished
 * work phase increments the count and is followed by a long break every
 * `sessionsUntilLongBreak` sessions, otherwise a short break. A finished break
 * always returns to work.
 */
export function advancePhase(
  finishedPhase: PomodoroPhase,
  completedSessions: number,
  config: PomodoroConfig,
): PomodoroTransition {
  const normalized = normalizeConfig(config);
  const safeCompleted =
    Number.isFinite(completedSessions) && completedSessions > 0 ? Math.floor(completedSessions) : 0;

  if (finishedPhase !== "work") {
    return { phase: "work", completedSessions: safeCompleted };
  }

  const nextCompleted = safeCompleted + 1;
  const isLongBreakDue = nextCompleted % normalized.sessionsUntilLongBreak === 0;
  return { phase: isLongBreakDue ? "longBreak" : "shortBreak", completedSessions: nextCompleted };
}

/** Format a non-negative second count as an mm:ss clock string. */
export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
