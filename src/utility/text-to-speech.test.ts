import { describe, expect, it } from "vitest";
import {
  type VoiceLike,
  analyzeSpeech,
  chunkText,
  clampPitch,
  clampRate,
  clampVolume,
  formatClock,
  pickDefaultVoice,
  sortVoices,
  voiceLabel,
} from "./text-to-speech.js";

// speechSynthesis itself is browser-bound (mount only); these are the pure helpers around it.

describe("analyzeSpeech", () => {
  it("returns zeroes for blank text", () => {
    expect(analyzeSpeech("   ")).toEqual({ words: 0, characters: 0, estimatedSeconds: 0 });
  });

  it("estimates duration at 150 wpm scaled by rate", () => {
    const words300 = Array(300).fill("word").join(" ");
    // 300 words / 150 wpm = 2 min = 120 s; at rate 2 -> 60 s; rate 0.5 -> 240 s
    expect(analyzeSpeech(words300).estimatedSeconds).toBe(120);
    expect(analyzeSpeech(words300, 2).estimatedSeconds).toBe(60);
    expect(analyzeSpeech(words300, 0.5).estimatedSeconds).toBe(240);
    // 3 words -> 1.2 s -> 1
    expect(analyzeSpeech("one two three")).toEqual({
      words: 3,
      characters: 13,
      estimatedSeconds: 1,
    });
  });

  it("falls back to rate 1 for invalid rates and counts untrimmed characters", () => {
    expect(analyzeSpeech(" a b ", 0)).toEqual({ words: 2, characters: 5, estimatedSeconds: 1 });
    expect(analyzeSpeech("a b", Number.NaN).estimatedSeconds).toBe(1);
  });
});

describe("chunkText", () => {
  it("returns [] for blank text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText(" \n ")).toEqual([]);
  });

  it("packs whole sentences up to the limit", () => {
    // sentences 13 + 16 + 22 chars; first two fit in 30, third starts a new chunk
    expect(chunkText("Hello world. This is a test. Another sentence here.", 30)).toEqual([
      "Hello world. This is a test.",
      "Another sentence here.",
    ]);
  });

  it("splits an over-long sentence on word boundaries", () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const chunks = chunkText(text, 20);
    expect(chunks.join(" ")).toBe(text);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(20);
  });

  it("enforces a minimum limit of 20 characters", () => {
    expect(chunkText("One two three four five six.", 5)).toEqual([
      "One two three four",
      "five six.",
    ]);
  });

  it("never exceeds the limit (except for a single over-long word) and loses no words", () => {
    const text =
      "Это первое предложение! А это второе? Третье предложение заметно длиннее остальных, чтобы проверить разбиение. Конец.";
    const chunks = chunkText(text, 40);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(40);
    expect(chunks.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
    // a single word longer than the limit is kept whole rather than cut mid-word
    expect(chunkText("x".repeat(50), 20)).toEqual(["x".repeat(50)]);
  });

  it("respects line breaks as boundaries", () => {
    expect(chunkText("Line one\nLine two", 20)).toEqual(["Line one\nLine two"]);
    expect(chunkText("First line here\nSecond line here", 20)).toEqual([
      "First line here",
      "Second line here",
    ]);
  });
});

describe("formatClock", () => {
  it("formats m:ss and rounds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(59.6)).toBe("1:00");
    expect(formatClock(3600)).toBe("60:00");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
  });
});

describe("voices", () => {
  const voices: VoiceLike[] = [
    { name: "Zira", lang: "en-US", localService: true },
    { name: "Google русский", lang: "ru-RU", localService: false },
    { name: "Google US English", lang: "en-US", localService: false, default: true },
    { name: "Irina", lang: "ru-RU", localService: true },
    { name: "Anna", lang: "de-DE", localService: true },
  ];

  it("sorts default first, then offline voices, then by language and name", () => {
    expect(sortVoices(voices).map((v) => v.name)).toEqual([
      "Google US English",
      "Anna",
      "Zira",
      "Irina",
      "Google русский",
    ]);
    // does not mutate the input
    expect(voices[0].name).toBe("Zira");
  });

  it("sorts names in the given locale", () => {
    const local: VoiceLike[] = [
      { name: "Zoe", lang: "sv-SE", localService: true },
      { name: "Äda", lang: "sv-SE", localService: true },
      { name: "Anna", lang: "sv-SE", localService: true },
    ];
    expect(sortVoices(local, "sv").map((v) => v.name)).toEqual(["Anna", "Zoe", "Äda"]);
    expect(sortVoices(local, "de").map((v) => v.name)).toEqual(["Äda", "Anna", "Zoe"]);
  });

  it("picks a voice matching the preferred language prefix", () => {
    expect(pickDefaultVoice(voices, "ru")?.name).toBe("Google русский");
    expect(pickDefaultVoice(voices, "en-GB")?.name).toBe("Zira");
    expect(pickDefaultVoice(voices, "fr")?.name).toBe("Google US English");
    expect(pickDefaultVoice([], "en")).toBeNull();
    expect(pickDefaultVoice([{ name: "X", lang: "ja-JP" }], "fr")?.name).toBe("X");
  });

  it("labels online voices", () => {
    expect(voiceLabel(voices[0])).toBe("Zira — en-US");
    expect(voiceLabel(voices[1])).toBe("Google русский — ru-RU · online");
  });
});

describe("clamps", () => {
  it("clamps rate to 0.5..2, pitch to 0..2 and volume to 0..1, defaulting to 1", () => {
    expect([clampRate(0.1), clampRate(1.3), clampRate(9), clampRate(Number.NaN)]).toEqual([
      0.5, 1.3, 2, 1,
    ]);
    expect([clampPitch(-1), clampPitch(0), clampPitch(3), clampPitch(Number.NaN)]).toEqual([
      0, 0, 2, 1,
    ]);
    expect([clampVolume(-1), clampVolume(0.4), clampVolume(2), clampVolume(Number.NaN)]).toEqual([
      0, 0.4, 1, 1,
    ]);
  });
});
