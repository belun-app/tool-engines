import { describe, expect, it } from "vitest";
import { countCharacters } from "./character-counter.js";

describe("countCharacters", () => {
  it("returns zeros and an empty GSM-7 SMS for empty input", () => {
    const r = countCharacters("");
    expect(r.characters).toBe(0);
    expect(r.words).toBe(0);
    expect(r.sms).toEqual({
      encoding: "gsm7",
      units: 0,
      segments: 0,
      perSegment: 160,
      remaining: 160,
    });
  });

  it("returns a fresh object each time for empty input", () => {
    const a = countCharacters("");
    a.sms.units = 42;
    a.characters = 5;
    expect(countCharacters("").sms.units).toBe(0);
    expect(countCharacters("").characters).toBe(0);
  });

  it("counts mixed Latin, Cyrillic, digits and punctuation (hand-counted)", () => {
    // "Hello, мир! 123": H e l l o , ␣ м и р ! ␣ 1 2 3 = 15 code points
    const r = countCharacters("Hello, мир! 123");
    expect(r.characters).toBe(15);
    expect(r.charactersNoSpaces).toBe(13);
    expect(r.graphemes).toBe(15);
    expect(r.utf16Units).toBe(15);
    // 12 ASCII bytes + 3 Cyrillic letters x 2 bytes = 18
    expect(r.utf8Bytes).toBe(18);
    expect(r.letters).toBe(8);
    expect(r.latin).toBe(5);
    expect(r.cyrillic).toBe(3);
    expect(r.digits).toBe(3);
    expect(r.spaces).toBe(2);
    expect(r.punctuation).toBe(2);
    expect(r.words).toBe(3);
    // "Hello, мир" | " 123"
    expect(r.sentences).toBe(2);
    expect(r.emoji).toBe(0);
    // H e l o , space м и р ! 1 2 3 = 13 distinct
    expect(r.uniqueCharacters).toBe(13);
  });

  // Regression: the stress mark in "моло́ко" counted as punctuation.
  it("never counts a combining mark as punctuation; Characters stay code points", () => {
    const r = countCharacters("моло\u0301ко, cafe\u0301");
    expect(r.characters).toBe(14);
    expect(r.graphemes).toBe(12);
    expect(r.punctuation).toBe(1);
    expect(r.letters).toBe(10);
  });

  it("separates code points, graphemes and UTF-16 units for emoji", () => {
    // family = 4 emoji + 3 ZWJ = 7 code points, 1 grapheme, 4*2 + 3 = 11 UTF-16 units
    const r = countCharacters("👩‍👩‍👧‍👦");
    expect(r.characters).toBe(7);
    expect(r.graphemes).toBe(1);
    expect(r.utf16Units).toBe(11);
    // each emoji is 4 UTF-8 bytes, each ZWJ 3: 16 + 9 = 25
    expect(r.utf8Bytes).toBe(25);
    expect(r.emoji).toBe(1);
  });

  it("counts a decomposed accent as one grapheme but two code points", () => {
    const r = countCharacters("e\u0301");
    expect(r.characters).toBe(2);
    expect(r.graphemes).toBe(1);
  });

  it("does not split sentences on decimals and ignores blank lines in line count", () => {
    const r = countCharacters("Pi is 3.14. Done!\n\n\nNext para");
    expect(r.sentences).toBe(3);
    expect(r.paragraphs).toBe(2);
    expect(r.lines).toBe(2);
  });

  it("ends a sentence at the ellipsis character and keeps version numbers whole", () => {
    expect(countCharacters("Подожди… Я иду.").sentences).toBe(2);
    expect(countCharacters("Version 1.2.3 is out. Update now.").sentences).toBe(2);
  });

  it("whitespace-only text has characters and spaces but no words", () => {
    const r = countCharacters(" \t\n");
    expect(r.characters).toBe(3);
    expect(r.spaces).toBe(3);
    expect(r.words).toBe(0);
    expect(r.sentences).toBe(0);
    expect(r.paragraphs).toBe(0);
    expect(r.lines).toBe(0);
  });

  describe("SMS", () => {
    it("fits 160 GSM-7 characters in one segment", () => {
      expect(countCharacters("a".repeat(160)).sms).toEqual({
        encoding: "gsm7",
        units: 160,
        segments: 1,
        perSegment: 160,
        remaining: 0,
      });
    });

    it("splits 161 GSM-7 characters into 2 x 153", () => {
      // 2 * 153 - 161 = 145 remaining
      expect(countCharacters("a".repeat(161)).sms).toEqual({
        encoding: "gsm7",
        units: 161,
        segments: 2,
        perSegment: 153,
        remaining: 145,
      });
    });

    it("charges extension characters (€ { } [ ] ~ ^ | \\) two units", () => {
      expect(countCharacters("€").sms.units).toBe(2);
      expect(countCharacters("a{b}").sms.units).toBe(6);
      expect(countCharacters("€").sms.encoding).toBe("gsm7");
    });

    it("treats GSM accented letters (é, ü, Ñ) as GSM-7", () => {
      expect(countCharacters("éüÑ").sms).toMatchObject({ encoding: "gsm7", units: 3 });
    });

    it("switches to UCS-2 for Cyrillic: 70 per single segment, 67 when split", () => {
      expect(countCharacters("я".repeat(70)).sms).toEqual({
        encoding: "ucs2",
        units: 70,
        segments: 1,
        perSegment: 70,
        remaining: 0,
      });
      // ceil(71 / 67) = 2 segments, 134 - 71 = 63
      expect(countCharacters("я".repeat(71)).sms).toEqual({
        encoding: "ucs2",
        units: 71,
        segments: 2,
        perSegment: 67,
        remaining: 63,
      });
    });

    it("bills an astral emoji as two UCS-2 units", () => {
      expect(countCharacters("hi 😀").sms).toMatchObject({ encoding: "ucs2", units: 5 });
    });

    it("one non-GSM character forces the whole message to UCS-2", () => {
      const r = countCharacters(`${"a".repeat(100)}ć`);
      expect(r.sms.encoding).toBe("ucs2");
      expect(r.sms.units).toBe(101);
      expect(r.sms.segments).toBe(2);
    });
  });
});
