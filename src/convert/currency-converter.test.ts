import { describe, expect, it } from "vitest";
import {
  POPULAR_CURRENCIES,
  convertCurrency,
  currencyName,
  formatAmount,
  formatRate,
  parseRates,
} from "./currency-converter.js";

// No network: rates are given inline. fetch lives in the mount, not the engine.
const RATES = { USD: 1, EUR: 0.8, GBP: 0.5, JPY: 150 };
const norm = (s: string) => s.replace(/\s/g, " ");

describe("parseRates", () => {
  it("parses the open.er-api.com shape", () => {
    expect(
      parseRates({
        base_code: "USD",
        time_last_update_utc: "Fri, 13 Nov 2026 00:00:01 +0000",
        rates: { USD: 1, EUR: 0.9, BAD: -1, xyz: 2, ZZZ: "abc", RUB: "95.5" },
      }),
    ).toEqual({
      rates: { USD: 1, EUR: 0.9, RUB: 95.5 },
      updated: "Fri, 13 Nov 2026 00:00:01 +0000",
    });
  });

  it("adds the missing base currency for the frankfurter shape", () => {
    expect(parseRates({ base: "EUR", date: "2026-11-13", rates: { USD: 1.1 } })).toEqual({
      rates: { USD: 1.1, EUR: 1 },
      updated: "2026-11-13",
    });
  });

  it("returns an empty table for malformed input", () => {
    const empty = { rates: {}, updated: "" };
    expect(parseRates(null)).toEqual(empty);
    expect(parseRates("x")).toEqual(empty);
    expect(parseRates({})).toEqual(empty);
    expect(parseRates({ rates: 5 })).toEqual(empty);
    expect(parseRates({ rates: {}, base: "eur" })).toEqual(empty);
  });
});

describe("convertCurrency", () => {
  it("converts through the common base (cross rate = to / from)", () => {
    const r = convertCurrency(100, "EUR", "GBP", RATES);
    // 1 EUR = 0.5 / 0.8 = 0.625 GBP
    expect(r.rate).toBeCloseTo(0.625, 12);
    expect(r.inverseRate).toBeCloseTo(1.6, 12);
    expect(r.converted).toBeCloseTo(62.5, 10);
    expect(r.amount).toBe(100);
  });

  it("is the identity for the same currency", () => {
    expect(convertCurrency(42, "JPY", "JPY", RATES).converted).toBe(42);
  });

  it("allows zero and returns the zero result for negatives, NaN and unknown codes", () => {
    expect(convertCurrency(0, "USD", "EUR", RATES).converted).toBe(0);
    for (const r of [
      convertCurrency(-1, "USD", "EUR", RATES),
      convertCurrency(Number.NaN, "USD", "EUR", RATES),
      convertCurrency(Number.POSITIVE_INFINITY, "USD", "EUR", RATES),
      convertCurrency(1, "USD", "XXX", RATES),
      convertCurrency(1, "XXX", "USD", RATES),
    ]) {
      expect(r.converted).toBe(0);
      expect(r.rate).toBe(0);
      expect(r.inverseRate).toBe(0);
    }
  });

  it("says why nothing was converted", () => {
    expect(convertCurrency(0, "USD", "EUR", RATES)).not.toHaveProperty("error");
    expect(convertCurrency(-1, "USD", "EUR", RATES).error).toBe("invalid-amount");
    expect(convertCurrency(Number.NaN, "USD", "EUR", RATES).error).toBe("invalid-amount");
    expect(convertCurrency(1, "USD", "XXX", RATES)).toMatchObject({
      error: "unknown-currency",
      unknownCurrency: "XXX",
    });
    expect(convertCurrency(1, "XXX", "USD", RATES).unknownCurrency).toBe("XXX");
    // Inherited object keys are not currencies.
    expect(convertCurrency(1, "constructor", "USD", RATES).error).toBe("unknown-currency");
    expect(convertCurrency(1, "USD", "EUR", null as unknown as Record<string, number>).error).toBe(
      "unknown-currency",
    );
  });
});

describe("formatting helpers", () => {
  it("lists ten popular currencies", () => {
    expect(POPULAR_CURRENCIES).toHaveLength(10);
    expect(POPULAR_CURRENCIES).toContain("RUB");
  });

  it("names currencies via Intl and falls back to the code", () => {
    expect(currencyName("EUR")).toBe("Euro");
    expect(currencyName("USD", "ru")).toBe("доллар США");
    expect(currencyName("not-a-code")).toBe("not-a-code");
  });

  it("formats amounts with the currency code", () => {
    expect(norm(formatAmount(1234.5, "USD"))).toBe("USD 1,234.50");
    expect(formatAmount(Number.NaN, "USD")).toBe("0");
    // Invalid currency code falls back to plain number + code
    expect(norm(formatAmount(1234.567, "??"))).toBe("1,234.57 ??");
  });

  it("formats rates with 4 decimals above 1 and 4 significant digits below", () => {
    expect(formatRate(150.123456)).toBe("150.1235");
    expect(formatRate(0.0066666)).toBe("0.006667");
    expect(formatRate(0)).toBe("0");
    expect(formatRate(-2)).toBe("0");
    expect(formatRate(Number.NaN)).toBe("0");
  });
});
