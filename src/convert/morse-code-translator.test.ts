import { describe, expect, it } from "vitest";
import {
  WORD_SEPARATOR,
  detectAlphabet,
  isPlausibleMorse,
  looksLikeMorse,
  morseToText,
  morseToTimeline,
  textToMorse,
  timelineDuration,
} from "./morse-code-translator.js";

describe("textToMorse", () => {
  it("returns empty output for empty / whitespace input", () => {
    expect(textToMorse("")).toEqual({ output: "", unsupported: [] });
    expect(textToMorse("  \n\t ")).toEqual({ output: "", unsupported: [] });
  });

  it("encodes SOS and a two-word phrase per the ITU table", () => {
    expect(textToMorse("SOS").output).toBe("... --- ...");
    // H=...., E=., L=.-.., O=---; W=.--, R=.-., D=-..
    expect(textToMorse("hello world").output).toBe(".... . .-.. .-.. --- / .-- --- .-. .-.. -..");
    expect(WORD_SEPARATOR).toBe("/");
  });

  it("is case-insensitive and collapses runs of whitespace", () => {
    expect(textToMorse("  a \n\n  b  ").output).toBe(".- / -...");
  });

  it("encodes digits and punctuation", () => {
    expect(textToMorse("0 9").output).toBe("----- / ----.");
    expect(textToMorse("?").output).toBe("..--..");
    expect(textToMorse("@").output).toBe(".--.-.");
  });

  it("reports unsupported characters once and drops them", () => {
    const r = textToMorse("a#b# ~");
    expect(r.output).toBe(".- -...");
    expect(r.unsupported).toEqual(["#", "~"]);
  });

  it("encodes Cyrillic with the Russian alphabet", () => {
    // Ш=----, Ч=---., Я=.-.-
    expect(textToMorse("шчя", "cyrillic").output).toBe("---- ---. .-.-");
  });

  it("encodes Latin and Cyrillic together whatever the alphabet", () => {
    for (const alphabet of ["latin", "cyrillic"] as const) {
      const r = textToMorse("SOS сос", alphabet);
      expect(r.output).toBe("... --- ... / ... --- ...");
      expect(r.unsupported).toEqual([]);
    }
    expect(textToMorse("привет мир", "latin").output).toBe(".--. .-. .. .-- . - / -- .. .-.");
  });

  it("encodes Ё as Е (.)", () => {
    const r = textToMorse("ёж", "cyrillic");
    expect(r.output).toBe(". ...-");
    expect(r.unsupported).toEqual([]);
    expect(textToMorse("ЁЛКА").output).toBe(". .-.. -.- .-");
  });

  it("does not throw on emoji input", () => {
    const r = textToMorse("a👍");
    expect(r.output).toBe(".-");
    expect(r.unsupported).toEqual(["👍"]);
  });
});

describe("morseToText", () => {
  it("returns empty output for empty input", () => {
    expect(morseToText("")).toEqual({ output: "", unsupported: [] });
    expect(morseToText("   ")).toEqual({ output: "", unsupported: [] });
  });

  it("decodes with / and with 3+ spaces as word separators", () => {
    expect(morseToText("... --- ...").output).toBe("SOS");
    expect(morseToText(".... .. / - .... . .-. .").output).toBe("HI THERE");
    expect(morseToText(".... ..   -").output).toBe("HI T");
    expect(morseToText(".... ..//-").output).toBe("HI T");
  });

  it("normalises unicode dashes, underscores, middots and asterisks", () => {
    expect(morseToText("··· ——— ···").output).toBe("SOS");
    expect(morseToText("*** ___ ***").output).toBe("SOS");
    expect(morseToText("−·").output).toBe("N");
  });

  it("marks unknown codes with ? and lists them", () => {
    const r = morseToText("...---... .-");
    expect(r.output).toBe("?A");
    expect(r.unsupported).toEqual(["...---..."]);
  });

  it("decodes the same code differently per alphabet", () => {
    // .-.- has no Latin letter, is Я in Russian Morse; .-- is W / В
    expect(morseToText(".-- .-.-", "cyrillic").output).toBe("ВЯ");
    expect(morseToText(".--", "latin").output).toBe("W");
  });

  it("round-trips text through encode and decode", () => {
    const text = "THE QUICK BROWN FOX 123?";
    expect(morseToText(textToMorse(text).output).output).toBe(text);
    const ru = "ПРИВЕТ МИР";
    expect(morseToText(textToMorse(ru, "cyrillic").output, "cyrillic").output).toBe(ru);
  });
});

describe("morseToTimeline", () => {
  it("returns an empty timeline for empty input", () => {
    expect(morseToTimeline("")).toEqual([]);
  });

  it("uses PARIS timing: 1200/wpm ms per unit", () => {
    // 20 wpm -> 60 ms unit. ".-" = dot(1) gap(1) dash(3)
    expect(morseToTimeline(".-", 20)).toEqual([
      { tone: true, ms: 60 },
      { tone: false, ms: 60 },
      { tone: true, ms: 180 },
    ]);
  });

  it("inserts 3-unit letter gaps and 7-unit word gaps", () => {
    // ". . / ." at 12 wpm (100 ms): dot, gap3, dot, gap7, dot = 1+3+1+7+1 = 13 units
    const t = morseToTimeline(". . / .", 12);
    expect(t.map((u) => u.ms)).toEqual([100, 300, 100, 700, 100]);
    expect(timelineDuration(t)).toBe(1300);
  });

  it("measures PARIS as 50 units (the wpm definition) minus the trailing word gap", () => {
    const paris = textToMorse("PARIS").output;
    // PARIS is 50 units including a 7-unit trailing word gap -> 43 units of signal
    expect(timelineDuration(morseToTimeline(paris, 1))).toBe(43 * 1200);
  });

  it("clamps wpm below 1 to 1", () => {
    expect(morseToTimeline(".", 0)).toEqual([{ tone: true, ms: 1200 }]);
    expect(morseToTimeline(".", -5)).toEqual([{ tone: true, ms: 1200 }]);
  });

  it("ignores non-Morse symbols inside a letter", () => {
    expect(morseToTimeline(".x-", 60).map((u) => u.ms)).toEqual([20, 20, 60]);
  });

  it("timelineDuration of an empty timeline is 0", () => {
    expect(timelineDuration([])).toBe(0);
  });
});

describe("line breaks and detection helpers", () => {
  it("treats a line break between lines of Morse as a word gap", () => {
    expect(morseToText(".- -...\n-.-. -..").output).toBe("AB CD");
    expect(morseToText(".- -...\r\n  -.-. -..").output).toBe("AB CD");
    expect(morseToTimeline(".\n.", 60).filter((u) => !u.tone)[0].ms).toBe(140);
  });

  it("recognises pasted Morse but not ordinary text", () => {
    expect(looksLikeMorse("... --- ...")).toBe(true);
    expect(looksLikeMorse(".--. .-. .. .-- . - / -- .. .-.")).toBe(true);
    expect(looksLikeMorse("_ _ _")).toBe(true);
    expect(looksLikeMorse("··− ·−·")).toBe(true);
    expect(looksLikeMorse("SOS")).toBe(false);
    expect(looksLikeMorse("a.b")).toBe(false);
    expect(looksLikeMorse("-")).toBe(false);
    expect(looksLikeMorse("   ")).toBe(false);
  });

  it("only treats typed text as Morse once it plausibly is", () => {
    // An ellipsis or a dash starting a sentence must not flip the tool to decoding.
    expect(isPlausibleMorse("...")).toBe(false);
    expect(isPlausibleMorse("..")).toBe(false);
    expect(isPlausibleMorse("--")).toBe(false);
    expect(isPlausibleMorse("....")).toBe(false); // no letter gap yet
    expect(isPlausibleMorse("... Hello")).toBe(false);
    expect(isPlausibleMorse("— ..")).toBe(false); // three symbols
    expect(isPlausibleMorse("... -")).toBe(true);
    expect(isPlausibleMorse("... --- ...")).toBe(true);
    expect(isPlausibleMorse(".- / -...")).toBe(true);
    expect(isPlausibleMorse("._ _..")).toBe(true);
    expect(isPlausibleMorse("SOS")).toBe(false);
  });

  it("detects the alphabet of plain text", () => {
    expect(detectAlphabet("привет")).toBe("cyrillic");
    expect(detectAlphabet("hello 42")).toBe("latin");
    expect(detectAlphabet("SOS сос")).toBeNull();
    expect(detectAlphabet("42!")).toBeNull();
  });
});
