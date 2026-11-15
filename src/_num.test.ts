import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatNumber,
  formatPercent,
  localeFor,
  normalizeLang,
  parseDecimal,
  parseDecimalOrNaN,
} from "./_num.js";

// Intl uses a no-break space (U+00A0) or a narrow one (U+202F) between RU groups
// depending on the ICU version; compare with every space-like char folded to " ".
const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("normalizeLang / localeFor", () => {
  it("maps ru* to ru and everything else to en", () => {
    expect(normalizeLang("ru")).toBe("ru");
    expect(normalizeLang("ru-RU")).toBe("ru");
    expect(normalizeLang("en")).toBe("en");
    expect(normalizeLang("")).toBe("en");
    expect(normalizeLang(undefined)).toBe("en");
    expect(localeFor("ru")).toBe("ru-RU");
    expect(localeFor("en")).toBe("en-US");
  });
});

describe("formatNumber", () => {
  it("groups and uses the decimal sign of the page language", () => {
    expect(formatNumber(1172270.8, "en", { decimals: 2 })).toBe("1,172,270.80");
    expect(sp(formatNumber(1172270.8, "ru", { decimals: 2 }))).toBe("1 172 270,80");
  });

  it("drops trailing zeros by default, up to 2 decimals", () => {
    expect(formatNumber(8.5, "en")).toBe("8.5");
    expect(formatNumber(8.5, "ru")).toBe("8,5");
    expect(formatNumber(88.5714, "ru")).toBe("88,57");
    expect(formatNumber(3, "en")).toBe("3");
  });

  it("respects maxDecimals and grouping:false", () => {
    expect(formatNumber(1 / 3, "en", { maxDecimals: 4 })).toBe("0.3333");
    expect(formatNumber(12345, "en", { grouping: false })).toBe("12345");
    expect(formatNumber(12345, "ru", { grouping: false })).toBe("12345");
  });

  it("never prints -0", () => {
    expect(formatNumber(-0.001, "en")).toBe("0");
    expect(formatNumber(-0.001, "ru", { decimals: 2 })).toBe("0,00");
  });

  it("shows a dash for non-finite values", () => {
    expect(formatNumber(Number.NaN, "en")).toBe("—");
    expect(formatNumber(Number.POSITIVE_INFINITY, "ru")).toBe("—");
  });
});

describe("formatMoney", () => {
  it("puts the symbol before the amount on EN and after it on RU", () => {
    expect(formatMoney(1172270.8, "$", "en")).toBe("$1,172,270.80");
    expect(sp(formatMoney(1172270.8, "₽", "ru"))).toBe("1 172 270,80 ₽");
    expect(formatMoney(1062.5, "€", "en")).toBe("€1,062.50");
    expect(sp(formatMoney(1062.5, "$", "ru"))).toBe("1 062,50 $");
  });

  it("puts the minus sign first", () => {
    expect(formatMoney(-5, "$", "en")).toBe("-$5.00");
    expect(sp(formatMoney(-5, "₽", "ru"))).toBe("-5,00 ₽");
    expect(formatMoney(-0.001, "$", "en")).toBe("$0.00");
  });

  it("spaces letter codes and handles a missing symbol", () => {
    expect(sp(formatMoney(10, "USD", "en"))).toBe("USD 10.00");
    expect(formatMoney(10, "", "en")).toBe("10.00");
    expect(formatMoney(10, "$", "en", { decimals: 0 })).toBe("$10");
  });

  it("shows a dash for non-finite values", () => {
    expect(formatMoney(Number.POSITIVE_INFINITY, "$", "en")).toBe("—");
  });
});

describe("formatPercent", () => {
  it("formats percent units with one decimal by default", () => {
    expect(formatPercent(88.5714, "en")).toBe("88.6%");
    expect(sp(formatPercent(88.5714, "ru"))).toBe("88,6 %");
    expect(formatPercent(16.5, "en", { maxDecimals: 2 })).toBe("16.5%");
    expect(formatPercent(Number.NaN, "en")).toBe("—");
  });
});

describe("parseDecimal", () => {
  const ok = (s: string, lang: string) => {
    const r = parseDecimal(s, lang);
    if (!r.ok) throw new Error(`${s} (${lang}) rejected`);
    return r.value;
  };

  it("accepts a decimal comma and a decimal point in both languages", () => {
    for (const lang of ["en", "ru"]) {
      expect(ok("3,5", lang)).toBe(3.5);
      expect(ok("3.5", lang)).toBe(3.5);
      expect(ok("16,5", lang)).toBe(16.5);
      expect(ok("0,5", lang)).toBe(0.5);
      expect(ok(",5", lang)).toBe(0.5);
      expect(ok(".5", lang)).toBe(0.5);
      expect(ok("5.", lang)).toBe(5);
      expect(ok("12,50", lang)).toBe(12.5);
    }
  });

  it("accepts space, NBSP, thin-space and narrow-NBSP grouping", () => {
    for (const lang of ["en", "ru"]) {
      expect(ok("1 000", lang)).toBe(1000);
      expect(ok("1 000,50", lang)).toBe(1000.5);
      expect(ok("1\u00a0000\u00a0000", lang)).toBe(1000000);
      expect(ok("1\u2009000,5", lang)).toBe(1000.5);
      expect(ok("1\u202f172\u202f270,80", lang)).toBe(1172270.8);
      expect(ok("1'000.5", lang)).toBe(1000.5);
    }
  });

  it("reads output of formatNumber back in the same language", () => {
    for (const lang of ["en", "ru"]) {
      const n = 1172270.8;
      expect(ok(formatNumber(n, lang, { decimals: 2 }), lang)).toBe(n);
    }
  });

  it("accepts both separators: the last one is the decimal sign", () => {
    for (const lang of ["en", "ru"]) {
      expect(ok("1,000.50", lang)).toBe(1000.5);
      expect(ok("1.000,50", lang)).toBe(1000.5);
      expect(ok("1,234,567.891", lang)).toBe(1234567.891);
    }
  });

  it("reads repeated separators as grouping", () => {
    for (const lang of ["en", "ru"]) {
      expect(ok("1,000,000", lang)).toBe(1000000);
      expect(ok("1.000.000", lang)).toBe(1000000);
    }
  });

  // The documented ambiguity: one comma + exactly three digits.
  it("decides '1,999' by page language: EN grouping, RU decimal comma", () => {
    expect(ok("1,999", "en")).toBe(1999);
    expect(ok("12,500", "en")).toBe(12500);
    expect(ok("1,999", "ru")).toBe(1.999);
    expect(ok("12,500", "ru")).toBe(12.5);
    // A lone leading zero is never a thousands group.
    expect(ok("0,999", "en")).toBe(0.999);
    // Four digits after the comma is a decimal in both languages.
    expect(ok("1,9999", "en")).toBe(1.9999);
  });

  it("always reads a single dot as a decimal point", () => {
    expect(ok("1.999", "en")).toBe(1.999);
    expect(ok("1.999", "ru")).toBe(1.999);
  });

  it("accepts signs and currency / percent decorations", () => {
    expect(ok("-3,5", "ru")).toBe(-3.5);
    expect(ok("−3,5", "ru")).toBe(-3.5);
    expect(ok("+2", "en")).toBe(2);
    expect(ok("$1,234.50", "en")).toBe(1234.5);
    expect(ok("1 234,50 ₽", "ru")).toBe(1234.5);
    expect(ok("16,5 %", "ru")).toBe(16.5);
    expect(ok("7.25%", "en")).toBe(7.25);
    expect(ok("-$5", "en")).toBe(-5);
    expect(Object.is(ok("-0", "en"), 0)).toBe(true);
  });

  it("reports empty input separately from junk", () => {
    expect(parseDecimal("", "en")).toEqual({ ok: false, error: "empty" });
    expect(parseDecimal("   ", "ru")).toEqual({ ok: false, error: "empty" });
    expect(parseDecimal(null, "ru")).toEqual({ ok: false, error: "empty" });
  });

  it("rejects junk instead of guessing (no silent x10 / x1000)", () => {
    const bad = [
      "abc",
      "12abc",
      "1-2",
      "1e3",
      "--5",
      "1,2,3",
      "1.2.3",
      "12 5",
      "1 00",
      "1,00,000",
      "1.000.5",
      "1,000.000,5",
      "1 000,5 0",
      ".",
      ",",
      "$",
      "%",
      "Infinity",
      "0x10",
    ];
    for (const s of bad) {
      for (const lang of ["en", "ru"]) {
        expect(parseDecimal(s, lang), `${s} (${lang})`).toEqual({ ok: false, error: "invalid" });
      }
    }
  });

  it("parseDecimalOrNaN is a drop-in for parseFloat", () => {
    expect(parseDecimalOrNaN("3,5", "ru")).toBe(3.5);
    expect(parseDecimalOrNaN("12abc", "ru")).toBeNaN();
    expect(parseDecimalOrNaN("", "en")).toBeNaN();
  });
});
