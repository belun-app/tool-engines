import { describe, expect, it } from "vitest";
import {
  CHARS_PER_WORD_RU,
  MAX_WPM,
  MIN_WPM,
  SILENT_READING_WPM,
  SILENT_READING_WPM_RU,
  SPEECH_PACE_WPM,
  clampWpm,
  countSpeechWords,
  parseLocaleNumber,
  targetSecondsFrom,
  wordsFromCharacters,
  wordsToMinutes,
} from "./words-to-minutes-calculator.js";

describe("constants", () => {
  it("match the documented paces", () => {
    expect(SPEECH_PACE_WPM).toEqual({ slow: 110, average: 140, fast: 180 });
    expect(SILENT_READING_WPM).toBe(238);
    expect([MIN_WPM, MAX_WPM]).toEqual([50, 400]);
  });
});

describe("clampWpm", () => {
  it("falls back to the average pace for missing or non-finite input", () => {
    expect(clampWpm(undefined)).toBe(140);
    expect(clampWpm(Number.NaN)).toBe(140);
    expect(clampWpm(Number.POSITIVE_INFINITY)).toBe(140);
  });

  it("clamps to 50..400 and rounds", () => {
    expect(clampWpm(10)).toBe(50);
    expect(clampWpm(-5)).toBe(50);
    expect(clampWpm(1000)).toBe(400);
    expect(clampWpm(123.6)).toBe(124);
    expect(clampWpm(150)).toBe(150);
  });
});

describe("countSpeechWords", () => {
  it("returns 0 for empty or whitespace input", () => {
    expect(countSpeechWords("")).toBe(0);
    expect(countSpeechWords("  \n\t ")).toBe(0);
  });

  it("does not count tokens without a letter or digit", () => {
    // "Hello", "world", "42" — the dash, ellipsis, "!" and emoji are not spoken
    expect(countSpeechWords("Hello — world ... 42 ! 👋")).toBe(3);
  });

  it("counts Cyrillic words", () => {
    expect(countSpeechWords("Привет, мир! Как дела?")).toBe(4);
  });
});

describe("wordsToMinutes — words to time", () => {
  it("returns zero timings for empty input", () => {
    const r = wordsToMinutes({ direction: "wordsToTime", text: "" });
    expect(r.words).toBe(0);
    expect(r.headline.totalSeconds).toBe(0);
    expect(r.headline.clock).toBe("0:00");
    expect(r.scriptPages).toBe(0);
  });

  it("times a pasted script at each pace", () => {
    // 3 words at 140 wpm = 3/140*60 = 1.29 s -> 1 s
    const r = wordsToMinutes({ direction: "wordsToTime", text: "one two three" });
    expect(r.words).toBe(3);
    expect(r.characters).toBe(13);
    expect(r.wpm).toBe(140);
    expect(r.headline.totalSeconds).toBe(1);
    expect(r.headline.clock).toBe("0:01");
  });

  it("uses an explicit word count when no text is given", () => {
    // 280 words: avg 280/140*60 = 120 s; slow 280/110*60 = 152.7 -> 153 s;
    // fast 280/180*60 = 93.3 -> 93 s; silent 280/238*60 = 70.6 -> 71 s
    const r = wordsToMinutes({ direction: "wordsToTime", words: 280 });
    expect(r.average.totalSeconds).toBe(120);
    expect(r.average.clock).toBe("2:00");
    expect(r.slow.totalSeconds).toBe(153);
    expect(r.slow.clock).toBe("2:33");
    expect(r.fast.totalSeconds).toBe(93);
    expect(r.fast.clock).toBe("1:33");
    expect(r.silentReading.totalSeconds).toBe(71);
    // 280/250 = 1.12 -> 1.1 pages
    expect(r.scriptPages).toBe(1.1);
  });

  it("formats over an hour as h:mm:ss", () => {
    // 9000 words at 140 wpm = 3857.14 s -> 3857 s = 1 h 4 min 17 s
    const r = wordsToMinutes({ direction: "wordsToTime", words: 9000 });
    expect(r.headline).toMatchObject({ hours: 1, minutes: 4, seconds: 17, clock: "1:04:17" });
  });

  it("uses a custom pace for the headline only", () => {
    // 100 words at 200 wpm = 30 s
    const r = wordsToMinutes({ direction: "wordsToTime", words: 100, wpm: 200 });
    expect(r.headline.totalSeconds).toBe(30);
    expect(r.headline.wpm).toBe(200);
    expect(r.average.wpm).toBe(140);
  });

  it("text overrides words; fractional and negative word counts are sanitised", () => {
    expect(wordsToMinutes({ direction: "wordsToTime", text: "a b", words: 500 }).words).toBe(2);
    expect(wordsToMinutes({ direction: "wordsToTime", words: 250.7 }).words).toBe(250);
    expect(wordsToMinutes({ direction: "wordsToTime", words: -10 }).words).toBe(0);
    expect(wordsToMinutes({ direction: "wordsToTime", words: Number.NaN }).words).toBe(0);
  });

  it("treats an unknown direction as words-to-time", () => {
    const r = wordsToMinutes({ direction: "bogus" as never, words: 140 });
    expect(r.direction).toBe("wordsToTime");
    expect(r.headline.totalSeconds).toBe(60);
  });
});

describe("wordsToMinutes — time to words", () => {
  it("computes words needed to fill the target at each pace", () => {
    // 90 s = 1.5 min: avg 1.5*140 = 210; slow 1.5*110 = 165; fast 1.5*180 = 270
    const r = wordsToMinutes({ direction: "timeToWords", targetSeconds: 90 });
    expect(r.words).toBe(210);
    expect(r.wordsAtSlow).toBe(165);
    expect(r.wordsAtAverage).toBe(210);
    expect(r.wordsAtFast).toBe(270);
    expect(r.characters).toBe(0);
    // headline echoes the target exactly
    expect(r.headline).toMatchObject({ totalSeconds: 90, minutes: 1, seconds: 30, clock: "1:30" });
    // 210/250 = 0.84 -> 0.8
    expect(r.scriptPages).toBe(0.8);
  });

  it("returns zero words for a zero, negative or missing target", () => {
    for (const targetSeconds of [0, -30, undefined, Number.NaN]) {
      const r = wordsToMinutes({ direction: "timeToWords", targetSeconds });
      expect(r.words).toBe(0);
      expect(r.headline.clock).toBe("0:00");
    }
  });

  it("ignores pasted text in time-to-words mode", () => {
    const r = wordsToMinutes({ direction: "timeToWords", targetSeconds: 60, text: "a b c" });
    expect(r.words).toBe(140);
  });
});

describe("rounding, custom pace, targets and number parsing", () => {
  it("never rounds a non-empty script down to 0:00", () => {
    const r = wordsToMinutes({ direction: "wordsToTime", words: 1 });
    expect(r.average.totalSeconds).toBe(1);
    expect(r.average.clock).toBe("0:01");
    expect(wordsToMinutes({ direction: "wordsToTime", words: 0 }).average.totalSeconds).toBe(0);
  });

  it("times silent reading at a custom pace (Russian norm 184 wpm)", () => {
    expect(SILENT_READING_WPM_RU).toBe(184);
    const r = wordsToMinutes({ direction: "wordsToTime", words: 1000, readingWpm: 184 });
    expect(r.silentReading.clock).toBe("5:26");
    expect(wordsToMinutes({ direction: "wordsToTime", words: 1000 }).silentReading.clock).toBe(
      "4:12",
    );
  });

  it("negative minutes or seconds never shrink the target; seconds roll over", () => {
    expect(targetSecondsFrom(5, -30)).toBe(300);
    expect(targetSecondsFrom(-2, 30)).toBe(30);
    expect(targetSecondsFrom(0, 90)).toBe(90);
    expect(targetSecondsFrom(2.5, 0)).toBe(150);
    expect(targetSecondsFrom(Number.NaN, Number.NaN)).toBe(0);
  });

  it("parses numbers the way each language writes them", () => {
    expect(parseLocaleNumber("1,000", "en")).toBe(1000);
    expect(parseLocaleNumber("1,000.5", "en")).toBe(1000.5);
    expect(parseLocaleNumber("2.5", "en")).toBe(2.5);
    expect(parseLocaleNumber("1 000", "ru")).toBe(1000);
    expect(parseLocaleNumber(`1${String.fromCharCode(0xa0)}000`, "ru")).toBe(1000);
    expect(parseLocaleNumber("2,5", "ru")).toBe(2.5);
    expect(parseLocaleNumber("2.5", "ru")).toBe(2.5);
    expect(parseLocaleNumber("-30", "en")).toBe(-30);
    expect(parseLocaleNumber("", "ru")).toBeNaN();
    expect(parseLocaleNumber("abc", "en")).toBeNaN();
  });

  it("turns a Russian character count into words", () => {
    expect(wordsFromCharacters(6500)).toBe(1000);
    expect(wordsFromCharacters(1000)).toBe(154);
    expect(wordsFromCharacters(0)).toBe(0);
    expect(wordsFromCharacters(-5)).toBe(0);
    expect(CHARS_PER_WORD_RU).toBe(6.5);
  });
});
