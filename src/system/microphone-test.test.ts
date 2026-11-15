import { describe, expect, it } from "vitest";
import {
  type AudioLevelResult,
  analyzeAudioLevel,
  classifyAudioLevel,
  summarizeMicSession,
} from "./microphone-test.js";

// Capturing audio (getUserMedia / AnalyserNode) is browser-bound and lives in the mount;
// the level maths is tested on synthetic sample windows.

const constant = (v: number, n = 256) => new Float32Array(n).fill(v);
const sine = (amp: number, n = 1024) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 8 * i) / n));

describe("analyzeAudioLevel", () => {
  it("returns silence for an empty window", () => {
    expect(analyzeAudioLevel([])).toEqual({
      rms: 0,
      peak: 0,
      db: -100,
      percent: 0,
      clipping: false,
      active: false,
    });
    expect(analyzeAudioLevel(constant(0))).toMatchObject({ rms: 0, db: -100, percent: 0 });
  });

  it("computes RMS, peak and dBFS for a full-scale sine", () => {
    // RMS of a sine = A/sqrt(2) = 0.7071 -> 20*log10(0.7071) = -3.01 dBFS
    const r = analyzeAudioLevel(sine(1));
    expect(r.rms).toBe(Math.round(Math.SQRT1_2 * 1000) / 1000);
    expect(r.peak).toBe(1);
    expect(r.db).toBe(-3);
    // meter: (-3.01 + 60) / 60 = 94.98 % -> 95
    expect(r.percent).toBe(95);
    expect(r.clipping).toBe(true);
    expect(r.active).toBe(true);
  });

  it("maps a 0.5 square wave to -6 dBFS / 90 %", () => {
    const r = analyzeAudioLevel(Float32Array.from({ length: 200 }, (_, i) => (i % 2 ? 0.5 : -0.5)));
    // 20*log10(0.5) = -6.02; (60 - 6.02) / 60 = 89.97 % -> 90
    expect(r.rms).toBe(0.5);
    expect(r.db).toBe(-6);
    expect(r.percent).toBe(90);
    expect(r.clipping).toBe(false);
  });

  it("maps -40 dBFS to a third of the meter", () => {
    const r = analyzeAudioLevel(constant(0.01));
    expect(r.db).toBe(-40);
    // (60 - 40) / 60 = 33.3 % -> 33
    expect(r.percent).toBe(33);
    expect(r.active).toBe(true);
  });

  it("puts the silence floor at -60 dBFS and activity at -55 dBFS", () => {
    expect(analyzeAudioLevel(constant(0.001))).toMatchObject({
      db: -60,
      percent: 0,
      active: false,
    });
    // 0.002 -> -53.98 dBFS: above -55, so active; (60-53.98)/60 = 10 %
    expect(analyzeAudioLevel(constant(0.002))).toMatchObject({ percent: 10, active: true });
    // 1e-6 -> -120 dBFS clamps to -100
    expect(analyzeAudioLevel(constant(1e-6)).db).toBe(-100);
  });

  it("flags clipping at 0.985 of full scale", () => {
    const window = constant(0.1);
    window[10] = -0.985;
    expect(analyzeAudioLevel(window).clipping).toBe(true);
    window[10] = 0.98;
    expect(analyzeAudioLevel(window).clipping).toBe(false);
  });

  it("clamps out-of-range samples to 0 dBFS / peak 1", () => {
    const r = analyzeAudioLevel(constant(1.5));
    expect(r.db).toBe(0);
    expect(r.percent).toBe(100);
    expect(r.peak).toBe(1);
  });

  it("skips non-finite samples instead of returning NaN", () => {
    const r = analyzeAudioLevel([0.5, Number.NaN, Number.POSITIVE_INFINITY, -0.5]);
    // sum of squares 0.5 over 4 samples -> sqrt(0.125) = 0.354
    expect(r.rms).toBe(0.354);
    expect(r.peak).toBe(0.5);
    expect(Number.isNaN(r.db)).toBe(false);
  });
});

describe("classifyAudioLevel", () => {
  const reading = (over: Partial<AudioLevelResult>): AudioLevelResult => ({
    rms: 0.1,
    peak: 0.1,
    db: -20,
    percent: 50,
    clipping: false,
    active: true,
    ...over,
  });

  it("orders clipping > silent > percent buckets", () => {
    expect(classifyAudioLevel(reading({ clipping: true, active: false }))).toBe("clipping");
    expect(classifyAudioLevel(reading({ active: false }))).toBe("silent");
    expect(classifyAudioLevel(reading({ percent: 24 }))).toBe("very-quiet");
    expect(classifyAudioLevel(reading({ percent: 25 }))).toBe("quiet");
    expect(classifyAudioLevel(reading({ percent: 44 }))).toBe("quiet");
    expect(classifyAudioLevel(reading({ percent: 45 }))).toBe("good");
    expect(classifyAudioLevel(reading({ percent: 85 }))).toBe("good");
    expect(classifyAudioLevel(reading({ percent: 86 }))).toBe("loud");
  });

  it("works on real analyses", () => {
    expect(classifyAudioLevel(analyzeAudioLevel(constant(0)))).toBe("silent");
    expect(classifyAudioLevel(analyzeAudioLevel(sine(1)))).toBe("clipping");
    expect(classifyAudioLevel(analyzeAudioLevel(constant(0.01)))).toBe("quiet");
  });
});

describe("summarizeMicSession", () => {
  const q = analyzeAudioLevel(constant(0.01)); // 33 %
  const silent = analyzeAudioLevel(constant(0));
  const clip = analyzeAudioLevel(sine(1));
  const faint = analyzeAudioLevel(constant(0.002)); // 10 %

  it("reports no-signal for an empty or all-silent session", () => {
    expect(summarizeMicSession([])).toEqual({
      maxPercent: 0,
      maxDb: -100,
      clippedFrames: 0,
      verdict: "no-signal",
    });
    expect(summarizeMicSession([silent, silent]).verdict).toBe("no-signal");
  });

  it("calls a near-floor session no-signal, like the live verdict", () => {
    // A = 0.0015 sine: RMS 0.00106 -> -59.5 dBFS -> meter 1 %, but not "active"
    const nearFloor = analyzeAudioLevel(sine(0.0015));
    expect(nearFloor.active).toBe(false);
    expect(classifyAudioLevel(nearFloor)).toBe("silent");
    expect(summarizeMicSession([nearFloor, nearFloor]).verdict).toBe("no-signal");
  });

  it("reports too-quiet below 25 % peak meter", () => {
    expect(summarizeMicSession([silent, faint]).verdict).toBe("too-quiet");
  });

  it("reports good with max level and dB", () => {
    expect(summarizeMicSession([silent, q])).toEqual({
      maxPercent: 33,
      maxDb: -40,
      clippedFrames: 0,
      verdict: "good",
    });
  });

  it("reports clipping only above 5 % of frames", () => {
    // 1 clipped frame in 20 = 5 % -> not more than 5 % -> good
    const twenty = [clip, ...Array(19).fill(q)];
    expect(summarizeMicSession(twenty)).toMatchObject({ clippedFrames: 1, verdict: "good" });
    // 2 in 20 = 10 % -> clipping
    const two = [clip, clip, ...Array(18).fill(q)];
    expect(summarizeMicSession(two).verdict).toBe("clipping");
  });
});
