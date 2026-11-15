import { describe, expect, it } from "vitest";
import {
  alarmIsDue,
  alarmNeedsReschedule,
  computeLaps,
  formatCountdown,
  formatDuration,
  toMilliseconds,
} from "./stopwatch-timer.js";

describe("formatDuration", () => {
  it("uses the given decimal separator before centiseconds", () => {
    expect(formatDuration(1_518, true, ",").display).toBe("00:01,51");
    expect(formatDuration(1_518).display).toBe("00:01.51");
    expect(formatDuration(1_518, false, ",").display).toBe("00:01");
  });

  it("formats zero as 00:00.00", () => {
    expect(formatDuration(0)).toEqual({
      hours: 0,
      minutes: 0,
      seconds: 0,
      centiseconds: 0,
      display: "00:00.00",
    });
  });

  it("formats sub-hour durations as mm:ss.cc", () => {
    // 83 456 ms = 1 min 23 s 456 ms -> 45 centiseconds (floored)
    const r = formatDuration(83_456);
    expect(r.minutes).toBe(1);
    expect(r.seconds).toBe(23);
    expect(r.centiseconds).toBe(45);
    expect(r.display).toBe("01:23.45");
  });

  it("adds an unpadded hours segment from one hour up", () => {
    // 1 h 2 min 3 s 450 ms = 3 723 450 ms
    expect(formatDuration(3_723_450).display).toBe("1:02:03.45");
    // 100 h
    expect(formatDuration(360_000_000).display).toBe("100:00:00.00");
  });

  it("floors, never rounds up, at boundaries", () => {
    expect(formatDuration(59_999).display).toBe("00:59.99");
    expect(formatDuration(3_599_999).display).toBe("59:59.99");
    expect(formatDuration(3_600_000).display).toBe("1:00:00.00");
    expect(formatDuration(9).display).toBe("00:00.00");
  });

  it("omits centiseconds when asked", () => {
    expect(formatDuration(83_456, false).display).toBe("01:23");
    expect(formatDuration(3_723_450, false).display).toBe("1:02:03");
  });

  it("treats negative, NaN and Infinity as zero", () => {
    for (const v of [-1000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatDuration(v).display).toBe("00:00.00");
    }
  });

  it("handles fractional milliseconds", () => {
    expect(formatDuration(1234.9).display).toBe("00:01.23");
  });
});

describe("formatCountdown", () => {
  it("rounds whole seconds up so the last second reads 00:01, not 00:00", () => {
    expect(formatCountdown(60_000).display).toBe("01:00");
    expect(formatCountdown(59_900).display).toBe("01:00");
    expect(formatCountdown(900).display).toBe("00:01");
    expect(formatCountdown(1).display).toBe("00:01");
    expect(formatCountdown(0).display).toBe("00:00");
  });

  it("treats negative and non-finite values as zero", () => {
    expect(formatCountdown(-5).display).toBe("00:00");
    expect(formatCountdown(Number.NaN).display).toBe("00:00");
  });
});

describe("toMilliseconds", () => {
  it("caps hours at 99, the largest the display shows", () => {
    expect(toMilliseconds(1000, 0, 0)).toBe(99 * 3_600_000);
  });

  it("sums h/m/s into milliseconds", () => {
    // (1*3600 + 30*60 + 15) s = 5415 s
    expect(toMilliseconds(1, 30, 15)).toBe(5_415_000);
    expect(toMilliseconds(0, 0, 0)).toBe(0);
  });

  it("allows minutes/seconds above 59 (normalised by the sum)", () => {
    expect(toMilliseconds(0, 90, 90)).toBe((90 * 60 + 90) * 1000);
  });

  it("clamps negative and non-finite parts to 0 and floors fractions", () => {
    expect(toMilliseconds(-1, 5, 0)).toBe(300_000);
    expect(toMilliseconds(Number.NaN, Number.POSITIVE_INFINITY, 10)).toBe(10_000);
    expect(toMilliseconds(0, 1.9, 2.7)).toBe(62_000);
  });
});

describe("computeLaps", () => {
  it("returns no laps for an empty list", () => {
    expect(computeLaps([])).toEqual({ laps: [], fastestIndex: -1, slowestIndex: -1 });
  });

  it("does not mark fastest/slowest with a single lap", () => {
    const r = computeLaps([5000]);
    expect(r.laps).toEqual([{ index: 1, duration: 5000, total: 5000 }]);
    expect(r.fastestIndex).toBe(-1);
    expect(r.slowestIndex).toBe(-1);
  });

  it("derives per-lap splits from cumulative times", () => {
    // splits: 10 000, 8 000, 12 000, 9 000
    const r = computeLaps([10_000, 18_000, 30_000, 39_000]);
    expect(r.laps.map((l) => l.duration)).toEqual([10_000, 8_000, 12_000, 9_000]);
    expect(r.laps.map((l) => l.index)).toEqual([1, 2, 3, 4]);
    expect(r.laps[3].total).toBe(39_000);
    expect(r.fastestIndex).toBe(1);
    expect(r.slowestIndex).toBe(2);
  });

  it("marks nothing when every lap is equal", () => {
    const r = computeLaps([1000, 2000, 3000]);
    expect(r.fastestIndex).toBe(-1);
    expect(r.slowestIndex).toBe(-1);
  });

  it("keeps the first lap on partial ties", () => {
    // durations 1000, 1000, 3000: the first of the two fastest wins
    const r = computeLaps([1000, 2000, 5000]);
    expect(r.fastestIndex).toBe(0);
    expect(r.slowestIndex).toBe(2);
  });

  it("drops negative and non-finite entries", () => {
    const r = computeLaps([1000, -5, Number.NaN, 3000, Number.POSITIVE_INFINITY]);
    expect(r.laps.map((l) => l.duration)).toEqual([1000, 2000]);
  });
});

describe("alarm clock sync", () => {
  it("keeps the queued beeps while the audio clock agrees with the countdown", () => {
    expect(alarmNeedsReschedule(30_000, 30_000)).toBe(false);
    expect(alarmNeedsReschedule(30_200, 30_000)).toBe(false);
    expect(alarmNeedsReschedule(29_800, 30_000)).toBe(false);
  });

  it("re-queues after the audio clock stalled (sleep, lock, audio taken by a call)", () => {
    // 20 s of sleep: the screen shows 10 s left, the audio clock still thinks 30 s.
    expect(alarmNeedsReschedule(30_000, 10_000)).toBe(true);
    expect(alarmNeedsReschedule(1_000, 600)).toBe(true);
    expect(alarmNeedsReschedule(Number.NaN, 5_000)).toBe(true);
  });

  it("treats a countdown already past zero as zero left", () => {
    expect(alarmNeedsReschedule(0, -40)).toBe(false);
    expect(alarmNeedsReschedule(5_000, -40)).toBe(true);
  });

  it("at 00:00: due beeps play on, beeps still far ahead must sound now instead", () => {
    expect(alarmIsDue(0)).toBe(true);
    expect(alarmIsDue(120)).toBe(true);
    expect(alarmIsDue(-300)).toBe(true);
    expect(alarmIsDue(20_000)).toBe(false);
    expect(alarmIsDue(Number.NaN)).toBe(false);
  });
});
