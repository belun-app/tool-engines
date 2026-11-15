import { describe, expect, it } from "vitest";
import { isPalindrome, reverseText } from "./text-reverser.js";

describe("reverseText — letter mode", () => {
  it("returns empty output for empty input in every mode", () => {
    expect(reverseText("", "letter").output).toBe("");
    expect(reverseText("", "word").output).toBe("");
    expect(reverseText("", "flip").output).toBe("");
  });

  it("reverses characters", () => {
    expect(reverseText("Hello, world", "letter").output).toBe("dlrow ,olleH");
  });

  it("reverses Cyrillic text", () => {
    expect(reverseText("Привет", "letter").output).toBe("тевирП");
  });

  it("keeps astral-plane characters (surrogate pairs) intact", () => {
    // 😀 is one code point stored as two UTF-16 units — splitting by units would corrupt it
    expect(reverseText("a😀b", "letter").output).toBe("b😀a");
  });

  it("reverses the whole text including line order", () => {
    expect(reverseText("ab\ncd", "letter").output).toBe("dc\nba");
  });

  it("is its own inverse for plain text", () => {
    const s = "The quick brown fox — 123!";
    expect(reverseText(reverseText(s, "letter").output, "letter").output).toBe(s);
  });

  // Regression: the text used to be split by code points, so a skin-tone modifier detached from its emoji
  it("keeps multi-code-point emoji together", () => {
    expect(reverseText("ab👍🏽", "letter").output).toBe("👍🏽ba");
  });

  it("keeps a stress mark on its vowel (shared grapheme segmentation)", () => {
    const o = `о${String.fromCodePoint(0x301)}`;
    expect(reverseText(`мол${o}ко`, "letter").output).toBe(`ок${o}лом`);
  });

  it("flip mode keeps a skin-tone emoji whole", () => {
    expect(reverseText("hi 👍🏽", "flip").output).toBe("👍🏽 ᴉɥ");
  });

  it("keeps ZWJ sequences, flags and combining accents together", () => {
    expect(reverseText("x👩‍💻🇩🇪é", "letter").output).toBe("é🇩🇪👩‍💻x");
  });
});

describe("reverseText — word mode", () => {
  it("reverses word order per line", () => {
    expect(reverseText("one two three\nfour five", "word").output).toBe("three two one\nfive four");
  });

  it("collapses runs of whitespace and drops leading/trailing spaces", () => {
    expect(reverseText("  one \t two  ", "word").output).toBe("two one");
  });

  it("keeps punctuation attached to its word", () => {
    expect(reverseText("Hello, world!", "word").output).toBe("world! Hello,");
  });

  it("handles Cyrillic words and empty lines", () => {
    expect(reverseText("раз два\n\nтри", "word").output).toBe("два раз\n\nтри");
  });
});

describe("reverseText — flip mode", () => {
  it("rotates glyphs and reverses each line", () => {
    // H->H, e->ǝ, l->l, o->o, then reversed: "ollǝH"
    expect(reverseText("Hello", "flip").output).toBe("ollǝH");
    // 6 <-> 9, ? -> ¿
    expect(reverseText("69?", "flip").output).toBe("¿69");
  });

  // Regression: lines used to keep their order, so a rotated paragraph read bottom line first
  it("reverses line order too, as a screen turned 180° shows the last line on top", () => {
    expect(reverseText("ab\ncd", "flip").output).toBe("pɔ\nqɐ");
    expect(reverseText("one\ntwo", "flip").output).toBe("oʍʇ\nǝuo");
  });

  // Regression: Г→L and г→ʟ were reflections, not rotations; D→◖ was a filled half-disc
  it("rotates Г, г and D into turned glyphs, and back", () => {
    expect(reverseText("Г", "flip").output).toBe("⅃");
    expect(reverseText("г", "flip").output).toBe("ɹ");
    expect(reverseText("D", "flip").output).toBe("ᗡ");
    expect(reverseText("⅃", "flip").output).toBe("Г");
  });

  it("flips Cyrillic letters", () => {
    // д -> ɓ, а -> ɐ ; reversed: "ɐɓ"
    expect(reverseText("да", "flip").output).toBe("ɐɓ");
    // multi-code-point rotation: ы -> "ıq"
    expect(reverseText("ы", "flip").output).toBe("ıq");
  });

  it("passes unknown characters through unchanged", () => {
    expect(reverseText("中😀", "flip").output).toBe("😀中");
  });

  it("round-trips lowercase Latin, digits and punctuation", () => {
    const s = "abcdefghijklmnopqrstuvwxyz0123456789.,?!()[]{}<>_;&";
    expect(reverseText(reverseText(s, "flip").output, "flip").output).toBe(s);
  });

  // Documents the limit stated on ROTATION_PAIRS: shared glyphs rotate back to Latin.
  it("does not restore Cyrillic letters that share a rotated glyph with Latin", () => {
    expect(reverseText(reverseText("Л", "flip").output, "flip").output).toBe("Λ");
    expect(reverseText(reverseText("М", "flip").output, "flip").output).toBe("M");
  });

  // Regression: "K" and "k" both rotated to "ʞ", which flipped back to "k"
  it("round-trips uppercase Latin letters", () => {
    const s = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    expect(reverseText(reverseText(s, "flip").output, "flip").output).toBe(s);
  });
});

describe("reverseText — mirror mode", () => {
  it("uses mirrored look-alikes and reverses each line", () => {
    expect(reverseText("Hello world", "mirror").output).toBe("blɿow ollɘH");
    expect(reverseText("bdpq", "mirror").output).toBe("pqbd");
  });

  it("mirrors Cyrillic letters that have a mirrored glyph and keeps symmetric ones", () => {
    expect(reverseText("Я И Ж", "mirror").output).toBe("Ж N R");
    expect(reverseText("гриб", "mirror").output).toBe("бᴎqɿ");
  });

  // Regression: Г mirrored to ⅃, which is Г rotated 180°, not reflected.
  it("mirrors Г to ⅂ (bar on top) and L to ⅃ (bar at the bottom), and back", () => {
    expect(reverseText("Г", "mirror").output).toBe("⅂");
    expect(reverseText("L", "mirror").output).toBe("⅃");
    expect(reverseText("⅂", "mirror").output).toBe("Г");
    expect(reverseText("Г", "flip").output).toBe("⅃");
  });

  it("keeps line order and emoji intact", () => {
    expect(reverseText("ab\ncd 👍🏽", "mirror").output).toBe("dɒ\n👍🏽 bɔ");
  });

  it("restores Latin text when applied twice", () => {
    const s = "Peter picked a pepper (2024)?";
    expect(reverseText(reverseText(s, "mirror").output, "mirror").output).toBe(s);
  });
});

describe("reverseText — each word mode", () => {
  it("reverses letters inside words and keeps word order and spacing", () => {
    expect(reverseText("Hello big  world", "eachWord").output).toBe("olleH gib  dlrow");
    expect(reverseText("Привет,\tмир!\nдва", "eachWord").output).toBe(",тевирП\t!рим\nавд");
  });

  it("keeps emoji whole inside a word", () => {
    expect(reverseText("ok👍🏽", "eachWord").output).toBe("👍🏽ko");
  });
});

describe("isPalindrome", () => {
  it("ignores case, spaces and punctuation; ё counts as е", () => {
    expect(isPalindrome("А роза упала на лапу Азора")).toBe(true);
    expect(isPalindrome("Was it a car or a cat I saw?")).toBe(true);
    expect(isPalindrome("Ешь немытого ты меньше")).toBe(true);
    expect(isPalindrome("Ёлка аклё")).toBe(true);
  });

  it("needs at least three letters or digits", () => {
    expect(isPalindrome("aa")).toBe(false);
    expect(isPalindrome("aba")).toBe(true);
    expect(isPalindrome("!!")).toBe(false);
    expect(isPalindrome("hello")).toBe(false);
  });
});
