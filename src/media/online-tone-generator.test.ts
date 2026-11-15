import { describe, expect, it } from "vitest";
import {
  DEFAULT_FREQUENCY,
  clampBalance,
  clampFrequency,
  clampVolume,
  describeTone,
  formatFrequency,
  frequencyPresets,
  frequencyToSlider,
  gainToDb,
  hearingRangeByAge,
  isChannelMode,
  isWaveform,
  midiToFrequency,
  normalizeSweep,
  normalizeToneSettings,
  noteFromFrequency,
  panGains,
  parseFrequencyInput,
  parseNote,
  periodMs,
  sliderToFrequency,
  sweepFrequencyAt,
  sweepOctaves,
  transposeCents,
  transposeSemitones,
  tuningPresets,
  volumeToGain,
  wavelengthMeters,
} from "./online-tone-generator.js";

// The OscillatorNode / StereoPannerNode graph is built in the mount; all the numbers
// it is fed come from here.

describe("clamps and guards", () => {
  it("clamps frequency to 1–20000 Hz with 0.01 Hz precision", () => {
    expect(clampFrequency(Number.NaN)).toBe(DEFAULT_FREQUENCY);
    expect(clampFrequency(0)).toBe(1);
    expect(clampFrequency(99999)).toBe(20000);
    expect(clampFrequency(440.126)).toBe(440.13);
  });

  it("clamps volume and balance", () => {
    expect(clampVolume(Number.NaN)).toBe(50);
    expect(clampVolume(120)).toBe(100);
    expect(clampVolume(-3)).toBe(0);
    expect(clampVolume(33.6)).toBe(34);
    expect(clampBalance(Number.NaN)).toBe(0);
    expect(clampBalance(-7)).toBe(-1);
    expect(clampBalance(0.333)).toBe(0.33);
  });

  it("validates waveform and channel names", () => {
    expect(isWaveform("square")).toBe(true);
    expect(isWaveform("noise")).toBe(false);
    expect(isChannelMode("left")).toBe(true);
    expect(isChannelMode("center")).toBe(false);
    expect(normalizeToneSettings({ waveform: "noise" as "sine", channel: "x" as "both" })).toEqual({
      frequencyHz: 440,
      waveform: "sine",
      volume: 50,
      balance: 0,
      channel: "both",
    });
  });
});

describe("log slider", () => {
  it("maps the ends and the middle of the slider", () => {
    expect(sliderToFrequency(0)).toBe(1);
    expect(sliderToFrequency(1000)).toBe(20000);
    // middle = sqrt(1 · 20000) = 141.42 Hz
    expect(sliderToFrequency(500)).toBe(141.42);
    expect(sliderToFrequency(-50)).toBe(1);
    expect(sliderToFrequency(Number.NaN)).toBe(1);
  });

  it("inverts back to a slider position", () => {
    // ln 440 / ln 20000 = 0.6146 -> 615
    expect(frequencyToSlider(440)).toBe(615);
    expect(frequencyToSlider(1)).toBe(0);
    expect(frequencyToSlider(20000)).toBe(1000);
    for (const pos of [0, 123, 500, 877, 1000]) {
      expect(frequencyToSlider(sliderToFrequency(pos))).toBe(pos);
    }
  });
});

describe("notes", () => {
  it("converts MIDI numbers in 12-TET", () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(81)).toBe(880);
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 4);
    expect(midiToFrequency(69, 432)).toBe(432);
    expect(midiToFrequency(69, -1)).toBe(440);
  });

  it("names the nearest note with the cents offset", () => {
    expect(noteFromFrequency(440)).toEqual({
      name: "A4",
      pitchClass: "A",
      octave: 4,
      midi: 69,
      exactHz: 440,
      cents: 0,
      inTune: true,
    });
    expect(noteFromFrequency(261.63)).toMatchObject({ name: "C4", midi: 60, exactHz: 261.63 });
    expect(noteFromFrequency(27.5)).toMatchObject({ name: "A0", midi: 21 });
    // 445 Hz: 1200·log2(445/440) = +19.6 cents
    expect(noteFromFrequency(445)).toMatchObject({ name: "A4", cents: 20, inTune: false });
    // 466.16 Hz is A#4
    const aSharp = noteFromFrequency(466.16);
    expect(aSharp.name).toBe("A#4");
    expect(Math.abs(aSharp.cents)).toBe(0); // may be -0, which prints as "0"
  });

  it("parses note names with sharps and flats", () => {
    expect(parseNote("A4")).toBe(440);
    expect(parseNote(" c#3 ")).toBe(138.59);
    expect(parseNote("Bb4")).toBe(466.16);
    expect(parseNote("F♯2")).toBe(92.5);
    expect(parseNote("E♭5")).toBe(622.25);
    expect(parseNote("B#4")).toBe(523.25); // = C5
    expect(parseNote("Cb4")).toBe(246.94); // = B3
    expect(parseNote("H4")).toBeNull();
    expect(parseNote("A")).toBeNull();
    expect(parseNote("C11")).toBeNull(); // above 20 kHz
    expect(parseNote("A4", 432)).toBe(432);
  });

  it("matches every tuning preset to its note name (within 0.01 Hz of 12-TET)", () => {
    for (const preset of tuningPresets()) {
      for (const n of preset.notes) {
        // Published tables truncate E5 = 659.2551 to 659.25; 0.005 Hz is 0.01 cents.
        expect(
          Math.abs((parseNote(n.note) ?? 0) - n.hz),
          `${preset.instrument} ${n.note}`,
        ).toBeLessThanOrEqual(0.0101);
      }
    }
  });
});

describe("parseFrequencyInput", () => {
  it.each([
    ["432", 432],
    ["440hz", 440],
    ["440 Hz", 440],
    ["1.5k", 1500],
    ["1,5k", 1500],
    ["2 kHz", 2000],
    ["17,4 khz", 17400],
    ["25000", 20000],
    ["0", 1],
    ["A4", 440],
  ])("%s -> %d", (input, hz) => {
    expect(parseFrequencyInput(input)).toBe(hz);
  });

  it.each(["", "   ", "abc", "-5", "1.5.3", "5 MHz"])("%j -> null", (input) => {
    expect(parseFrequencyInput(input)).toBeNull();
  });

  // "1,000" on the EN page is 1000 Hz, not 1 Hz (which a naive comma swap would give).
  it.each([
    ["1,000", "en", 1000],
    ["1,000 Hz", "en", 1000],
    ["1 000 Hz", "en", 1000],
    ["1,000", "ru", 1],
    ["1 000", "ru", 1000],
    ["17,4 kHz", "ru", 17400],
    ["432,5", "ru", 432.5],
    ["432.5", "ru", 432.5],
  ] as const)("%j on %s -> %d", (input, lang, hz) => {
    expect(parseFrequencyInput(input, undefined, lang)).toBe(hz);
  });
});

describe("transposition", () => {
  it("moves by semitones and cents", () => {
    expect(transposeSemitones(440, 12)).toBe(880);
    expect(transposeSemitones(440, -12)).toBe(220);
    expect(transposeSemitones(440, 1)).toBe(466.16);
    expect(transposeSemitones(440, Number.NaN)).toBe(440);
    expect(transposeCents(440, 1200)).toBe(880);
    // +10 cents: 440 · 2^(10/1200) = 442.55
    expect(transposeCents(440, 10)).toBe(442.55);
    expect(transposeSemitones(15000, 24)).toBe(20000);
  });
});

describe("levels and panning", () => {
  /** cos 45° = sin 45° rounded to the 4 decimals the engine reports. */
  const HALF = Math.round(Math.SQRT1_2 * 1e4) / 1e4;

  it("uses a 60 dB fader taper with per-waveform trim", () => {
    expect(volumeToGain(100)).toBe(1);
    // 50 -> -30 dB -> 10^(-1.5) = 0.031623
    expect(volumeToGain(50)).toBe(0.03162);
    expect(volumeToGain(100, "square")).toBe(0.5);
    expect(volumeToGain(100, "sawtooth")).toBe(0.62);
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBeGreaterThan(0);
  });

  it("converts gain to dBFS", () => {
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0.5)).toBe(-6);
    expect(gainToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(gainToDb(Number.NaN)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("pans with constant power", () => {
    const c = panGains(0);
    expect(c).toEqual({ left: HALF, right: HALF });
    expect(panGains(-1)).toEqual({ left: 1, right: 0 });
    expect(panGains(1)).toEqual({ left: 0, right: 1 });
    const q = panGains(0.5);
    expect(q.left ** 2 + q.right ** 2).toBeCloseTo(1, 3);
  });

  it("hard-mutes a side when a channel is chosen", () => {
    expect(panGains(0, "left")).toEqual({ left: HALF, right: 0 });
    expect(panGains(0, "right")).toEqual({ left: 0, right: HALF });
  });
});

describe("display helpers", () => {
  it("formats frequencies like audio gear", () => {
    expect(formatFrequency(440)).toBe("440 Hz");
    expect(formatFrequency(1000)).toBe("1.00 kHz");
    expect(formatFrequency(17400)).toBe("17.40 kHz");
    expect(formatFrequency(55.55)).toBe("55.6 Hz");
    expect(formatFrequency(1.234)).toBe("1.23 Hz");
  });

  it("computes wavelength at 343 m/s and period", () => {
    expect(wavelengthMeters(343)).toBe(1);
    expect(wavelengthMeters(20)).toBe(17.15);
    expect(periodMs(440)).toBe(2.273);
    expect(periodMs(1000)).toBe(1);
  });

  it("describes a full tone state (hand-computed)", () => {
    const t = describeTone({ frequencyHz: 10, volume: 100, waveform: "square", balance: 0 });
    expect(t).toMatchObject({
      frequencyHz: 10,
      gain: 0.5,
      gainDb: -6,
      label: "10 Hz",
      wavelengthMeters: 34.3,
      periodMs: 100,
      audible: false,
      infrasonic: true,
      ultrasonic: false,
    });
    // 0.7071 · 0.5 = 0.35355 (pan gain is rounded before scaling)
    expect(t.leftGain).toBeCloseTo(0.35355, 3);
    expect(t.rightGain).toBe(t.leftGain);
    expect(describeTone({}).note.name).toBe("A4");
  });
});

describe("sweeps", () => {
  it("sweeps logarithmically by default", () => {
    // halfway through 20 Hz -> 20 kHz: 20 · 1000^0.5 = 632.46
    expect(sweepFrequencyAt({ fromHz: 20, toHz: 20000, durationSeconds: 10 }, 5)).toBe(632.46);
    expect(sweepFrequencyAt({}, 0)).toBe(20);
    expect(sweepFrequencyAt({}, 999)).toBe(20000);
    expect(sweepFrequencyAt({}, Number.NaN)).toBe(20);
  });

  it("sweeps linearly when asked, and downwards too", () => {
    expect(sweepFrequencyAt({ fromHz: 20, toHz: 20000, mode: "linear" }, 5)).toBe(10010);
    expect(sweepFrequencyAt({ fromHz: 1000, toHz: 100, durationSeconds: 2 }, 1)).toBe(316.23);
  });

  it("normalises sweep settings and counts octaves", () => {
    expect(normalizeSweep({ durationSeconds: 0, mode: "x" as "linear" })).toEqual({
      fromHz: 20,
      toHz: 20000,
      durationSeconds: 0.5,
      mode: "logarithmic",
    });
    expect(normalizeSweep({ durationSeconds: 1000 }).durationSeconds).toBe(300);
    // log2(1000) = 9.97
    expect(sweepOctaves({})).toBe(9.97);
    expect(sweepOctaves({ fromHz: 880, toHz: 220 })).toBe(2);
  });
});

describe("reference tables", () => {
  it("frequency presets stay inside the generator range", () => {
    for (const p of frequencyPresets()) {
      expect(clampFrequency(p.hz)).toBe(p.hz);
    }
  });

  it("hearing range falls with age", () => {
    const rows = hearingRangeByAge().map((r) => r.upperHz);
    expect([...rows].sort((a, b) => b - a)).toEqual(rows);
  });
});
