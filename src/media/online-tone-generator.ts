/**
 * Tone generator maths. No audio, no DOM — the mount layer owns the AudioContext and
 * only asks this module what frequency to play, how loud, and how to split it between
 * the two channels.
 *
 * Everything here is 12-tone equal temperament with A4 = 440 Hz, which is the pitch
 * standard ISO 16 fixed in 1955 and the one every tuner ships with. The slider mapping
 * is logarithmic because pitch perception is: the gap from 100 to 200 Hz sounds like
 * the gap from 1000 to 2000 Hz, so a linear 1–20000 slider would spend 95 % of its
 * travel above the top note of a piano.
 */

import { type NumLang, parseDecimal } from "../_num.js";

export type Waveform = "sine" | "square" | "sawtooth" | "triangle";

/** Left/right routing. "both" is the normal case. */
export type ChannelMode = "both" | "left" | "right";

export type SweepMode = "logarithmic" | "linear";

export const MIN_FREQUENCY = 1;
export const MAX_FREQUENCY = 20000;
export const DEFAULT_FREQUENCY = 440;

/** Concert pitch. Baroque ensembles use 415, some orchestras tune to 442 or 443. */
export const A4_HZ = 440;

/** Speed of sound in dry air at 20 °C, m/s — the figure used for wavelength. */
export const SPEED_OF_SOUND = 343;

/** Faders span this many decibels; below it the output is cut to true silence. */
const FADER_RANGE_DB = 60;

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * A square wave at amplitude 1 carries far more energy than a sine at amplitude 1 and
 * sounds roughly twice as loud, because all that odd-harmonic content lands in the band
 * the ear is most sensitive to. Scaling each shape down keeps a waveform switch from
 * doubling the level in your headphones mid-listen.
 */
const WAVEFORM_TRIM: Record<Waveform, number> = {
  sine: 1,
  triangle: 0.9,
  sawtooth: 0.62,
  square: 0.5,
};

export interface ToneSettings {
  frequencyHz: number;
  waveform: Waveform;
  /** 0–100, as the slider reads. */
  volume: number;
  /** -1 = hard left, 0 = centre, +1 = hard right. */
  balance: number;
  channel: ChannelMode;
}

export interface NoteName {
  /** Scientific pitch notation, e.g. "A4". */
  name: string;
  /** "A", "C#", … */
  pitchClass: string;
  octave: number;
  /** MIDI note number; 69 is A4. */
  midi: number;
  /** Exact frequency of that note in 12-TET. */
  exactHz: number;
  /** How far the tone sits from that note, in cents. Negative is flat. */
  cents: number;
  /** True when the tone is within 5 cents — the threshold tuners call "in tune". */
  inTune: boolean;
}

export interface ToneState {
  frequencyHz: number;
  waveform: Waveform;
  volume: number;
  balance: number;
  channel: ChannelMode;
  /** Linear peak amplitude the oscillator should reach, 0–1. */
  gain: number;
  /** That amplitude in dBFS. -Infinity at silence. */
  gainDb: number;
  leftGain: number;
  rightGain: number;
  note: NoteName;
  /** "440 Hz" or "1.00 kHz". */
  label: string;
  /** Wavelength in air at 20 °C, metres. */
  wavelengthMeters: number;
  periodMs: number;
  /** Slider travel, 0–1000, on the log scale. */
  sliderPosition: number;
  /** Inside the 20 Hz – 20 kHz range a healthy young ear covers. */
  audible: boolean;
  /** Below 20 Hz — felt rather than heard. */
  infrasonic: boolean;
  /** Above 20 kHz. Unreachable here, but the flag keeps the UI honest at the top end. */
  ultrasonic: boolean;
}

export interface FrequencyPreset {
  hz: number;
  label: string;
  /** Why anyone would reach for this frequency. */
  note: string;
  group: "bass" | "midrange" | "treble" | "reference";
}

export interface TuningNote {
  label: string;
  hz: number;
  note: string;
}

export interface TuningPreset {
  instrument: string;
  /** Low string or lowest note first. */
  notes: TuningNote[];
}

export interface HearingRangeRow {
  ageLabel: string;
  /** Typical highest audible frequency, Hz. */
  upperHz: number;
}

export interface SweepSettings {
  fromHz: number;
  toHz: number;
  durationSeconds: number;
  mode: SweepMode;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Keep a frequency inside the generator's range, rejecting NaN and Infinity. */
export function clampFrequency(hz: number): number {
  if (!Number.isFinite(hz)) return DEFAULT_FREQUENCY;
  return clamp(Math.round(hz * 100) / 100, MIN_FREQUENCY, MAX_FREQUENCY);
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 50;
  return clamp(Math.round(volume), 0, 100);
}

export function clampBalance(balance: number): number {
  if (!Number.isFinite(balance)) return 0;
  return clamp(Math.round(balance * 100) / 100, -1, 1);
}

export function isWaveform(value: unknown): value is Waveform {
  return value === "sine" || value === "square" || value === "sawtooth" || value === "triangle";
}

export function isChannelMode(value: unknown): value is ChannelMode {
  return value === "both" || value === "left" || value === "right";
}

export function normalizeToneSettings(settings: Partial<ToneSettings>): ToneSettings {
  return {
    frequencyHz: clampFrequency(settings?.frequencyHz ?? DEFAULT_FREQUENCY),
    waveform: isWaveform(settings?.waveform) ? settings.waveform : "sine",
    volume: clampVolume(settings?.volume ?? 50),
    balance: clampBalance(settings?.balance ?? 0),
    channel: isChannelMode(settings?.channel) ? settings.channel : "both",
  };
}

/**
 * Map a 0–1000 slider position onto 1–20000 Hz logarithmically, so one third of the
 * travel covers one third of the octaves rather than one third of the hertz. Position
 * 0 is 1 Hz, 1000 is 20 kHz, and the musically useful 100–2000 Hz region gets the
 * middle of the slider instead of the first two millimetres.
 */
export function sliderToFrequency(position: number, steps = 1000): number {
  const span = Math.max(1, Math.floor(steps));
  const pos = Number.isFinite(position) ? clamp(position, 0, span) : 0;
  const ratio = pos / span;
  const hz = MIN_FREQUENCY * (MAX_FREQUENCY / MIN_FREQUENCY) ** ratio;
  return clampFrequency(hz);
}

/** Inverse of sliderToFrequency. */
export function frequencyToSlider(hz: number, steps = 1000): number {
  const span = Math.max(1, Math.floor(steps));
  const value = clampFrequency(hz);
  const ratio = Math.log(value / MIN_FREQUENCY) / Math.log(MAX_FREQUENCY / MIN_FREQUENCY);
  return Math.round(clamp(ratio, 0, 1) * span);
}

/** Frequency of a MIDI note number in 12-TET. 69 → 440 Hz. */
export function midiToFrequency(midi: number, a4 = A4_HZ): number {
  const base = Number.isFinite(a4) && a4 > 0 ? a4 : A4_HZ;
  return base * 2 ** ((midi - 69) / 12);
}

/**
 * Nearest equal-tempered note, plus the deviation in cents. A cent is a hundredth of
 * a semitone; trained listeners notice about 5–10 cents on a sustained tone, which is
 * why `inTune` uses a 5-cent window.
 */
export function noteFromFrequency(hz: number, a4 = A4_HZ): NoteName {
  const value = clampFrequency(hz);
  const base = Number.isFinite(a4) && a4 > 0 ? a4 : A4_HZ;
  const exactMidi = 69 + 12 * Math.log2(value / base);
  const midi = Math.round(exactMidi);
  const cents = Math.round((exactMidi - midi) * 100);
  const pitchClass = PITCH_CLASSES[((midi % 12) + 12) % 12];
  // MIDI 60 is C4 in scientific pitch notation, so the octave is floor(midi/12) - 1.
  const octave = Math.floor(midi / 12) - 1;

  return {
    name: `${pitchClass}${octave}`,
    pitchClass,
    octave,
    midi,
    exactHz: Math.round(midiToFrequency(midi, base) * 100) / 100,
    cents,
    inTune: Math.abs(cents) <= 5,
  };
}

/**
 * Read "A4", "c#3", "Bb5", "F♯2" into a frequency. Returns null when the text is not a
 * note, so the caller can fall back to parsing it as a number of hertz instead.
 */
export function parseNote(input: string, a4 = A4_HZ): number | null {
  const match = /^\s*([A-Ga-g])\s*([#♯bB♭]?)\s*(-?\d{1,2})\s*$/.exec(input ?? "");
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const naturals: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidental = match[2];
  // A bare lowercase "b" after the letter is a flat; "B" is ambiguous in theory but
  // nobody writes "AB4" meaning A natural, so both spellings lower the note.
  const shift = accidental === "#" || accidental === "♯" ? 1 : accidental ? -1 : 0;
  const octave = Number.parseInt(match[3], 10);
  const midi = (octave + 1) * 12 + naturals[letter] + shift;
  if (midi < 0 || midi > 136) return null;

  const hz = midiToFrequency(midi, a4);
  if (hz < MIN_FREQUENCY || hz > MAX_FREQUENCY) return null;
  return Math.round(hz * 100) / 100;
}

/**
 * Accept either a raw frequency ("432", "1.5k", "2 kHz", "1,000 Hz") or a note
 * name ("A4"). Returns null when neither reading works.
 *
 * The number is read in the page language (`parseDecimal`): on EN "1,000" is a
 * thousand, on RU "1,000" is one (a decimal comma), and "17,4" is 17.4 in both.
 */
export function parseFrequencyInput(
  input: string,
  a4 = A4_HZ,
  lang: NumLang = "en",
): number | null {
  const text = (input ?? "").trim();
  if (!text) return null;

  const note = parseNote(text, a4);
  if (note !== null) return note;

  const unit = /^(.*?)\s*(k)?(?:hz)?$/i.exec(text);
  if (!unit || !/^[\d\s\u00a0\u202f.,]+$/.test(unit[1])) return null;
  const parsed = parseDecimal(unit[1], lang);
  if (!parsed.ok) return null;
  const hz = parsed.value * (unit[2] ? 1000 : 1);
  return Number.isFinite(hz) ? clampFrequency(hz) : null;
}

/** Move a frequency by whole semitones, staying in tune with wherever it started. */
export function transposeSemitones(hz: number, semitones: number): number {
  const steps = Number.isFinite(semitones) ? semitones : 0;
  return clampFrequency(clampFrequency(hz) * 2 ** (steps / 12));
}

/** Move a frequency by cents. 100 cents is a semitone. */
export function transposeCents(hz: number, cents: number): number {
  const steps = Number.isFinite(cents) ? cents : 0;
  return clampFrequency(clampFrequency(hz) * 2 ** (steps / 1200));
}

/**
 * Fader taper: a 60 dB range, so 100 is full scale and 50 sits at -30 dB. Audio faders
 * are logarithmic because loudness perception is, and a linear fader wastes its bottom
 * half on levels you cannot tell apart. Zero is hard silence, not -60 dB.
 */
export function volumeToGain(volume: number, waveform: Waveform = "sine"): number {
  const v = clampVolume(volume);
  if (v <= 0) return 0;
  const db = ((v - 100) / 100) * FADER_RANGE_DB;
  const trim = WAVEFORM_TRIM[waveform] ?? 1;
  return Math.round(10 ** (db / 20) * trim * 100000) / 100000;
}

export function gainToDb(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return Number.NEGATIVE_INFINITY;
  return Math.round(20 * Math.log10(gain) * 10) / 10;
}

/**
 * Constant-power panning: the two gains are cos and sin of the same angle, so their
 * squares sum to 1 and the tone does not dip in level as it crosses the centre. A
 * naive linear pan loses about 3 dB in the middle, which is audible on a sweep.
 * `channel` hard-mutes a side on top of that, for checking which speaker is which.
 */
export function panGains(
  balance: number,
  channel: ChannelMode = "both",
): {
  left: number;
  right: number;
} {
  const b = clampBalance(balance);
  const angle = ((b + 1) / 2) * (Math.PI / 2);
  const round = (n: number) => Math.round(n * 10000) / 10000;
  let left = round(Math.cos(angle));
  let right = round(Math.sin(angle));
  if (channel === "left") right = 0;
  if (channel === "right") left = 0;
  return { left, right };
}

/** "440 Hz" below a kilohertz, "1.00 kHz" above it — how audio gear prints it. */
export function formatFrequency(hz: number): string {
  const value = clampFrequency(hz);
  if (value >= 1000) return `${(value / 1000).toFixed(2)} kHz`;
  if (value >= 100) return `${Math.round(value)} Hz`;
  if (value >= 10) return `${Math.round(value * 10) / 10} Hz`;
  return `${Math.round(value * 100) / 100} Hz`;
}

/** Wavelength in air at 20 °C. 20 Hz is 17 m, which is why bass needs a big room. */
export function wavelengthMeters(hz: number): number {
  const value = clampFrequency(hz);
  return Math.round((SPEED_OF_SOUND / value) * 1000) / 1000;
}

export function periodMs(hz: number): number {
  const value = clampFrequency(hz);
  const ms = 1000 / value;
  return Math.round(ms * 1000) / 1000;
}

/** Everything the UI needs to draw one state of the generator. */
export function describeTone(settings: Partial<ToneSettings>): ToneState {
  const s = normalizeToneSettings(settings);
  const gain = volumeToGain(s.volume, s.waveform);
  const { left, right } = panGains(s.balance, s.channel);

  return {
    frequencyHz: s.frequencyHz,
    waveform: s.waveform,
    volume: s.volume,
    balance: s.balance,
    channel: s.channel,
    gain,
    gainDb: gainToDb(gain),
    leftGain: Math.round(left * gain * 10000) / 10000,
    rightGain: Math.round(right * gain * 10000) / 10000,
    note: noteFromFrequency(s.frequencyHz),
    label: formatFrequency(s.frequencyHz),
    wavelengthMeters: wavelengthMeters(s.frequencyHz),
    periodMs: periodMs(s.frequencyHz),
    sliderPosition: frequencyToSlider(s.frequencyHz),
    audible: s.frequencyHz >= 20 && s.frequencyHz <= 20000,
    infrasonic: s.frequencyHz < 20,
    ultrasonic: s.frequencyHz > 20000,
  };
}

/**
 * Frequency at a moment inside a sweep. A logarithmic sweep spends equal time per
 * octave, which is what you want for a speaker or hearing check — a linear sweep from
 * 20 Hz to 20 kHz gives the bottom three octaves under a tenth of a second each.
 */
export function sweepFrequencyAt(settings: Partial<SweepSettings>, elapsedSeconds: number): number {
  const s = normalizeSweep(settings);
  const t = Number.isFinite(elapsedSeconds) ? clamp(elapsedSeconds, 0, s.durationSeconds) : 0;
  const ratio = s.durationSeconds > 0 ? t / s.durationSeconds : 1;
  if (s.mode === "linear") return clampFrequency(s.fromHz + (s.toHz - s.fromHz) * ratio);
  return clampFrequency(s.fromHz * (s.toHz / s.fromHz) ** ratio);
}

export function normalizeSweep(settings: Partial<SweepSettings>): SweepSettings {
  return {
    fromHz: clampFrequency(settings?.fromHz ?? 20),
    toHz: clampFrequency(settings?.toHz ?? 20000),
    durationSeconds: clamp(
      Number.isFinite(settings?.durationSeconds) ? (settings?.durationSeconds as number) : 10,
      0.5,
      300,
    ),
    mode: settings?.mode === "linear" ? "linear" : "logarithmic",
  };
}

/** Octaves covered by a sweep — a 20 Hz to 20 kHz sweep is just under ten. */
export function sweepOctaves(settings: Partial<SweepSettings>): number {
  const s = normalizeSweep(settings);
  return Math.round(Math.abs(Math.log2(s.toHz / s.fromHz)) * 100) / 100;
}

/**
 * The frequencies people actually come looking for. 1 kHz is the audiometric and
 * line-up reference; 4 kHz is where noise-induced hearing loss carves its notch;
 * 17.4 kHz is the tone the Mosquito teen deterrent uses.
 */
export function frequencyPresets(): FrequencyPreset[] {
  return [
    { hz: 10, label: "10 Hz", note: "Infrasound — felt, not heard", group: "bass" },
    { hz: 20, label: "20 Hz", note: "Bottom of the audible range", group: "bass" },
    { hz: 30, label: "30 Hz", note: "Subwoofer reach test", group: "bass" },
    { hz: 50, label: "50 Hz", note: "Mains hum, Europe and Asia", group: "bass" },
    { hz: 60, label: "60 Hz", note: "Mains hum, North America", group: "bass" },
    { hz: 100, label: "100 Hz", note: "Low bass, port tuning", group: "bass" },
    { hz: 200, label: "200 Hz", note: "Upper bass, room boom", group: "bass" },
    { hz: 440, label: "440 Hz", note: "A4 concert pitch (ISO 16)", group: "reference" },
    { hz: 1000, label: "1 kHz", note: "Audiometry and line-up reference", group: "reference" },
    { hz: 2000, label: "2 kHz", note: "Speech clarity band", group: "midrange" },
    { hz: 3000, label: "3 kHz", note: "Peak ear sensitivity", group: "midrange" },
    { hz: 4000, label: "4 kHz", note: "Noise-damage notch", group: "treble" },
    { hz: 8000, label: "8 kHz", note: "Sibilance, cymbal shimmer", group: "treble" },
    { hz: 12000, label: "12 kHz", note: "Air band", group: "treble" },
    { hz: 15000, label: "15 kHz", note: "CRT flyback whine", group: "treble" },
    { hz: 17400, label: "17.4 kHz", note: "Mosquito teen deterrent", group: "treble" },
    { hz: 19000, label: "19 kHz", note: "Most adults hear nothing", group: "treble" },
    { hz: 20000, label: "20 kHz", note: "Top of the audible range", group: "treble" },
  ];
}

/** Open-string and reference pitches, for tuning by ear against a steady tone. */
export function tuningPresets(): TuningPreset[] {
  return [
    {
      instrument: "Guitar (standard EADGBE)",
      notes: [
        { label: "6th", note: "E2", hz: 82.41 },
        { label: "5th", note: "A2", hz: 110.0 },
        { label: "4th", note: "D3", hz: 146.83 },
        { label: "3rd", note: "G3", hz: 196.0 },
        { label: "2nd", note: "B3", hz: 246.94 },
        { label: "1st", note: "E4", hz: 329.63 },
      ],
    },
    {
      instrument: "Bass guitar (EADG)",
      notes: [
        { label: "4th", note: "E1", hz: 41.2 },
        { label: "3rd", note: "A1", hz: 55.0 },
        { label: "2nd", note: "D2", hz: 73.42 },
        { label: "1st", note: "G2", hz: 98.0 },
      ],
    },
    {
      instrument: "Violin (GDAE)",
      notes: [
        { label: "4th", note: "G3", hz: 196.0 },
        { label: "3rd", note: "D4", hz: 293.66 },
        { label: "2nd", note: "A4", hz: 440.0 },
        { label: "1st", note: "E5", hz: 659.25 },
      ],
    },
    {
      instrument: "Ukulele (gCEA)",
      notes: [
        { label: "4th", note: "G4", hz: 392.0 },
        { label: "3rd", note: "C4", hz: 261.63 },
        { label: "2nd", note: "E4", hz: 329.63 },
        { label: "1st", note: "A4", hz: 440.0 },
      ],
    },
    {
      instrument: "Cello (CGDA)",
      notes: [
        { label: "4th", note: "C2", hz: 65.41 },
        { label: "3rd", note: "G2", hz: 98.0 },
        { label: "2nd", note: "D3", hz: 146.83 },
        { label: "1st", note: "A3", hz: 220.0 },
      ],
    },
  ];
}

/**
 * Rough upper limits of hearing by age. High-frequency loss with age (presbycusis) is
 * universal and starts in your twenties, so these are averages with a wide spread —
 * noise exposure moves them far more than birthdays do.
 */
export function hearingRangeByAge(): HearingRangeRow[] {
  return [
    { ageLabel: "Under 18", upperHz: 20000 },
    { ageLabel: "18–24", upperHz: 17500 },
    { ageLabel: "25–29", upperHz: 16500 },
    { ageLabel: "30–39", upperHz: 15500 },
    { ageLabel: "40–49", upperHz: 14000 },
    { ageLabel: "50–59", upperHz: 12000 },
    { ageLabel: "60 and over", upperHz: 10000 },
  ];
}
