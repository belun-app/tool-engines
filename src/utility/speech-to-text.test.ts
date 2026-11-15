import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  analyzeTranscript,
  appendChunk,
  applySpokenPunctuation,
  capitalizeSentences,
  confidencePercent,
  defaultLanguage,
  formatClock,
  isRightToLeft,
  transcriptFilename,
} from "./speech-to-text.js";

// SpeechRecognition itself is browser-bound (mount only); transcript assembly is tested here.

describe("languages", () => {
  it("has unique BCP-47 codes", () => {
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });

  it("maps a page locale to the closest supported language", () => {
    expect(defaultLanguage("ru")).toBe("ru-RU");
    expect(defaultLanguage("en")).toBe("en-US");
    expect(defaultLanguage("en-GB")).toBe("en-GB");
    expect(defaultLanguage("EN-gb")).toBe("en-GB");
    expect(defaultLanguage("pt-PT")).toBe("pt-BR");
    expect(defaultLanguage("xx-YY")).toBe("en-US");
    expect(defaultLanguage("")).toBe("en-US");
  });

  it("flags right-to-left languages", () => {
    expect(isRightToLeft("ar-SA")).toBe(true);
    expect(isRightToLeft("he-IL")).toBe(true);
    expect(isRightToLeft("fa")).toBe(true);
    expect(isRightToLeft("en-US")).toBe(false);
    expect(isRightToLeft("")).toBe(false);
  });
});

describe("applySpokenPunctuation (English)", () => {
  it("turns spoken marks into characters, swallowing the space before", () => {
    expect(applySpokenPunctuation("hello comma world period")).toBe("hello, world.");
    expect(applySpokenPunctuation("really question mark yes exclamation mark")).toBe(
      "really? yes!",
    );
    expect(applySpokenPunctuation("note colon one semicolon two")).toBe("note: one; two");
    expect(applySpokenPunctuation("wait ellipsis")).toBe("wait…");
    expect(applySpokenPunctuation("he said open quote hi close quote")).toBe("he said «hi»");
    expect(applySpokenPunctuation("see open paren below close paren")).toBe("see (below)");
  });

  it("handles line and paragraph breaks (two-word phrases first)", () => {
    expect(applySpokenPunctuation("one new line two")).toBe("one\ntwo");
    expect(applySpokenPunctuation("one new paragraph two")).toBe("one\n\ntwo");
  });

  it("is case-insensitive and leaves partial words alone", () => {
    expect(applySpokenPunctuation("Hi COMMA there")).toBe("Hi, there");
    expect(applySpokenPunctuation("commander periodic")).toBe("commander periodic");
  });
});

describe("applySpokenPunctuation (Russian)", () => {
  it("turns «запятая» and «точка» into punctuation", () => {
    expect(applySpokenPunctuation("привет запятая мир точка")).toBe("привет, мир.");
  });

  it("turns «новый абзац» into a paragraph break", () => {
    expect(applySpokenPunctuation("раз новый абзац два")).toBe("раз\n\nдва");
  });

  it("matches whole Russian words only and prefers the longer phrase", () => {
    expect(applySpokenPunctuation("раз точка с запятой два")).toBe("раз; два");
    expect(applySpokenPunctuation("точками запятаями")).toBe("точками запятаями");
  });
});

describe("capitalizeSentences", () => {
  it("capitalises after . ! ? … and newlines", () => {
    expect(capitalizeSentences("hello. world! ok? yes… fine\nnext")).toBe(
      "Hello. World! Ok? Yes… Fine\nNext",
    );
    expect(capitalizeSentences("привет. мир")).toBe("Привет. Мир");
  });

  it("does not capitalise after a decimal point or mid-sentence", () => {
    expect(capitalizeSentences("pi is 3.14 roughly")).toBe("Pi is 3.14 roughly");
  });

  it("matches the sentence-start rule on edge cases", () => {
    // The rule as one regular expression; fine for short inputs.
    const byRegex = (text: string) =>
      text.replace(/(^|[.!?…]\s+|\n\s*)(\p{Ll})/gu, (_m, lead: string, letter: string) => {
        return lead + letter.toUpperCase();
      });
    for (const text of [
      "",
      "a",
      " a",
      "\na",
      "\n \n\t a",
      "a.b. c",
      "x.\nb",
      "x .  y",
      "ok?!  ß",
      "end… éa",
      "1. a",
      "a\n\nb\n 1c",
      "x. 𝓪 y",
      ".a",
    ]) {
      expect(capitalizeSentences(text)).toBe(byRegex(text));
    }
  });
});

describe("linear time on long runs of whitespace", () => {
  const n = 80_000;

  it("applySpokenPunctuation", () => {
    expect(applySpokenPunctuation(`a${" ".repeat(n)}b`)).toBe(`a${" ".repeat(n)}b`);
    expect(applySpokenPunctuation(`a${" ".repeat(n)}`)).toBe(`a${" ".repeat(n)}`);
    expect(applySpokenPunctuation(`a${" ".repeat(n)}comma b`)).toBe("a, b");
    expect(applySpokenPunctuation(`a${" \t".repeat(n / 2)}\n b`)).toBe("a\nb");
  }, 20_000);

  it("capitalizeSentences", () => {
    expect(capitalizeSentences(`${"\n".repeat(n)}A`)).toBe(`${"\n".repeat(n)}A`);
    expect(capitalizeSentences(`x.${" ".repeat(n)}y`)).toBe(`X.${" ".repeat(n)}Y`);
  }, 20_000);

  it("appendChunk", () => {
    expect(appendChunk(`a${" ".repeat(n)}b`, "c", { autoCapitalize: true })).toBe(
      `A${" ".repeat(n)}b c`,
    );
    expect(appendChunk("x", `a${" ".repeat(n)}b`, { spokenPunctuation: true })).toBe("x a b");
  }, 20_000);
});

describe("appendChunk", () => {
  it("joins chunks with exactly one space", () => {
    expect(appendChunk("", "hello")).toBe("hello");
    expect(appendChunk("hello", "world")).toBe("hello world");
    expect(appendChunk("hello   ", "  big   world ")).toBe("hello big world");
  });

  it("ignores empty chunks", () => {
    expect(appendChunk("hello", "   ")).toBe("hello");
  });

  it("attaches leading punctuation to the previous word", () => {
    expect(appendChunk("hello", ", there")).toBe("hello, there");
    expect(appendChunk("hello", "comma there", { spokenPunctuation: true })).toBe("hello, there");
    expect(appendChunk("he said «", "hi")).toBe("he said «hi");
  });

  it("does not add a space after a newline", () => {
    expect(appendChunk("first\n", "second")).toBe("first\nsecond");
  });

  it("capitalises when asked", () => {
    expect(
      appendChunk("It works.", "next sentence period and more", {
        spokenPunctuation: true,
        autoCapitalize: true,
      }),
    ).toBe("It works. Next sentence. And more");
  });

  it("collapses three or more newlines to a paragraph break", () => {
    expect(appendChunk("a\n\n\n", "b")).toBe("a\n\nb");
  });

  it("keeps a paragraph break spoken at the start of a chunk", () => {
    expect(appendChunk("First.", "new paragraph second", { spokenPunctuation: true })).toBe(
      "First.\n\nsecond",
    );
  });

  it("keeps a line break spoken at the end of a chunk", () => {
    const t = appendChunk("", "first line new line", { spokenPunctuation: true });
    expect(appendChunk(t, "second", { spokenPunctuation: true })).toBe("first line\nsecond");
  });
});

describe("analyzeTranscript", () => {
  it("counts words, characters and non-empty lines", () => {
    expect(analyzeTranscript("hello world\n\nsecond line", 0)).toEqual({
      words: 4,
      characters: 24,
      lines: 2,
      seconds: 0,
      wordsPerMinute: 0,
    });
    expect(analyzeTranscript("")).toMatchObject({ words: 0, lines: 0 });
  });

  it("reports pace only after 5 seconds", () => {
    const fifty = Array(50).fill("w").join(" ");
    // 50 words in 30 s = 100 wpm
    expect(analyzeTranscript(fifty, 30).wordsPerMinute).toBe(100);
    expect(analyzeTranscript(fifty, 4.9).wordsPerMinute).toBe(0);
    expect(analyzeTranscript(fifty, 5.4).seconds).toBe(5);
    expect(analyzeTranscript(fifty, -3).seconds).toBe(0);
  });
});

describe("formatClock / confidencePercent / transcriptFilename", () => {
  it("formats m:ss by flooring", () => {
    expect(formatClock(75.9)).toBe("1:15");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
  });

  it("turns confidence into a clamped percentage", () => {
    expect(confidencePercent(0.876)).toBe(88);
    expect(confidencePercent(1.2)).toBe(100);
    expect(confidencePercent(0)).toBe(0);
    expect(confidencePercent(Number.NaN)).toBe(0);
  });

  it("builds a local-time filename", () => {
    expect(transcriptFilename(new Date(2026, 9, 20, 14, 32))).toBe(
      "transcript-2026-10-20-1432.txt",
    );
    expect(transcriptFilename(new Date(2026, 0, 5, 9, 7), "notes")).toBe(
      "notes-2026-01-05-0907.txt",
    );
  });
});
