import { describe, expect, it } from "vitest";
import {
  DEFAULT_BPM,
  barDurationSeconds,
  beatIntervalSeconds,
  buildClicks,
  clampBpm,
  clickIntervalSeconds,
  defaultAccents,
  describeTempo,
  formatTimeSignature,
  nextAccent,
  normalizeSettings,
  noteDurations,
  parseTimeSignature,
  tapTempo,
  tempoMarkings,
} from "./online-metronome.js";

// The AudioContext oscillators live in the mount; the schedule it plays is pure.

describe("tempo helpers", () => {
  it("clamps BPM to 30–250 with one decimal and rejects non-finite values", () => {
    expect(clampBpm(Number.NaN)).toBe(DEFAULT_BPM);
    expect(clampBpm(Number.POSITIVE_INFINITY)).toBe(DEFAULT_BPM);
    expect(clampBpm(10)).toBe(30);
    expect(clampBpm(300)).toBe(250);
    expect(clampBpm(120.04)).toBe(120);
    expect(clampBpm(99.96)).toBe(100);
  });

  it("computes beat, click and bar lengths", () => {
    expect(beatIntervalSeconds(120)).toBe(0.5);
    expect(clickIntervalSeconds(120, 4)).toBe(0.125);
    expect(clickIntervalSeconds(120, 0)).toBe(0.5); // invalid subdivision -> 1
    expect(barDurationSeconds(120, 3)).toBe(1.5);
  });

  it("names tempos with the Italian table", () => {
    expect(describeTempo(40).name).toBe("Grave");
    expect(describeTempo(60).name).toBe("Largo");
    expect(describeTempo(120).name).toBe("Moderato");
    expect(describeTempo(121).name).toBe("Allegro");
    expect(describeTempo(250).name).toBe("Prestissimo");
    // below the range clamps to 30 = Grave
    expect(describeTempo(5).name).toBe("Grave");
  });

  it("names fractional tempos by their range", () => {
    expect(describeTempo(120.5).name).toBe("Moderato");
    expect(describeTempo(60.7).name).toBe("Largo");
  });

  it("returns a copy of the tempo table", () => {
    const table = tempoMarkings();
    table[0].name = "changed";
    expect(tempoMarkings()[0].name).toBe("Larghissimo");
  });

  it("lists note lengths in ms (quarter = one beat)", () => {
    // 120 BPM: quarter = 500 ms
    expect(noteDurations(120)).toEqual({
      whole: 2000,
      half: 1000,
      quarter: 500,
      eighth: 250,
      sixteenth: 125,
      thirtySecond: 62.5,
      dottedHalf: 1500,
      dottedQuarter: 750,
      dottedEighth: 375,
      tripletQuarter: 333.3,
      tripletEighth: 166.7,
    });
  });
});

describe("time signatures and accents", () => {
  it("parses common notations and falls back to 4/4", () => {
    expect(parseTimeSignature("7/8")).toEqual({ beats: 7, unit: 8 });
    expect(parseTimeSignature("7 - 8")).toEqual({ beats: 7, unit: 8 });
    expect(parseTimeSignature("3:4")).toEqual({ beats: 3, unit: 4 });
    expect(parseTimeSignature("5/3")).toEqual({ beats: 5, unit: 4 }); // invalid unit
    expect(parseTimeSignature("99/4")).toEqual({ beats: 32, unit: 4 });
    expect(parseTimeSignature("abc")).toEqual({ beats: 4, unit: 4 });
    expect(parseTimeSignature(undefined as unknown as string)).toEqual({ beats: 4, unit: 4 });
  });

  it("gives simple meters a single strong downbeat", () => {
    expect(defaultAccents(4, 4)).toEqual(["strong", "normal", "normal", "normal"]);
    expect(defaultAccents(0, 4)).toHaveLength(4);
  });

  it("groups compound meters in threes", () => {
    expect(defaultAccents(6, 8)).toEqual([
      "strong",
      "normal",
      "normal",
      "medium",
      "normal",
      "normal",
    ]);
    const twelve = defaultAccents(12, 8);
    expect([3, 6, 9].map((i) => twelve[i])).toEqual(["medium", "medium", "medium"]);
  });

  it("uses 3+2 and 3+2+2 for 5/8 and 7/8", () => {
    expect(defaultAccents(5, 8)).toEqual(["strong", "normal", "normal", "medium", "normal"]);
    expect(defaultAccents(7, 8)).toEqual([
      "strong",
      "normal",
      "normal",
      "medium",
      "normal",
      "medium",
      "normal",
    ]);
  });

  it("normalises settings and sizes the accent array to the bar", () => {
    expect(
      normalizeSettings({
        bpm: 500,
        beats: 3,
        unit: 5,
        subdivision: 20,
        accents: ["bogus" as "strong", "mute"],
      }),
    ).toEqual({
      bpm: 250,
      beats: 3,
      unit: 4,
      subdivision: 8,
      accents: ["strong", "mute", "normal"],
    });
    expect(normalizeSettings({}).bpm).toBe(120);
  });

  it("cycles accents and formats signatures", () => {
    expect(nextAccent("strong")).toBe("medium");
    expect(nextAccent("mute")).toBe("strong");
    expect(formatTimeSignature(7, 3)).toBe("7/4");
    expect(formatTimeSignature(6, 8)).toBe("6/8");
  });
});

describe("buildClicks", () => {
  it("schedules beats and quieter subdivisions (4/4, eighths, 120 BPM)", () => {
    // click every 0.25 s, 8 clicks per bar
    const clicks = buildClicks({ bpm: 120, beats: 4, unit: 4, subdivision: 2 }, 0, 10);
    expect(clicks).toHaveLength(10);
    expect(clicks[0]).toEqual({
      index: 0,
      time: 0,
      bar: 1,
      beatInBar: 0,
      subIndex: 0,
      level: "strong",
      frequencyHz: 1600,
      gain: 1,
    });
    expect(clicks[1]).toMatchObject({ time: 0.25, subIndex: 1, level: "normal", frequencyHz: 900 });
    expect(clicks[1].gain).toBeCloseTo(0.55 * 0.45);
    expect(clicks[2]).toMatchObject({ beatInBar: 1, level: "normal", gain: 0.55 });
    expect(clicks[8]).toMatchObject({ time: 2, bar: 2, beatInBar: 0, level: "strong" });
  });

  it("continues from a tick counter and offsets by the origin time", () => {
    const [click] = buildClicks({ bpm: 60, beats: 3 }, 7, 1, 10);
    // tick 7 in 3/4 at 60 BPM: 10 + 7 s, bar 3, beat 1
    expect(click).toMatchObject({ index: 7, time: 17, bar: 3, beatInBar: 1 });
  });

  it("keeps muted beats and their subdivisions silent", () => {
    const clicks = buildClicks({ beats: 2, subdivision: 2, accents: ["strong", "mute"] }, 0, 4);
    expect(clicks.slice(2).map((c) => [c.level, c.frequencyHz, c.gain])).toEqual([
      ["mute", 0, 0],
      ["mute", 0, 0],
    ]);
  });

  it("returns nothing for bad counts and caps very large requests", () => {
    expect(buildClicks({}, 0, Number.NaN)).toEqual([]);
    expect(buildClicks({}, 0, -3)).toEqual([]);
    expect(buildClicks({}, Number.NaN, 1)[0].index).toBe(0);
    expect(buildClicks({}, 0, 10_000)).toHaveLength(2048);
  });
});

describe("tapTempo", () => {
  it("needs two taps", () => {
    expect(tapTempo([])).toEqual({ bpm: 0, taps: 0, averageIntervalMs: 0 });
    expect(tapTempo([1000])).toEqual({ bpm: 0, taps: 1, averageIntervalMs: 0 });
  });

  it("averages recent gaps and ignores taps before a long pause", () => {
    // gaps 500, 500 after a 5 s pause -> 60000/500 = 120 BPM from 3 taps
    expect(tapTempo([0, 5000, 5500, 6000])).toEqual({ bpm: 120, taps: 3, averageIntervalMs: 500 });
  });

  it("sorts input and uses only the last `window` gaps", () => {
    const taps = Array.from({ length: 10 }, (_, i) => i * 500).reverse();
    expect(tapTempo(taps, { window: 4 })).toEqual({ bpm: 120, taps: 5, averageIntervalMs: 500 });
  });

  it("reports one tap when the last gap is too long or zero", () => {
    expect(tapTempo([0, 3000])).toEqual({ bpm: 0, taps: 1, averageIntervalMs: 0 });
    expect(tapTempo([100, 100])).toEqual({ bpm: 0, taps: 1, averageIntervalMs: 0 });
  });

  it("clamps the detected tempo and keeps one decimal", () => {
    // 60000 / 497 = 120.72 -> 120.7
    expect(tapTempo([0, 497]).bpm).toBe(120.7);
    // gap 100 ms = 600 BPM -> 250
    expect(tapTempo([0, 100]).bpm).toBe(250);
  });
});
