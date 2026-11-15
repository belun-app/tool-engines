/**
 * Audio level of microphone samples (RMS, peak, dBFS, clipping, activity) and a summary of a
 * microphone test session.
 */

export interface AudioLevelResult {
  /** Root-mean-square level of the sample window, 0–1 */
  rms: number;
  /** Peak absolute sample value in the window, 0–1 */
  peak: number;
  /** RMS level in decibels relative to full scale, clamped to [-100, 0] */
  db: number;
  /** Meter fill percentage 0–100, mapped from the dB level */
  percent: number;
  /** True when the signal is at or near full scale and likely distorting */
  clipping: boolean;
  /** True when the level is above the silence floor */
  active: boolean;
}

const SILENCE_FLOOR_DB = -60;
const CLIP_THRESHOLD = 0.985;

const EMPTY: AudioLevelResult = {
  rms: 0,
  peak: 0,
  db: -100,
  percent: 0,
  clipping: false,
  active: false,
};

/**
 * Analyze one window of time-domain audio samples (values in -1..1,
 * e.g. from AnalyserNode.getFloatTimeDomainData).
 */
export function analyzeAudioLevel(samples: ArrayLike<number>): AudioLevelResult {
  if (!samples || samples.length === 0) return { ...EMPTY };

  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (!Number.isFinite(value)) continue;
    sumSquares += value * value;
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  const db = rms > 0 ? Math.max(-100, Math.min(0, 20 * Math.log10(rms))) : -100;
  const percent =
    db <= SILENCE_FLOOR_DB
      ? 0
      : Math.min(100, Math.round(((db - SILENCE_FLOOR_DB) / -SILENCE_FLOOR_DB) * 100));

  return {
    rms: Math.round(rms * 1000) / 1000,
    peak: Math.round(Math.min(1, peak) * 1000) / 1000,
    db: Math.round(db * 10) / 10,
    percent,
    clipping: peak >= CLIP_THRESHOLD,
    active: db > SILENCE_FLOOR_DB + 5,
  };
}

export type AudioLevelVerdict = "clipping" | "silent" | "very-quiet" | "quiet" | "good" | "loud";

/** Classify a level reading, for status text next to the meter. */
export function classifyAudioLevel(result: AudioLevelResult): AudioLevelVerdict {
  if (result.clipping) return "clipping";
  if (!result.active) return "silent";
  if (result.percent < 25) return "very-quiet";
  if (result.percent < 45) return "quiet";
  if (result.percent <= 85) return "good";
  return "loud";
}

export interface MicSessionSummary {
  maxPercent: number;
  maxDb: number;
  clippedFrames: number;
  verdict: "no-signal" | "too-quiet" | "good" | "clipping";
}

/** Summarize a whole test session from the per-frame readings collected while testing. */
export function summarizeMicSession(readings: AudioLevelResult[]): MicSessionSummary {
  if (!readings || readings.length === 0) {
    return { maxPercent: 0, maxDb: -100, clippedFrames: 0, verdict: "no-signal" };
  }

  let maxPercent = 0;
  let maxDb = -100;
  let clippedFrames = 0;
  let anyActive = false;
  for (const reading of readings) {
    if (reading.percent > maxPercent) maxPercent = reading.percent;
    if (reading.db > maxDb) maxDb = reading.db;
    if (reading.clipping) clippedFrames++;
    if (reading.active) anyActive = true;
  }

  let verdict: MicSessionSummary["verdict"] = "good";
  // Same test as the live verdict ("No signal detected"), so the two never disagree.
  if (!anyActive) verdict = "no-signal";
  else if (maxPercent < 25) verdict = "too-quiet";
  else if (clippedFrames > readings.length * 0.05) verdict = "clipping";

  return { maxPercent, maxDb, clippedFrames, verdict };
}
