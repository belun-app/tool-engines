import { describe, expect, it } from "vitest";
import {
  detectBrand,
  formatCardNumber,
  getBrandInfo,
  listBrands,
  luhnCheck,
  validateCardNumber,
} from "./credit-card-validator.js";

/** Independent Luhn check-digit generator for building test numbers. */
function withCheckDigit(partial: string): string {
  let sum = 0;
  // The check digit will sit at the rightmost position, so the rightmost partial digit is doubled.
  for (let i = 0; i < partial.length; i++) {
    let d = Number(partial[partial.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return partial + ((10 - (sum % 10)) % 10);
}

describe("luhnCheck", () => {
  it("accepts well-known test numbers and rejects a single-digit change", () => {
    expect(luhnCheck("4111111111111111")).toBe(true);
    expect(luhnCheck("4111111111111112")).toBe(false);
    expect(luhnCheck("79927398713")).toBe(true); // the textbook Luhn example
    expect(luhnCheck("79927398710")).toBe(false);
  });

  it("rejects too-short and non-digit input", () => {
    expect(luhnCheck("")).toBe(false);
    expect(luhnCheck("0")).toBe(false);
    expect(luhnCheck("4111 1111")).toBe(false);
  });
});

describe("detectBrand", () => {
  it.each([
    ["4111111111111111", "visa"],
    ["5555555555554444", "mastercard"],
    ["2223003122003222", "mastercard"], // 2-series
    ["2720990000000000", "mastercard"],
    ["378282246310005", "amex"],
    ["341111111111111", "amex"],
    ["6011111111111117", "discover"],
    ["6500000000000000", "discover"],
    ["6440000000000000", "discover"],
    ["6221260000000000", "discover"], // co-branded range inside 62
    ["6200000000000000", "unionpay"],
    ["8100000000000000", "unionpay"],
    ["2200000000000000", "mir"],
    ["2204990000000000", "mir"],
    ["3530111333300000", "jcb"],
    ["30569309025904", "diners"],
    ["36000000000000", "diners"],
    ["5018000000000000", "maestro"],
    ["6759649826438453", "maestro"],
    ["9999999999999999", "unknown"],
    ["", "unknown"],
  ])("%s -> %s", (digits, brand) => {
    expect(detectBrand(digits)).toBe(brand);
  });
});

describe("formatCardNumber", () => {
  it("groups by brand gaps and handles partial input", () => {
    expect(formatCardNumber("4111111111111111", [4, 8, 12])).toBe("4111 1111 1111 1111");
    expect(formatCardNumber("378282246310005", [4, 10])).toBe("3782 822463 10005");
    expect(formatCardNumber("41111", [4, 8, 12])).toBe("4111 1");
    expect(formatCardNumber("4111", [4, 8, 12])).toBe("4111");
    expect(formatCardNumber("", [4])).toBe("");
  });
});

describe("validateCardNumber", () => {
  it("validates known test cards of each brand", () => {
    for (const n of [
      "4111111111111111",
      "4222222222222", // 13-digit Visa
      "5555555555554444",
      "2223003122003222",
      "378282246310005",
      "6011111111111117",
      "3530111333300000",
      "30569309025904",
      withCheckDigit("220000000000000"), // Mir, 16 digits
      withCheckDigit("620000000000000"), // UnionPay, 16 digits
      withCheckDigit("67596498264384"), // Maestro, 15 digits
    ]) {
      const r = validateCardNumber(n);
      expect(r.valid, n).toBe(true);
      expect(r.issue, n).toBe("");
    }
  });

  it("strips spaces/dashes, formats, and exposes IIN and CVV length", () => {
    const r = validateCardNumber(" 3782-822463-10005 ");
    expect(r.digits).toBe("378282246310005");
    expect(r.formatted).toBe("3782 822463 10005");
    expect(r.brandLabel).toBe("American Express");
    expect(r.cvvLength).toBe(4);
    expect(r.iin).toBe("378282");
    expect(r.expectedLengths).toEqual([15]);
    expect(validateCardNumber("41111").iin).toBe("");
  });

  it("reports luhn, bad-length and unknown-brand issues in priority order", () => {
    expect(validateCardNumber("4111111111111112").issue).toBe("luhn");
    // 15-digit Visa fails length even with a valid check digit
    const bad = withCheckDigit("41111111111111");
    expect(validateCardNumber(bad).luhnValid).toBe(true);
    expect(validateCardNumber(bad).issue).toBe("bad-length");
    expect(validateCardNumber(withCheckDigit("999999999999999")).issue).toBe("unknown-brand");
  });

  it("distinguishes empty from non-digit input", () => {
    expect(validateCardNumber("").issue).toBe("empty");
    expect(validateCardNumber("   ").issue).toBe("empty");
    expect(validateCardNumber("abcd").issue).toBe("non-digits");
    expect(validateCardNumber("x9999").issue).toBe("non-digits");
    // letters inside a recognisable number fall through to the brand checks
    expect(validateCardNumber("4111x").issue).toBe("bad-length");
  });
});

describe("brand metadata", () => {
  it("returns copies and an Unknown fallback", () => {
    const list = listBrands();
    expect(list.map((b) => b.brand)).toContain("mir");
    list[0].lengths.push(99);
    expect(getBrandInfo("visa").lengths).toEqual([13, 16, 19]);
    expect(getBrandInfo("unknown").label).toBe("Unknown");
  });
});
