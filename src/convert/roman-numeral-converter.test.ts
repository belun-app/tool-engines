import { describe, expect, it } from "vitest";
import {
  MAX_ROMAN,
  arabicToRoman,
  convertRomanDate,
  normalizeRomanInput,
  romanToArabic,
} from "./roman-numeral-converter.js";

// Reference values from the standard subtractive notation.
const TABLE: Array<[number, string]> = [
  [1, "I"],
  [3, "III"],
  [4, "IV"],
  [9, "IX"],
  [14, "XIV"],
  [40, "XL"],
  [49, "XLIX"],
  [90, "XC"],
  [400, "CD"],
  [444, "CDXLIV"],
  [900, "CM"],
  [1994, "MCMXCIV"],
  [2024, "MMXXIV"],
  [3888, "MMMDCCCLXXXVIII"],
  [3999, "MMMCMXCIX"],
];

describe("arabicToRoman", () => {
  it.each(TABLE)("%i -> %s", (n, roman) => {
    const r = arabicToRoman(n);
    expect(r.ok).toBe(true);
    expect(r.roman).toBe(roman);
    expect(r.arabic).toBe(n);
    expect(r.code).toBeNull();
  });

  it("accepts numeric strings with surrounding whitespace", () => {
    expect(arabicToRoman("  1994 ").roman).toBe("MCMXCIV");
  });

  it("returns the blank result for an empty string", () => {
    expect(arabicToRoman("")).toEqual({
      ok: false,
      roman: "",
      arabic: null,
      error: "",
      code: null,
      breakdown: [],
    });
    expect(arabicToRoman("   ").ok).toBe(false);
  });

  it("rejects zero and negatives", () => {
    expect(arabicToRoman(0).code).toBe("below-one");
    expect(arabicToRoman(-5).code).toBe("below-one");
  });

  it("rejects values above 3999", () => {
    expect(MAX_ROMAN).toBe(3999);
    expect(arabicToRoman(4000).code).toBe("above-max");
    expect(arabicToRoman(1e12).code).toBe("above-max");
  });

  it("rejects non-integers and non-numbers", () => {
    expect(arabicToRoman(1.5).code).toBe("not-integer");
    expect(arabicToRoman("abc").code).toBe("not-integer");
    expect(arabicToRoman(Number.NaN).code).toBe("not-integer");
    expect(arabicToRoman(Number.POSITIVE_INFINITY).code).toBe("not-integer");
  });

  it("builds a place-value breakdown", () => {
    expect(arabicToRoman(2024).breakdown).toEqual([
      { roman: "MM", arabic: 2000 },
      { roman: "XX", arabic: 20 },
      { roman: "IV", arabic: 4 },
    ]);
    expect(arabicToRoman(1009).breakdown).toEqual([
      { roman: "M", arabic: 1000 },
      { roman: "IX", arabic: 9 },
    ]);
  });
});

describe("romanToArabic", () => {
  it.each(TABLE)("%i <- %s", (n, roman) => {
    const r = romanToArabic(roman);
    expect(r.ok).toBe(true);
    expect(r.arabic).toBe(n);
  });

  it("round-trips every value 1..3999", () => {
    for (let n = 1; n <= 3999; n++) {
      expect(romanToArabic(arabicToRoman(n).roman).arabic).toBe(n);
    }
  });

  it("is case-insensitive and ignores inner whitespace", () => {
    expect(romanToArabic(" mc mxc iv ").arabic).toBe(1994);
  });

  it("returns the blank result for empty input", () => {
    expect(romanToArabic("").ok).toBe(false);
    expect(romanToArabic("  ").code).toBeNull();
  });

  it("rejects foreign letters and digits", () => {
    expect(romanToArabic("ABC").code).toBe("bad-letters");
    expect(romanToArabic("X1").code).toBe("bad-letters");
    // Cyrillic look-alikes (Х, С, М, І) are now read as Roman letters — see below.
    expect(romanToArabic("Ж").code).toBe("bad-letters");
  });

  it.each(["IIII", "VX", "IC", "IL", "VV", "XXXX", "MMMM", "DD", "LL", "IM", "XM", "CMC"])(
    "rejects the non-canonical form %s",
    (s) => {
      const r = romanToArabic(s);
      expect(r.ok).toBe(false);
      expect(r.code).toBe("bad-form");
      expect(r.arabic).toBeNull();
    },
  );

  it("returns a breakdown matching the value", () => {
    expect(romanToArabic("XLII").breakdown).toEqual([
      { roman: "XL", arabic: 40 },
      { roman: "II", arabic: 2 },
    ]);
  });
});

// Regression: Number() read 1e3, 0x10 and 0b11 as JavaScript literals (M, XVI, III).
describe("arabicToRoman — strict whole numbers", () => {
  it("refuses JavaScript number syntax", () => {
    for (const s of ["1e3", "0x10", "0b11", "0o7", "Infinity", "1_000"]) {
      expect(arabicToRoman(s).code, s).toBe("not-integer");
    }
  });

  it("accepts a sign and thousands grouped by spaces", () => {
    expect(arabicToRoman("2 026").roman).toBe("MMXXVI");
    expect(arabicToRoman("2\u00a0026").roman).toBe("MMXXVI");
    expect(arabicToRoman("+12").roman).toBe("XII");
    expect(arabicToRoman("-5").code).toBe("below-one");
    expect(arabicToRoman("20 26").code).toBe("not-integer");
  });
});

// Regression: Ⅻ and Cyrillic ХХ were refused as "use only Latin letters".
describe("romanToArabic — look-alike input", () => {
  it("reads Unicode Roman numeral signs", () => {
    expect(romanToArabic("Ⅻ").arabic).toBe(12);
    expect(romanToArabic("ⅿⅾ").arabic).toBe(1500);
  });

  it("reads Cyrillic Х, С, М and І as Roman letters", () => {
    expect(romanToArabic("ХХ").arabic).toBe(20);
    expect(romanToArabic("ХIХ").arabic).toBe(19);
    expect(romanToArabic("МСМ").arabic).toBe(1900);
    expect(romanToArabic("хіv").arabic).toBe(14);
    expect(normalizeRomanInput("Ⅻ век ХХ")).toBe("XII век XX");
  });

  it("still refuses other Cyrillic letters", () => {
    expect(romanToArabic("ХЖ").code).toBe("bad-letters");
  });
});

describe("romanToArabic — suggestion for a malformed numeral", () => {
  it("offers the canonical form of what the letters add up to", () => {
    expect(romanToArabic("IIII").suggestion).toEqual({ roman: "IV", arabic: 4 });
    expect(romanToArabic("IC").suggestion).toEqual({ roman: "XCIX", arabic: 99 });
    expect(romanToArabic("VV").suggestion).toEqual({ roman: "X", arabic: 10 });
    expect(romanToArabic("MCMC").suggestion).toEqual({ roman: "MM", arabic: 2000 });
  });

  it("offers nothing above 3999 and for valid numerals", () => {
    expect(romanToArabic("MMMM").suggestion).toBeUndefined();
    expect(romanToArabic("XIV").suggestion).toBeUndefined();
  });
});

describe("convertRomanDate", () => {
  it("turns a day-month-year date into Roman numerals", () => {
    const r = convertRomanDate("14.11.2026", "dmy");
    expect(r.ok).toBe(true);
    expect(r.direction).toBe("toRoman");
    expect(r.output).toBe("XIV.XI.MMXXVI");
    expect(convertRomanDate("9 мая 1945", "dmy").code).toBe("bad-date");
    expect(convertRomanDate("09.05.1945", "dmy", " · ").output).toBe("IX · V · MCMXLV");
  });

  // An ISO date must be read year first, not as day 2026 (which would be bad-day).
  it("reads an ISO year-month-day date in either page order", () => {
    for (const order of ["dmy", "mdy"] as const) {
      const r = convertRomanDate("2026-11-14", order);
      expect(r.ok, order).toBe(true);
      expect(r.output).toBe("MMXXVI.XI.XIV");
    }
    expect(convertRomanDate("MMXXVI.XI.XIV", "dmy").output).toBe("2026.11.14");
    expect(convertRomanDate("2026-02-30", "dmy").code).toBe("bad-day");
    expect(convertRomanDate("2026-13-01", "dmy").code).toBe("bad-month");
  });

  it("reads a US month/day/year date", () => {
    expect(convertRomanDate("11/14/2026", "mdy", "/").output).toBe("XI/XIV/MMXXVI");
    expect(convertRomanDate("14/11/2026", "mdy").code).toBe("bad-month");
  });

  it("turns a Roman date back into digits, with Cyrillic look-alikes too", () => {
    const r = convertRomanDate("XIV.XI.MMXXVI", "dmy");
    expect(r.direction).toBe("toArabic");
    expect(r.output).toBe("14.11.2026");
    expect(convertRomanDate("ІХ.V.МСМХLV", "dmy").output).toBe("09.05.1945");
    expect(convertRomanDate("XI.MMXXVI", "dmy").output).toBe("11.2026");
  });

  it("refuses impossible days, mixed notation and wrong part counts", () => {
    expect(convertRomanDate("31.04.2026", "dmy").code).toBe("bad-day");
    expect(convertRomanDate("29.02.2026", "dmy").code).toBe("bad-day");
    expect(convertRomanDate("29.02.2024", "dmy").ok).toBe(true);
    expect(convertRomanDate("29.02.1900", "dmy").code).toBe("bad-day");
    expect(convertRomanDate("14.XI.2026", "dmy").code).toBe("bad-date");
    expect(convertRomanDate("2026", "dmy").code).toBe("bad-date");
    expect(convertRomanDate("1.2.3.4", "dmy").code).toBe("bad-date");
    expect(convertRomanDate("14.11.5000", "dmy").code).toBe("bad-date");
    expect(convertRomanDate("", "dmy")).toMatchObject({ ok: false, code: null });
  });

  it("defaults to day-month-year order", () => {
    expect(convertRomanDate("14.11.2026").output).toBe(
      convertRomanDate("14.11.2026", "dmy").output,
    );
  });
});

describe("non-string input", () => {
  it("is read as text instead of throwing", () => {
    expect(romanToArabic(undefined as unknown as string)).toMatchObject({ ok: false, code: null });
    expect(romanToArabic(null as unknown as string).ok).toBe(false);
    expect(romanToArabic(12 as unknown as string).code).toBe("bad-letters");
    expect(normalizeRomanInput(undefined as unknown as string)).toBe("");
    expect(convertRomanDate(undefined as unknown as string)).toMatchObject({ ok: false });
    expect(arabicToRoman(null as unknown as number).code).toBe("not-integer");
  });
});
