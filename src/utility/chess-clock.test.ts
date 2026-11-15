import { describe, expect, it } from "vitest";
import {
  type ClockState,
  LIMITS,
  PRESETS,
  type Side,
  adjust,
  canUndo,
  createClock,
  delayLeftFor,
  fideCategory,
  formatClock,
  formatDuration,
  formatTimeControl,
  lowTimeThreshold,
  msUntilFlag,
  parseSavedClock,
  parseTimeControl,
  pause,
  presetReference,
  press,
  pressActive,
  readClock,
  remainingFor,
  reset,
  restoreClock,
  resume,
  serializeClock,
  settle,
  simpleControl,
  swapColours,
  timeForMoves,
  togglePause,
  undo,
  validateControl,
} from "./chess-clock.js";

const MIN = 60_000;

/** Build a clock from notation; fails the test if the notation is rejected. */
function clock(tc: string): ClockState {
  const control = parseTimeControl(tc);
  if (!control) throw new Error(`rejected: ${tc}`);
  return createClock(control);
}

/** Black (right side) presses at t = 0, so White's (left) clock starts. */
function started(tc: string): ClockState {
  return press(clock(tc), 1, 0);
}

/**
 * Play `count` full moves where every turn takes `stepMs`, starting from a
 * state where side 0 runs and its turn began at `t0`. Returns the state and
 * the time of the last press.
 */
function playMoves(state: ClockState, count: number, stepMs: number, t0 = 0) {
  let s = state;
  let t = t0;
  for (let i = 0; i < count; i++) {
    t += stepMs;
    s = press(s, 0, t);
    t += stepMs;
    s = press(s, 1, t);
  }
  return { s, t };
}

describe("formatClock", () => {
  it("rounds whole seconds up so a fresh clock shows its full time", () => {
    expect(formatClock(300_000)).toBe("5:00");
    expect(formatClock(299_999)).toBe("5:00");
    expect(formatClock(299_000)).toBe("4:59");
    expect(formatClock(11_001)).toBe("0:12");
    expect(formatClock(11_000)).toBe("0:11");
  });

  it("starts tenths one second early, so 0:11 is followed by 10.9", () => {
    expect(formatClock(10_999)).toBe("10.9");
    expect(formatClock(10_001)).toBe("10.0");
    expect(formatClock(10_000)).toBe("10.0");
  });

  it("switches to tenths (rounded down) below the threshold", () => {
    expect(formatClock(9_999)).toBe("9.9");
    expect(formatClock(9_900)).toBe("9.9");
    expect(formatClock(9_899)).toBe("9.8");
    expect(formatClock(300)).toBe("0.3");
    expect(formatClock(99)).toBe("0.0");
    expect(formatClock(0)).toBe("0.0");
  });

  it("honours the adjustable threshold", () => {
    expect(formatClock(15_000, 20_000)).toBe("15.0");
    expect(formatClock(15_000, 10_000)).toBe("0:15");
    expect(formatClock(59_999, 60_000)).toBe("59.9");
    expect(formatClock(60_500, 60_000)).toBe("1:00.5");
    expect(formatClock(61_000, 60_000)).toBe("1:01");
    expect(formatClock(61_500, 120_000)).toBe("1:01.5");
  });

  it("never shows tenths with threshold 0, and 0:00 only at zero", () => {
    expect(formatClock(1, 0)).toBe("0:01");
    expect(formatClock(0, 0)).toBe("0:00");
    expect(formatClock(-500, 0)).toBe("0:00");
    expect(formatClock(Number.NaN, 0)).toBe("0:00");
  });

  it("adds hours when needed", () => {
    expect(formatClock(3_600_000)).toBe("1:00:00");
    expect(formatClock(5_400_000)).toBe("1:30:00");
    expect(formatClock(3_599_001)).toBe("1:00:00");
    expect(formatClock(3_599_000)).toBe("59:59");
  });
});

describe("parseTimeControl / formatTimeControl", () => {
  it("reads a Fischer control", () => {
    const c = parseTimeControl("5+3");
    expect(c?.players[0].periods).toEqual([
      { afterMoves: 0, timeMs: 300_000, bonusMs: 3000, mode: "fischer" },
    ]);
    expect(c?.players[1].periods).toEqual(c?.players[0].periods);
  });

  it("reads the URL-decoded form where + became a space", () => {
    expect(parseTimeControl("5 3")).toEqual(parseTimeControl("5+3"));
  });

  it("accepts a space before d or b, as printed on US clocks", () => {
    expect(parseTimeControl("G/5 d2")).toEqual(parseTimeControl("G5d2"));
    expect(parseTimeControl("G/5+d2")).toEqual(parseTimeControl("G5d2"));
    expect(parseTimeControl("3 b2")).toEqual(parseTimeControl("3b2"));
    expect(parseTimeControl("90/40 d5,30 d5")?.players[0].periods.map((p) => p.mode)).toEqual([
      "delay",
      "delay",
    ]);
    expect(parseTimeControl("5 d")).toBeNull();
  });

  it("reads simple delay and Bronstein", () => {
    expect(parseTimeControl("G5d2")?.players[0].periods[0]).toEqual({
      afterMoves: 0,
      timeMs: 300_000,
      bonusMs: 2000,
      mode: "delay",
    });
    expect(parseTimeControl("g/5D2")).toEqual(parseTimeControl("G5d2"));
    expect(parseTimeControl("3b2")?.players[0].periods[0]).toEqual({
      afterMoves: 0,
      timeMs: 180_000,
      bonusMs: 2000,
      mode: "bronstein",
    });
  });

  it("treats +0 and a bare number as sudden death", () => {
    const none = { afterMoves: 0, timeMs: 180_000, bonusMs: 0, mode: "none" };
    expect(parseTimeControl("3+0")?.players[0].periods[0]).toEqual(none);
    expect(parseTimeControl("3")?.players[0].periods[0]).toEqual(none);
    expect(parseTimeControl("3d0")?.players[0].periods[0]).toEqual(none);
  });

  it("reads seconds and hours", () => {
    expect(parseTimeControl("1:30+2")?.players[0].periods[0]?.timeMs).toBe(90_000);
    expect(parseTimeControl("1:00:00")?.players[0].periods[0]?.timeMs).toBe(3_600_000);
    expect(parseTimeControl("0.5+1")?.players[0].periods[0]?.timeMs).toBe(30_000);
  });

  it("reads the FIDE classical control as two periods", () => {
    expect(parseTimeControl("90/40+30,30+30")?.players[0].periods).toEqual([
      { afterMoves: 0, timeMs: 5_400_000, bonusMs: 30_000, mode: "fischer" },
      { afterMoves: 40, timeMs: 1_800_000, bonusMs: 30_000, mode: "fischer" },
    ]);
  });

  it("turns per-period move counts into cumulative ones", () => {
    expect(
      parseTimeControl("120/40,60/20,15+30")?.players[0].periods.map((p) => p.afterMoves),
    ).toEqual([0, 40, 60]);
  });

  it("reads time odds", () => {
    const c = parseTimeControl("5+0~3+0");
    expect(c?.players[0].periods[0]?.timeMs).toBe(300_000);
    expect(c?.players[1].periods[0]?.timeMs).toBe(180_000);
  });

  it("rejects malformed and out-of-range input", () => {
    for (const bad of [
      "",
      "abc",
      "5+",
      "+3",
      "0+0",
      "0+5",
      "0b5",
      "601+0",
      "600:01",
      "5+301",
      "5:60",
      "1:60:00",
      "90+30,30+30",
      "1/1,1/1,1/1,1",
      "5+3~",
      "5~5~5",
      "5+3;alert(1)",
    ]) {
      expect(parseTimeControl(bad), bad).toBeNull();
    }
  });

  it("accepts the boundaries", () => {
    expect(parseTimeControl("600+300")).not.toBeNull();
    expect(parseTimeControl("G0d5")?.players[0].periods[0]).toEqual({
      afterMoves: 0,
      timeMs: 0,
      bonusMs: 5000,
      mode: "delay",
    });
  });

  it("round-trips every preset", () => {
    for (const p of PRESETS) {
      const c = parseTimeControl(p.tc);
      expect(c, p.tc).not.toBeNull();
      expect(formatTimeControl(c as NonNullable<typeof c>)).toBe(p.tc);
    }
  });

  it("formats odds, seconds, Bronstein and stages", () => {
    expect(formatTimeControl(parseTimeControl("5~3") as never)).toBe("5+0~3+0");
    expect(formatTimeControl(simpleControl(90_000, 2000, "fischer"))).toBe("1:30+2");
    expect(formatTimeControl(simpleControl(180_000, 2000, "bronstein"))).toBe("3b2");
    expect(formatTimeControl(parseTimeControl("120/40,60/20,15+30") as never)).toBe(
      "120/40+0,60/20+0,15+30",
    );
  });
});

describe("validateControl", () => {
  it("accepts a normal control", () => {
    expect(validateControl(simpleControl(300_000, 3000))).toEqual([]);
  });

  it("flags a zero base without simple delay", () => {
    expect(validateControl(simpleControl(0, 0, "none"))).toContainEqual({
      side: 0,
      period: 0,
      field: "time",
      code: "zeroBase",
    });
    expect(validateControl(simpleControl(0, 5000, "fischer")).length).toBe(2);
    expect(validateControl(simpleControl(0, 5000, "delay"))).toEqual([]);
  });

  it("flags negative, non-finite and too-large values", () => {
    expect(validateControl(simpleControl(-1))[0]?.code).toBe("invalid");
    expect(validateControl(simpleControl(Number.NaN))[0]?.code).toBe("invalid");
    expect(validateControl(simpleControl(LIMITS.maxBaseMs + 1))[0]?.code).toBe("tooLarge");
    expect(validateControl(simpleControl(LIMITS.maxBaseMs))).toEqual([]);
    expect(validateControl(simpleControl(60_000, 300_001))[0]).toEqual({
      side: 0,
      period: 0,
      field: "bonus",
      code: "tooLarge",
    });
  });

  it("flags stages that do not come after the previous one", () => {
    const c = parseTimeControl("90/40+30,30+30");
    if (!c) throw new Error("parse");
    const p1 = c.players[1].periods[1];
    if (!p1) throw new Error("stage");
    p1.afterMoves = 0;
    expect(validateControl(c)).toEqual([{ side: 1, period: 1, field: "moves", code: "order" }]);
    p1.afterMoves = 1.5;
    expect(validateControl(c)[0]?.code).toBe("order");
    p1.afterMoves = LIMITS.maxMoves + 1;
    expect(validateControl(c)[0]?.code).toBe("order");
  });
});

describe("start and switching", () => {
  it("starts idle with the base time on both sides", () => {
    const s = clock("5+3");
    expect(s.status).toBe("idle");
    expect(s.active).toBeNull();
    expect(remainingFor(s, 0, 999_999)).toBe(300_000);
    expect(remainingFor(s, 1, 999_999)).toBe(300_000);
  });

  it("the first press starts the opponent's clock", () => {
    const s = press(clock("5+3"), 1, 1000);
    expect(s.status).toBe("running");
    expect(s.active).toBe(0);
    expect(s.moves).toEqual([0, 0]);
    expect(remainingFor(s, 0, 6000)).toBe(295_000);
    expect(remainingFor(s, 1, 6000)).toBe(300_000);
    expect(press(clock("5+3"), 0, 0).active).toBe(1);
  });

  it("ignores a press from the side that is not running (no double switch)", () => {
    const s = press(started("5+3"), 0, 4000);
    expect(s.active).toBe(1);
    expect(press(s, 0, 4001)).toBe(s);
    expect(press(s, 0, 9000)).toBe(s);
  });

  it("Space ends the running side's turn, or starts the left clock", () => {
    const idle = pressActive(clock("1+0"), 0);
    expect(idle.active).toBe(0);
    const s = pressActive(idle, 2000);
    expect(s.active).toBe(1);
    expect(s.moves).toEqual([1, 0]);
    expect(remainingFor(s, 0, 2000)).toBe(58_000);
  });

  it("does nothing while paused", () => {
    const p = pause(started("5+0"), 1000);
    expect(press(p, 0, 2000)).toBe(p);
    expect(pressActive(p, 2000)).toBe(p);
  });
});

describe("Fischer increment", () => {
  it("adds the increment after each move", () => {
    let s = started("1+1");
    expect(remainingFor(s, 0, 10_000)).toBe(50_000);
    s = press(s, 0, 10_000);
    expect(s.remaining[0]).toBe(51_000); // 60 − 10 + 1
    expect(remainingFor(s, 1, 15_000)).toBe(55_000);
    s = press(s, 1, 20_000);
    expect(s.remaining[1]).toBe(51_000);
    expect(s.moves).toEqual([1, 1]);
  });

  it("can grow beyond the base time", () => {
    let s = started("1+5");
    s = press(s, 0, 1000);
    expect(s.remaining[0]).toBe(64_000);
  });
});

describe("Bronstein delay", () => {
  it("adds back the time used when the move was faster than the delay", () => {
    let s = started("3b2");
    s = press(s, 0, 1500);
    expect(s.remaining[0]).toBe(180_000); // 180 − 1.5 + 1.5
  });

  it("adds back only the delay when the move took longer", () => {
    let s = started("3b2");
    s = press(s, 0, 1500);
    expect(remainingFor(s, 1, 3500)).toBe(178_000); // counts down during the turn
    s = press(s, 1, 6500);
    expect(s.remaining[1]).toBe(177_000); // 180 − 5 + 2
  });

  it("can never take a clock above its value at the start of the turn", () => {
    let s = started("3b2");
    s = press(s, 0, 0);
    expect(s.remaining[0]).toBe(180_000);
  });

  it("counts a turn interrupted by a pause as one turn", () => {
    let s = started("3b2");
    s = pause(s, 1000);
    s = resume(s, 5000);
    s = press(s, 0, 5500);
    expect(s.remaining[0]).toBe(180_000); // used 1.5 s in total, all given back
  });
});

describe("simple (US) delay", () => {
  it("holds the main time during the delay and shows the countdown", () => {
    const s = started("G5d2");
    expect(remainingFor(s, 0, 1500)).toBe(300_000);
    expect(delayLeftFor(s, 0, 1500)).toBe(500);
    expect(remainingFor(s, 0, 2000)).toBe(300_000);
    expect(delayLeftFor(s, 0, 2000)).toBe(0);
    expect(remainingFor(s, 0, 5000)).toBe(297_000);
    expect(delayLeftFor(s, 1, 1500)).toBe(0); // the waiting side has no countdown
  });

  it("adds nothing back after the move", () => {
    let s = started("G5d2");
    s = press(s, 0, 5000);
    expect(s.remaining[0]).toBe(297_000);
    s = press(s, 1, 6000); // 1 s, inside the delay
    expect(s.remaining[1]).toBe(300_000);
    expect(delayLeftFor(s, 0, 6000)).toBe(2000); // fresh delay for the next turn
  });

  it("keeps the unused delay across a pause", () => {
    let s = started("G5d2");
    s = pause(s, 1500);
    expect(delayLeftFor(s, 0, 9000)).toBe(500);
    s = resume(s, 10_000);
    expect(delayLeftFor(s, 0, 10_400)).toBe(100);
    expect(remainingFor(s, 0, 11_000)).toBe(299_500);
  });

  it("with zero base time the flag falls exactly when the delay runs out", () => {
    const s = started("G0d5");
    expect(settle(s, 4999).status).toBe("running");
    expect(press(s, 0, 4999).remaining[0]).toBe(0);
    expect(press(s, 0, 4999).active).toBe(1);
    const f = settle(s, 5000);
    expect(f.status).toBe("flagged");
    expect(f.flagged).toBe(0);
  });

  it("flags after main time plus delay", () => {
    const s = started("0:10d2");
    expect(settle(s, 11_999).status).toBe("running");
    expect(settle(s, 12_000).status).toBe("flagged");
    expect(msUntilFlag(s, 1000)).toBe(11_000);
  });
});

describe("flag", () => {
  it("falls exactly when the time reaches zero and the clock stops", () => {
    const s = started("1+0");
    expect(settle(s, 59_999).status).toBe("running");
    expect(remainingFor(s, 0, 59_999)).toBe(1);
    const f = settle(s, 60_000);
    expect(f.status).toBe("flagged");
    expect(f.flagged).toBe(0);
    expect(f.remaining[0]).toBe(0);
    expect(remainingFor(f, 0, 90_000)).toBe(0);
    expect(remainingFor(f, 1, 90_000)).toBe(60_000);
  });

  it("a press 1 ms before the flag still counts", () => {
    const s = press(started("1+0"), 0, 59_999);
    expect(s.status).toBe("running");
    expect(s.remaining[0]).toBe(1);
  });

  it("a press that arrives late (background tab) cannot save a fallen flag", () => {
    const f = press(started("1+0"), 0, 70_000);
    expect(f.status).toBe("flagged");
    expect(f.moves).toEqual([0, 0]);
    expect(remainingFor(f, 0, 70_000)).toBe(0);
  });

  it("never goes below zero", () => {
    const s = started("1+0");
    expect(remainingFor(s, 0, 10 * MIN)).toBe(0);
    expect(readClock(s, 10 * MIN).sides[0].remainingMs).toBe(0);
  });

  it("is final until reset: presses, pause, resume, undo and adjust do nothing", () => {
    const f = settle(started("1+0"), 60_000);
    expect(press(f, 0, 61_000)).toBe(f);
    expect(press(f, 1, 61_000)).toBe(f);
    expect(pause(f, 61_000)).toBe(f);
    expect(resume(f, 61_000)).toBe(f);
    expect(undo(f, 61_000)).toBe(f);
    expect(canUndo(f)).toBe(false);
    expect(adjust(f, 0, MIN, 61_000)).toBe(f);
    const r = reset(f);
    expect(r.status).toBe("idle");
    expect(r.remaining).toEqual([60_000, 60_000]);
    expect(r.history).toEqual([]);
  });

  it("is detected by a pause that comes too late", () => {
    expect(pause(started("1+0"), 61_000).status).toBe("flagged");
  });

  it("reports the time left to the flag", () => {
    const s = started("1+0");
    expect(msUntilFlag(s, 10_000)).toBe(50_000);
    expect(msUntilFlag(pause(s, 10_000), 20_000)).toBeNull();
    expect(msUntilFlag(clock("1+0"), 0)).toBeNull();
  });
});

describe("pause and resume", () => {
  it("freezes the running clock", () => {
    let s = started("5+0");
    s = pause(s, 10_000);
    expect(s.status).toBe("paused");
    expect(remainingFor(s, 0, 50_000)).toBe(290_000);
    s = resume(s, 50_000);
    expect(remainingFor(s, 0, 55_000)).toBe(285_000);
  });

  it("toggles", () => {
    const s = togglePause(started("5+0"), 1000);
    expect(s.status).toBe("paused");
    expect(togglePause(s, 2000).status).toBe("running");
  });

  it("is a no-op before the game starts", () => {
    const s = clock("5+0");
    expect(pause(s, 1000)).toBe(s);
    expect(resume(s, 1000)).toBe(s);
  });
});

describe("multi-stage controls", () => {
  it("FIDE 90/40+30: 30 minutes arrive exactly with move 40", () => {
    const { s: after39 } = playMoves(started("90/40+30,30+30"), 39, 1000);
    // 90 min − 39 × 1 s + 39 × 30 s
    expect(after39.remaining[0]).toBe(6_531_000);
    expect(after39.period).toEqual([0, 0]);
    expect(readClock(after39, 0).sides[0].movesToNextPeriod).toBe(1);

    const { s: after40 } = playMoves(started("90/40+30,30+30"), 40, 1000);
    expect(after40.remaining[0]).toBe(8_360_000); // + 30 min
    expect(after40.remaining[1]).toBe(8_360_000);
    expect(after40.period).toEqual([1, 1]);
    expect(readClock(after40, 0).sides[0].movesToNextPeriod).toBeNull();
  });

  it("each player's stage follows their own move count", () => {
    const { s, t } = playMoves(started("90/40+30,30+30"), 39, 1000);
    const white40 = press(s, 0, t + 1000);
    expect(white40.period).toEqual([1, 0]);
    expect(white40.moves).toEqual([40, 39]);
    expect(readClock(white40, t + 1000).sides[1].movesToNextPeriod).toBe(1);
  });

  it("the new period's bonus applies from the next move", () => {
    let s = started("10/2+5,5+10");
    s = press(s, 0, 1000);
    expect(s.remaining[0]).toBe(604_000); // 600 − 1 + 5
    s = press(s, 1, 2000);
    s = press(s, 0, 3000);
    expect(s.remaining[0]).toBe(908_000); // 604 − 1 + 5 + 300
    s = press(s, 1, 4000);
    s = press(s, 0, 5000);
    expect(s.remaining[0]).toBe(917_000); // 908 − 1 + 10
  });

  it("three periods: 120/40, 60/20, then 15+30", () => {
    const { s: a40 } = playMoves(started("120/40,60/20,15+30"), 40, 1000);
    expect(a40.remaining[0]).toBe(10_760_000); // 7200 − 40 + 3600 s
    const { s: a60 } = playMoves(started("120/40,60/20,15+30"), 60, 1000);
    expect(a60.remaining[0]).toBe(11_640_000); // − 20 + 900 s, no increment yet
    expect(a60.period[0]).toBe(2);
    const { s: a61 } = playMoves(started("120/40,60/20,15+30"), 61, 1000);
    expect(a61.remaining[0]).toBe(11_669_000); // − 1 + 30 s
  });
});

describe("undo", () => {
  it("restores both clocks and counters to before the last press, paused", () => {
    let s = started("5+3");
    s = press(s, 0, 4000);
    expect(s.remaining[0]).toBe(299_000);
    s = undo(s, 6000);
    expect(s.status).toBe("paused");
    expect(s.active).toBe(0);
    expect(s.moves).toEqual([0, 0]);
    expect(s.remaining[1]).toBe(300_000); // Black's 2 s since the press are not charged
    expect(remainingFor(s, 0, 50_000)).toBe(296_000);
    s = resume(s, 10_000);
    expect(remainingFor(s, 0, 11_000)).toBe(295_000);
  });

  it("undoing the starting press returns to idle", () => {
    let s = started("5+3");
    expect(canUndo(s)).toBe(true);
    s = undo(s, 3000);
    expect(s.status).toBe("idle");
    expect(s.active).toBeNull();
    expect(s.remaining).toEqual([300_000, 300_000]);
    expect(canUndo(s)).toBe(false);
    expect(undo(s, 4000)).toBe(s);
  });

  it("walks back several presses in order", () => {
    let s = started("1+0");
    s = press(s, 0, 1000);
    s = press(s, 1, 3000);
    s = press(s, 0, 6000);
    expect(s.moves).toEqual([2, 1]);
    s = undo(s, 7000);
    expect(s.moves).toEqual([1, 1]);
    expect(remainingFor(s, 0, 7000)).toBe(56_000); // 60 − 1 − 3
    s = undo(s, 7000);
    expect(s.moves).toEqual([1, 0]);
    expect(s.active).toBe(1);
    expect(remainingFor(s, 1, 7000)).toBe(58_000);
  });

  it("takes back a stage transition", () => {
    const { s, t } = playMoves(started("90/40+30,30+30"), 39, 1000);
    const w40 = press(s, 0, t + 1000);
    expect(w40.period[0]).toBe(1);
    const back = undo(w40, t + 1000);
    expect(back.period[0]).toBe(0);
    expect(back.moves[0]).toBe(39);
    expect(remainingFor(back, 0, 0)).toBe(6_530_000); // 6531 s − the 1 s of the undone turn
  });

  it("takes back an increment and a Bronstein refund", () => {
    const f = undo(press(started("1+5"), 0, 1000), 1000);
    expect(remainingFor(f, 0, 0)).toBe(59_000);
    const b = undo(press(started("3b2"), 0, 1500), 1500);
    expect(remainingFor(b, 0, 0)).toBe(178_500);
  });
});

describe("adjust", () => {
  it("is refused while the clock runs", () => {
    const s = started("5+3");
    expect(adjust(s, 0, MIN, 1000)).toBe(s);
  });

  it("changes the shown time while paused", () => {
    let s = pause(started("5+3"), 10_000);
    s = adjust(s, 0, MIN, 10_000);
    expect(remainingFor(s, 0, 99_000)).toBe(350_000);
    s = adjust(s, 1, -10_000, 10_000);
    expect(remainingFor(s, 1, 99_000)).toBe(290_000);
    s = resume(s, 20_000);
    expect(remainingFor(s, 0, 21_000)).toBe(349_000);
  });

  it("clamps at zero and at the ceiling", () => {
    const s = pause(started("5+3"), 10_000);
    expect(remainingFor(adjust(s, 0, -1e9, 10_000), 0, 0)).toBe(0);
    expect(remainingFor(adjust(s, 1, 1e12, 10_000), 1, 0)).toBe(LIMITS.maxClockMs);
    expect(adjust(s, 0, Number.NaN, 0)).toBe(s);
  });

  it("an adjustment to zero flags on resume", () => {
    const s = adjust(pause(started("5+3"), 10_000), 0, -1e9, 10_000);
    expect(resume(s, 20_000).status).toBe("flagged");
  });

  it("works before the start (quick time odds)", () => {
    const s = adjust(clock("5+0"), 1, -MIN, 0);
    expect(s.remaining).toEqual([300_000, 240_000]);
  });

  it("is undone by Undo, before the press it followed", () => {
    let s = press(started("5+3"), 0, 4000); // left 299 s, right to move
    s = pause(s, 6000); // right has used 2 s
    s = adjust(s, 0, MIN, 6000);
    expect(remainingFor(s, 0, 0)).toBe(359_000);
    expect(canUndo(s)).toBe(true);
    s = undo(s, 6000);
    expect(s.status).toBe("paused");
    expect(s.active).toBe(1);
    expect(remainingFor(s, 0, 0)).toBe(299_000);
    expect(remainingFor(s, 1, 0)).toBe(298_000); // the paused turn is untouched
    s = undo(s, 6000); // now the press itself
    expect(s.active).toBe(0);
    expect(s.moves).toEqual([0, 0]);
  });

  it("an adjustment before the start undoes back to idle", () => {
    const s = undo(adjust(clock("5+0"), 1, -MIN, 0), 0);
    expect(s.status).toBe("idle");
    expect(s.remaining).toEqual([300_000, 300_000]);
  });

  it("a no-op adjustment adds no undo step", () => {
    const s = clock("5+0");
    expect(adjust(s, 0, 0, 0)).toBe(s);
  });

  it("leaves a simple-delay countdown intact", () => {
    const s = adjust(pause(started("G5d2"), 1000), 0, -10_000, 1000);
    expect(remainingFor(s, 0, 0)).toBe(290_000);
    expect(delayLeftFor(s, 0, 0)).toBe(1000);
  });
});

describe("time odds", () => {
  it("each side runs on its own control", () => {
    let s = started("5+0~3+2");
    s = press(s, 0, 10_000);
    expect(s.remaining[0]).toBe(290_000);
    s = press(s, 1, 20_000);
    expect(s.remaining[1]).toBe(172_000); // 180 − 10 + 2
  });

  it("low-time threshold follows each side's base", () => {
    const c = parseTimeControl("5+3~1+0");
    if (!c) throw new Error("parse");
    expect(lowTimeThreshold(c, 0, "auto")).toBe(30_000); // 10 % of 5 min
    expect(lowTimeThreshold(c, 1, "auto")).toBe(20_000); // floor of 20 s
    expect(lowTimeThreshold(c, 0, "off")).toBe(0);
    expect(lowTimeThreshold(c, 0, 10_000)).toBe(10_000);
    expect(lowTimeThreshold(simpleControl(90 * MIN), 0, "auto")).toBe(540_000);
  });
});

describe("readClock", () => {
  it("summarises both sides", () => {
    const v = readClock(started("G5d2"), 500);
    expect(v.status).toBe("running");
    expect(v.active).toBe(0);
    expect(v.sides[0]).toEqual({
      remainingMs: 300_000,
      delayLeftMs: 1500,
      moves: 0,
      period: 0,
      periods: 1,
      movesToNextPeriod: null,
      running: true,
      flagged: false,
      colour: "white",
    });
    expect(v.sides[1].running).toBe(false);
  });

  it("reports a flag it detects", () => {
    const v = readClock(started("1+0"), 60_000);
    expect(v.status).toBe("flagged");
    expect(v.flagged).toBe(0);
    expect(v.sides[0].flagged).toBe(true);
  });

  it("counts moves to the time control", () => {
    const { s } = playMoves(started("90/40+30,30+30"), 12, 1000);
    expect(readClock(s, 0).sides[0].movesToNextPeriod).toBe(28);
  });
});

describe("persistence", () => {
  it("saves a running game as paused and restores it", () => {
    let s = started("5+3");
    s = press(s, 0, 4000); // Black to move from t = 4000
    const saved = serializeClock(s, 9000);
    expect(saved.status).toBe("paused");
    const json = JSON.stringify(saved);
    const back = parseSavedClock(json);
    expect(back).not.toBeNull();
    const r = back as ClockState;
    expect(r.status).toBe("paused");
    expect(r.turnStart).toBeNull();
    expect(remainingFor(r, 1, 123_456)).toBe(295_000);
    expect(remainingFor(r, 0, 123_456)).toBe(299_000);
    expect(r.moves).toEqual([1, 0]);
    expect(r.history.length).toBe(2);
    // Undo still works after the reload.
    const u = undo(r, 0);
    expect(remainingFor(u, 0, 0)).toBe(296_000);
  });

  it("keeps a flagged game flagged and an idle one idle", () => {
    const f = parseSavedClock(JSON.stringify(serializeClock(started("1+0"), 70_000)));
    expect(f?.status).toBe("flagged");
    expect(f?.flagged).toBe(0);
    const i = parseSavedClock(JSON.stringify(serializeClock(clock("3+2"), 0)));
    expect(i?.status).toBe("idle");
  });

  it("reads a stored 'running' status as paused", () => {
    const data = { ...serializeClock(started("5+3"), 1000), status: "running" };
    expect(restoreClock(data)?.status).toBe("paused");
  });

  it("rejects garbage and wrong shapes", () => {
    const good = serializeClock(started("5+3"), 1000);
    const bad: unknown[] = [
      null,
      42,
      "x",
      [],
      {},
      { ...good, v: 2 },
      { ...good, remaining: [-1, 0] },
      { ...good, remaining: [1, 2, 3] },
      { ...good, moves: [0.5, 0] },
      { ...good, period: [5, 0] },
      { ...good, active: 2 },
      { ...good, status: "exploded" },
      { ...good, status: "paused", active: null },
      { ...good, status: "flagged", flagged: null },
      { ...good, history: "no" },
      { ...good, history: [{ remaining: "x" }] },
      { ...good, control: { players: [] } },
      { ...good, control: simpleControl(0, 0, "none") },
    ];
    for (const b of bad) expect(restoreClock(b), JSON.stringify(b)).toBeNull();
    for (const text of [null, undefined, "", "{", "not json", "null", "[1,2]"]) {
      expect(parseSavedClock(text as string)).toBeNull();
    }
  });
});

describe("history limit", () => {
  it("keeps at most LIMITS.maxHistory undo steps", () => {
    let s = started("10+0");
    let t = 0;
    let side: Side = 0;
    for (let i = 0; i < LIMITS.maxHistory + 10; i++) {
      t += 10;
      s = press(s, side, t);
      side = side === 0 ? 1 : 0;
    }
    expect(s.history.length).toBe(LIMITS.maxHistory);
  });
});

describe("colours", () => {
  it("are unknown before the first press", () => {
    const v = readClock(clock("5+3"), 0);
    expect(v.sides[0].colour).toBeNull();
    expect(v.sides[1].colour).toBeNull();
  });

  it("the side that presses first has Black", () => {
    const v = readClock(press(clock("5+3"), 1, 0), 0);
    expect(v.sides[0].colour).toBe("white");
    expect(v.sides[1].colour).toBe("black");
  });

  it("swapColours starts a fresh game with the colours predicted the other way", () => {
    let s = press(started("5+3"), 0, 1000);
    s = swapColours(s);
    expect(s.status).toBe("idle");
    expect(s.moves).toEqual([0, 0]);
    expect(s.remaining).toEqual([300_000, 300_000]);
    expect(readClock(s, 0).sides[1].colour).toBe("white");
    // The real first press still decides.
    expect(readClock(press(s, 1, 0), 0).sides[0].colour).toBe("white");
  });

  it("reset forgets the colours, swap of an unknown game keeps them unknown", () => {
    expect(reset(started("5+3")).white).toBeNull();
    expect(swapColours(clock("5+3")).white).toBeNull();
  });

  it("survive a save and reload", () => {
    const r = parseSavedClock(JSON.stringify(serializeClock(started("5+3"), 1000)));
    expect(r?.white).toBe(0);
    const { white: _dropped, ...legacy } = serializeClock(started("5+3"), 1000);
    expect(restoreClock(legacy)?.white).toBeNull();
  });
});

describe("reference: time per number of moves and FIDE category", () => {
  const player = (tc: string) => {
    const c = parseTimeControl(tc);
    if (!c) throw new Error(tc);
    return c.players[0];
  };

  it("Fischer: base + n × increment", () => {
    expect(timeForMoves(player("5+3"), 40)).toBe(420_000); // 5 min + 120 s
    expect(timeForMoves(player("5+3"), 60)).toBe(480_000); // 5 min + 180 s
    expect(timeForMoves(player("5+3"), 0)).toBe(300_000);
  });

  it("delays count their free seconds per move", () => {
    expect(timeForMoves(player("G5d2"), 40)).toBe(380_000); // 5 min + 80 s
    expect(timeForMoves(player("3b2"), 60)).toBe(300_000); // 3 min + 120 s
  });

  it("FIDE 90/40+30: the 30 minutes arrive after move 40", () => {
    expect(timeForMoves(player("90/40+30,30+30"), 40)).toBe(6_600_000); // 90 + 20 min
    expect(timeForMoves(player("90/40+30,30+30"), 41)).toBe(8_430_000); // 90 + 30 + 20.5 min
    expect(timeForMoves(player("90/40+30,30+30"), 60)).toBe(9_000_000); // 90 + 30 + 30 min
  });

  it("each period's bonus applies to its own moves", () => {
    const p = player("120/40,60/20,15+30");
    expect(timeForMoves(p, 40)).toBe(7_200_000);
    expect(timeForMoves(p, 60)).toBe(10_800_000);
    expect(timeForMoves(p, 61)).toBe(11_730_000); // + 15 min + one 30 s increment
  });

  it("classifies by base + 60 × increment", () => {
    const cat = (tc: string) => fideCategory(parseTimeControl(tc) as never);
    expect(cat("10+0")).toBe("blitz"); // exactly 10 min is still blitz
    expect(cat("5+5")).toBe("blitz"); // 5 + 5 = 10
    expect(cat("5+6")).toBe("rapid"); // 5 + 6 = 11
    expect(cat("30+20")).toBe("rapid"); // 30 + 20 = 50
    expect(cat("45+15")).toBe("standard"); // 45 + 15 = 60
    expect(cat("59+0")).toBe("rapid");
    expect(cat("90/40+30,30+30")).toBe("standard");
    expect(cat("3+0~15+0")).toBe("rapid"); // odds: the longer side counts
  });

  it("every preset group agrees with the FIDE category", () => {
    for (const row of presetReference()) {
      const { group, tc } = row.preset;
      if (group === "bullet" || group === "blitz") expect(row.category, tc).toBe("blitz");
      if (group === "rapid") expect(row.category, tc).toBe("rapid");
      if (group === "classical") expect(row.category, tc).toBe("standard");
      // Bullet is the online split of blitz: under 3 minutes for 40 moves.
      if (group === "bullet") expect(row.per40Ms, tc).toBeLessThan(180_000);
      if (group === "blitz") expect(row.per40Ms, tc).toBeGreaterThanOrEqual(180_000);
    }
  });

  it("builds a row per preset", () => {
    const rows = presetReference();
    expect(rows.length).toBe(PRESETS.length);
    const fide = rows.find((r) => r.preset.tc === "90/40+30,30+30");
    expect(fide).toMatchObject({
      per40Ms: 6_600_000,
      per60Ms: 9_000_000,
      game60Ms: 18_000_000,
      category: "standard",
    });
    const blitz = rows.find((r) => r.preset.tc === "3+2");
    expect(blitz).toMatchObject({ per40Ms: 260_000, per60Ms: 300_000, game60Ms: 600_000 });
    const delay = rows.find((r) => r.preset.tc === "G30d5");
    expect(delay).toMatchObject({ per60Ms: 2_100_000, category: "rapid" });
  });

  it("formats durations compactly", () => {
    expect(formatDuration(420_000)).toBe("7 min");
    expect(formatDuration(2_600_000)).toBe("43 min 20 s");
    expect(formatDuration(9_000_000)).toBe("2 h 30 min");
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(3_600_000, { h: "ч", min: "мин", s: "с" })).toBe("1 ч");
  });
});

describe("tenths display, link parsing, odds and stored games", () => {
  it("with the one-minute tenths threshold the face reads 1:00.9 … 59.9", () => {
    expect(formatClock(61_000, 60_000)).toBe("1:01");
    expect(formatClock(60_999, 60_000)).toBe("1:00.9");
    expect(formatClock(60_000, 60_000)).toBe("1:00.0");
    expect(formatClock(59_999, 60_000)).toBe("59.9");
  });

  it("reads the lenient link spellings people type by hand", () => {
    const fmt = (tc: string) => {
      const c = parseTimeControl(tc);
      return c ? formatTimeControl(c) : null;
    };
    expect(fmt("G/5d2")).toBe("G5d2");
    expect(fmt("g5D2")).toBe("G5d2");
    expect(fmt(" 5+3\n")).toBe("5+3");
    expect(fmt("1.5+0")).toBe("1:30+0");
    expect(fmt("0:30+0")).toBe("0:30+0");
    expect(fmt("5b0")).toBe("5+0");
    expect(fmt("5d0")).toBe("5+0");
    expect(fmt("G5")).toBe("5+0");
    // Every period but the last must say how many moves it lasts.
    expect(fmt("90/40+30,30+30,15+30")).toBeNull();
    expect(fmt("5+3,5+3")).toBeNull();
  });

  it("odds with different bonus modes: each side spends its own way", () => {
    let s = press(clock("G5d2~5+3"), 1, 0); // left (simple delay) runs
    s = press(s, 0, 1000); // inside the delay: costs nothing, earns nothing
    s = press(s, 1, 11_000); // right (Fischer): −10 s + 3 s
    expect(readClock(s, 11_000).sides.map((x) => x.remainingMs)).toEqual([300_000, 293_000]);
  });

  it("rejects a stored game whose stage index is past the control's last stage", () => {
    const saved = serializeClock(started("5+3"), 1000);
    expect(restoreClock({ ...saved, period: [1, 0] })).toBeNull();
    expect(
      restoreClock({ ...saved, history: [{ ...saved.history[0], period: [0, 3] }] }),
    ).toBeNull();
  });
});
