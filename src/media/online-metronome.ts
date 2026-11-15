/**
 * Metronome timing maths. No audio, no DOM — the mount layer owns the AudioContext
 * and only asks this module *when* the next clicks fall and *what* they should sound like.
 *
 * BPM here means clicks per minute of the beat unit written in the time signature's
 * denominator, which is what every online metronome does: 6/8 at 120 clicks 120 eighths,
 * not 120 quarters. The note-duration table below still reports quarter-note values,
 * because that is the convention delay and LFO times are written in.
 */

export const MIN_BPM = 30;
export const MAX_BPM = 250;
export const DEFAULT_BPM = 120;

/** How strongly a position in the bar is played. */
export type AccentLevel = "strong" | "medium" | "normal" | "mute";

/** Click order when a beat indicator is tapped. */
export const ACCENT_CYCLE: AccentLevel[] = ["strong", "medium", "normal", "mute"];

export interface TimeSignature {
  /** Beats per bar — the numerator. */
  beats: number;
  /** Note value that gets one beat — the denominator (1, 2, 4, 8, 16). */
  unit: number;
}

export interface MetronomeSettings {
  bpm: number;
  beats: number;
  unit: number;
  /** Clicks per beat: 1 = plain beats, 2 = eighths, 3 = triplets, 4 = sixteenths. */
  subdivision: number;
  /** Accent per beat of the bar. Shorter or longer arrays are padded or trimmed. */
  accents?: AccentLevel[];
}

export interface ScheduledClick {
  /** Tick number since the schedule origin, counting subdivisions. */
  index: number;
  /** Seconds after the origin at which this click sounds. */
  time: number;
  /** 1-based bar number since the origin. */
  bar: number;
  /** 0-based beat position inside the bar. */
  beatInBar: number;
  /** 0-based position inside the beat; 0 is the beat itself. */
  subIndex: number;
  level: AccentLevel;
  /** Pitch the mount should use for this click. 0 for a muted position. */
  frequencyHz: number;
  /** Peak gain, 0-1, before the volume fader. */
  gain: number;
}

export interface TapTempoResult {
  /** Detected tempo, clamped to the metronome range. 0 until two taps exist. */
  bpm: number;
  /** Taps that survived the reset window and fed the average. */
  taps: number;
  /** Mean gap between the taps used, in milliseconds. */
  averageIntervalMs: number;
}

export interface NoteDurations {
  whole: number;
  half: number;
  quarter: number;
  eighth: number;
  sixteenth: number;
  thirtySecond: number;
  dottedHalf: number;
  dottedQuarter: number;
  dottedEighth: number;
  tripletQuarter: number;
  tripletEighth: number;
}

export interface TempoMarking {
  /** Italian tempo word, e.g. "Allegro". */
  name: string;
  /** Lowest BPM that still carries this name. */
  from: number;
  /** Highest BPM that still carries this name. */
  to: number;
}

/** Time signatures offered in the picker, in the order musicians reach for them. */
export const TIME_SIGNATURE_PRESETS: TimeSignature[] = [
  { beats: 2, unit: 4 },
  { beats: 3, unit: 4 },
  { beats: 4, unit: 4 },
  { beats: 5, unit: 4 },
  { beats: 6, unit: 4 },
  { beats: 7, unit: 4 },
  { beats: 3, unit: 8 },
  { beats: 5, unit: 8 },
  { beats: 6, unit: 8 },
  { beats: 7, unit: 8 },
  { beats: 9, unit: 8 },
  { beats: 12, unit: 8 },
];

/**
 * The usual Italian tempo table. Boundaries differ between editions by a few BPM —
 * these follow the ranges printed on Wittner and Seiko mechanical metronomes.
 */
const TEMPO_MARKINGS: TempoMarking[] = [
  { name: "Larghissimo", from: 0, to: 24 },
  { name: "Grave", from: 25, to: 45 },
  { name: "Largo", from: 46, to: 60 },
  { name: "Larghetto", from: 61, to: 66 },
  { name: "Adagio", from: 67, to: 76 },
  { name: "Andante", from: 77, to: 108 },
  { name: "Moderato", from: 109, to: 120 },
  { name: "Allegro", from: 121, to: 156 },
  { name: "Vivace", from: 157, to: 176 },
  { name: "Presto", from: 177, to: 200 },
  { name: "Prestissimo", from: 201, to: 999 },
];

/** Pitch and loudness per accent level. Muted positions keep the slot but make no sound. */
const VOICES: Record<AccentLevel, { frequencyHz: number; gain: number }> = {
  strong: { frequencyHz: 1600, gain: 1 },
  medium: { frequencyHz: 1200, gain: 0.72 },
  normal: { frequencyHz: 900, gain: 0.55 },
  mute: { frequencyHz: 0, gain: 0 },
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Keep a tempo inside the range the UI promises, rejecting NaN and Infinity. */
export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_BPM;
  return clamp(Math.round(bpm * 10) / 10, MIN_BPM, MAX_BPM);
}

/** Read "7/8", "7 / 8" or "7-8" into a time signature. Falls back to 4/4. */
export function parseTimeSignature(input: string): TimeSignature {
  const match = /(\d{1,2})\s*[/\-:]\s*(\d{1,2})/.exec(input ?? "");
  if (!match) return { beats: 4, unit: 4 };
  const beats = clamp(Number.parseInt(match[1], 10) || 4, 1, 32);
  const rawUnit = Number.parseInt(match[2], 10);
  const unit = [1, 2, 4, 8, 16].includes(rawUnit) ? rawUnit : 4;
  return { beats, unit };
}

/**
 * Accent pattern a musician would expect before touching anything.
 * Compound meters (6/8, 9/8, 12/8) group in threes with a medium accent on each group;
 * 5/8 and 7/8 take the common 3+2 and 3+2+2 asymmetric groupings; everything else
 * gets a strong downbeat and plain beats after it.
 */
export function defaultAccents(beats: number, unit: number): AccentLevel[] {
  const count = clamp(Math.floor(beats) || 4, 1, 32);
  const pattern: AccentLevel[] = new Array(count).fill("normal");
  pattern[0] = "strong";

  if (unit === 8) {
    const groups = count === 5 ? [3, 2] : count === 7 ? [3, 2, 2] : null;
    if (groups) {
      let at = 0;
      for (const size of groups) {
        if (at > 0 && at < count) pattern[at] = "medium";
        at += size;
      }
      return pattern;
    }
    if (count % 3 === 0) {
      for (let i = 3; i < count; i += 3) pattern[i] = "medium";
      return pattern;
    }
  }

  return pattern;
}

/** Normalise user settings: clamp the tempo, fix the meter, size the accent array. */
export function normalizeSettings(settings: Partial<MetronomeSettings>): MetronomeSettings {
  const beats = clamp(Math.floor(settings?.beats ?? 4) || 4, 1, 32);
  const rawUnit = Math.floor(settings?.unit ?? 4);
  const unit = [1, 2, 4, 8, 16].includes(rawUnit) ? rawUnit : 4;
  const subdivision = clamp(Math.floor(settings?.subdivision ?? 1) || 1, 1, 8);
  const supplied = settings?.accents ?? [];
  const fallback = defaultAccents(beats, unit);
  const accents = Array.from({ length: beats }, (_, i) =>
    ACCENT_CYCLE.includes(supplied[i]) ? supplied[i] : fallback[i],
  );

  return { bpm: clampBpm(settings?.bpm ?? DEFAULT_BPM), beats, unit, subdivision, accents };
}

/** Next level when a beat indicator is clicked. */
export function nextAccent(level: AccentLevel): AccentLevel {
  const at = ACCENT_CYCLE.indexOf(level);
  return ACCENT_CYCLE[(at + 1) % ACCENT_CYCLE.length];
}

/** Seconds between two beats — one click when no subdivision is active. */
export function beatIntervalSeconds(bpm: number): number {
  return 60 / clampBpm(bpm);
}

/** Seconds between two clicks, subdivisions included. */
export function clickIntervalSeconds(bpm: number, subdivision = 1): number {
  const divisions = clamp(Math.floor(subdivision) || 1, 1, 8);
  return beatIntervalSeconds(bpm) / divisions;
}

/** Length of one bar in seconds. */
export function barDurationSeconds(bpm: number, beats: number): number {
  return beatIntervalSeconds(bpm) * clamp(Math.floor(beats) || 4, 1, 32);
}

/**
 * Build the next `count` clicks starting at tick `startIndex`, with times measured
 * from the same origin the caller used for tick 0. The mount keeps a tick counter and
 * an AudioContext timestamp and asks for a few clicks at a time, which is how Web Audio
 * scheduling stays sample-accurate while setInterval drifts.
 */
export function buildClicks(
  settings: Partial<MetronomeSettings>,
  startIndex: number,
  count: number,
  originTime = 0,
): ScheduledClick[] {
  const s = normalizeSettings(settings);
  const first = Number.isFinite(startIndex) ? Math.max(0, Math.floor(startIndex)) : 0;
  const total = Number.isFinite(count) ? clamp(Math.floor(count), 0, 2048) : 0;
  const interval = clickIntervalSeconds(s.bpm, s.subdivision);
  const perBar = s.beats * s.subdivision;
  const origin = Number.isFinite(originTime) ? originTime : 0;

  const clicks: ScheduledClick[] = [];
  for (let i = 0; i < total; i++) {
    const index = first + i;
    const positionInBar = index % perBar;
    const beatInBar = Math.floor(positionInBar / s.subdivision);
    const subIndex = positionInBar % s.subdivision;
    const beatLevel = s.accents?.[beatInBar] ?? "normal";
    // Off-beat subdivisions always take the quiet voice, whatever the beat carries —
    // an accented sixteenth would fight the beat it belongs to.
    const level: AccentLevel =
      subIndex === 0 ? beatLevel : beatLevel === "mute" ? "mute" : "normal";
    const voice = VOICES[level];

    clicks.push({
      index,
      time: origin + index * interval,
      bar: Math.floor(index / perBar) + 1,
      beatInBar,
      subIndex,
      level,
      frequencyHz: voice.frequencyHz,
      // Subdivisions sit under the beat rather than beside it.
      gain: subIndex === 0 ? voice.gain : voice.gain * 0.45,
    });
  }

  return clicks;
}

/**
 * Average the gaps between recent taps. Taps separated by more than `resetMs` start a
 * fresh measurement, so leaving the button alone and coming back does not drag the old
 * tempo in. Only the last `window` intervals count, which keeps the reading responsive
 * when someone speeds up mid-tap.
 */
export function tapTempo(
  timestampsMs: number[],
  options: { resetMs?: number; window?: number } = {},
): TapTempoResult {
  const resetMs = options.resetMs ?? 2500;
  const window = clamp(Math.floor(options.window ?? 8), 1, 32);
  const taps = (timestampsMs ?? []).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (taps.length < 2) return { bpm: 0, taps: taps.length, averageIntervalMs: 0 };

  const intervals: number[] = [];
  for (let i = taps.length - 1; i > 0; i--) {
    const gap = taps[i] - taps[i - 1];
    if (gap <= 0 || gap > resetMs) break;
    intervals.push(gap);
    if (intervals.length >= window) break;
  }
  if (intervals.length === 0) return { bpm: 0, taps: 1, averageIntervalMs: 0 };

  const averageIntervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return {
    bpm: clampBpm(60000 / averageIntervalMs),
    taps: intervals.length + 1,
    averageIntervalMs: Math.round(averageIntervalMs),
  };
}

/** Italian tempo word for a BPM value. */
export function describeTempo(bpm: number): TempoMarking {
  const value = clampBpm(bpm);
  // The table lists whole BPM; a fractional tempo (tap tempo gives one decimal) belongs to
  // the range of its whole part, so 120.5 is still Moderato (109–120), not a gap.
  return (
    TEMPO_MARKINGS.find((m) => value >= m.from && value < m.to + 1) ??
    TEMPO_MARKINGS[TEMPO_MARKINGS.length - 1]
  );
}

/** The full tempo table, for the reference block on the tool page. */
export function tempoMarkings(): TempoMarking[] {
  return TEMPO_MARKINGS.map((m) => ({ ...m }));
}

/**
 * Note lengths in milliseconds at a given tempo, quarter note = one beat.
 * Producers use the eighth and dotted-eighth figures as delay times and the
 * whole-note figure as a reverb pre-delay reference.
 */
export function noteDurations(bpm: number): NoteDurations {
  const quarter = 60000 / clampBpm(bpm);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    whole: round(quarter * 4),
    half: round(quarter * 2),
    quarter: round(quarter),
    eighth: round(quarter / 2),
    sixteenth: round(quarter / 4),
    thirtySecond: round(quarter / 8),
    dottedHalf: round(quarter * 3),
    dottedQuarter: round(quarter * 1.5),
    dottedEighth: round(quarter * 0.75),
    tripletQuarter: round((quarter * 2) / 3),
    tripletEighth: round(quarter / 3),
  };
}

/** "4/4" for display. */
export function formatTimeSignature(beats: number, unit: number): string {
  const s = normalizeSettings({ beats, unit });
  return `${s.beats}/${s.unit}`;
}
