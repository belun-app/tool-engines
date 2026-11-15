import { describe, expect, it } from "vitest";
import { generateBarcode } from "./barcode-generator.js";

/** Expand run-length module widths (bar first) back into a 1/0 module string. */
function toBinary(widths: number[]): string {
  return widths.map((w, i) => (i % 2 === 0 ? "1" : "0").repeat(w)).join("");
}

/** Split Code 128 widths into 6-wide symbols (the trailing stop symbol is 7 wide). */
function code128Symbols(widths: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < widths.length - 7; i += 6) out.push(widths.slice(i, i + 6).join(""));
  out.push(widths.slice(-7).join(""));
  return out;
}

// EAN/UPC digit encodings from the GS1 General Specifications (figure 5.2.1.2.1-2).
const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
// R = bitwise complement of L, G = R reversed.
const R = L.map((s) => [...s].map((b) => (b === "1" ? "0" : "1")).join(""));
const G = R.map((s) => [...s].reverse().join(""));

describe("EAN-13", () => {
  it("computes the GS1 check digit for real barcodes", () => {
    // Stabilo pen (Wikipedia's EAN-13 example), GS1's example number, an ISBN-13.
    expect(generateBarcode("400638133393", "ean13").text).toBe("4006381333931");
    expect(generateBarcode("590123412345", "ean13").text).toBe("5901234123457");
    expect(generateBarcode("978030640615", "ean13").text).toBe("9780306406157");
    // 12 zeros: sum 0 -> check 0
    expect(generateBarcode("000000000000", "ean13").text).toBe("0000000000000");
  });

  it("accepts a full code with the right check digit and refuses a wrong one", () => {
    expect(generateBarcode("4006381333931", "ean13").text).toBe("4006381333931");
    const r = generateBarcode("4006381333930", "ean13");
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("check-digit");
    expect(r.expectedCheckDigit).toBe("1");
    expect(r.typedCheckDigit).toBe("0");
    expect(r.widths).toEqual([]);
  });

  it("ignores non-digit separators", () => {
    const r = generateBarcode(" 400-638 133.393 ", "ean13");
    expect(r.ok).toBe(true);
    expect(r.text).toBe("4006381333931");
    expect(r.displayText).toBe("4 006381 333931");
  });

  it("encodes the bars exactly per the GS1 tables (leading 4 -> parity LGLLGG)", () => {
    const r = generateBarcode("400638133393", "ean13");
    const left = [L[0], G[0], L[6], L[3], G[8], G[1]].join("");
    const right = [R[3], R[3], R[3], R[9], R[3], R[1]].join("");
    const expected = `101${left}01010${right}101`;
    expect(toBinary(r.widths)).toBe(expected);
    // 3 + 6*7 + 5 + 6*7 + 3 = 95 modules
    expect(r.widths.reduce((a, b) => a + b, 0)).toBe(95);
  });

  it("starts and ends every symbol with a bar and uses widths 1..4 only", () => {
    const r = generateBarcode("590123412345", "ean13");
    expect(r.widths.length % 2).toBe(1);
    expect(r.widths.every((w) => w >= 1 && w <= 4)).toBe(true);
  });

  it("returns an empty, error-free result for empty / non-digit input", () => {
    for (const input of ["", "   ", "abc"]) {
      const r = generateBarcode(input, "ean13");
      expect(r.ok).toBe(false);
      expect(r.error).toBeNull();
      expect(r.widths).toEqual([]);
    }
  });

  it("rejects wrong lengths with an error", () => {
    for (const input of ["12345", "12345678901", "12345678901234"]) {
      const r = generateBarcode(input, "ean13");
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/12 digits/);
    }
  });

  it("reserves the GS1 quiet zones: EAN-13 11/7+, UPC-A 9/9+, Code 128 10/10", () => {
    const e = generateBarcode("400638133393", "ean13");
    expect(e.quietZoneModules).toBeGreaterThanOrEqual(11);
    expect(e.quietZoneRightModules).toBeGreaterThanOrEqual(7);
    const u = generateBarcode("03600029145", "upca");
    expect(Math.min(u.quietZoneModules, u.quietZoneRightModules)).toBeGreaterThanOrEqual(9);
    const c = generateBarcode("ABC", "code128");
    expect(Math.min(c.quietZoneModules, c.quietZoneRightModules)).toBeGreaterThanOrEqual(10);
  });

  it("returns an error code the page can translate", () => {
    expect(generateBarcode("123", "ean13").errorCode).toBe("ean13-length");
    expect(generateBarcode("123", "upca").errorCode).toBe("upca-length");
    expect(generateBarcode("x".repeat(49), "code128").errorCode).toBe("too-long");
    expect(generateBarcode("Привет", "code128").errorCode).toBe("non-ascii");
    expect(generateBarcode("036000291453", "upca")).toMatchObject({
      errorCode: "check-digit",
      expectedCheckDigit: "2",
    });
    expect(generateBarcode("ABC", "code128").errorCode).toBeNull();
  });
});

describe("UPC-A", () => {
  it("computes the check digit for real UPCs", () => {
    // Wrigley's gum (Wikipedia's UPC-A example) and the canonical 01234567890-5.
    expect(generateBarcode("03600029145", "upca").text).toBe("036000291452");
    expect(generateBarcode("01234567890", "upca").text).toBe("012345678905");
  });

  it("groups the display text as N NNNNN NNNNN C", () => {
    expect(generateBarcode("03600029145", "upca").displayText).toBe("0 36000 29145 2");
  });

  it("encodes L-codes on the left and R-codes on the right", () => {
    const r = generateBarcode("03600029145", "upca");
    const d = "036000291452".split("").map(Number);
    const expected = `101${d
      .slice(0, 6)
      .map((n) => L[n])
      .join("")}01010${d
      .slice(6)
      .map((n) => R[n])
      .join("")}101`;
    expect(toBinary(r.widths)).toBe(expected);
  });

  it("is bar-for-bar identical to the EAN-13 with a leading 0", () => {
    const upc = generateBarcode("03600029145", "upca");
    const ean = generateBarcode("003600029145", "ean13");
    expect(ean.text).toBe(`0${upc.text}`);
    expect(upc.widths).toEqual(ean.widths);
  });

  it("validates the length and tolerates empty input", () => {
    expect(generateBarcode("123", "upca").error).toMatch(/11 digits/);
    expect(generateBarcode("1234567890123", "upca").ok).toBe(false);
    expect(generateBarcode("", "upca")).toMatchObject({ ok: false, error: null });
  });
});

describe("Code 128", () => {
  it("uses Start B and the published pattern for text", () => {
    const r = generateBarcode("A", "code128");
    const syms = code128Symbols(r.widths);
    // Start B = 211214, 'A' (value 33) = 111323, check = (104 + 33*1) % 103 = 34 -> 131123, stop 2331112
    expect(syms).toEqual(["211214", "111323", "131123", "2331112"]);
  });

  it("computes the weighted mod-103 checksum", () => {
    // PJJ123C in subset B: 104 + 48*1 + 42*2 + 42*3 + 17*4 + 18*5 + 19*6 + 35*7 = 879; 879 % 103 = 55
    const r = generateBarcode("PJJ123C", "code128");
    const syms = code128Symbols(r.widths);
    expect(syms).toHaveLength(1 + 7 + 1 + 1);
    // value 55 in subset B is 'W' (55 + 32 = 87)
    const w = code128Symbols(generateBarcode("W", "code128").widths)[1];
    expect(syms[8]).toBe(w);
  });

  it("switches to subset C for an even number of digits", () => {
    const r = generateBarcode("123456", "code128");
    const syms = code128Symbols(r.widths);
    // Start C = 211232; pairs 12, 34, 56; check (105 + 12 + 34*2 + 56*3) % 103 = 353 % 103 = 44
    expect(syms[0]).toBe("211232");
    expect(syms).toHaveLength(1 + 3 + 1 + 1);
    // value 12 = 112232, value 34 = 131123, value 56 = 331121, value 44 = 132131 (ISO/IEC 15417 table)
    expect(syms.slice(1, 5)).toEqual(["112232", "131123", "331121", "132131"]);
  });

  it("starts an odd number of digits in subset B, then switches to C", () => {
    const syms = code128Symbols(generateBarcode("12345", "code128").widths);
    // Start B, "1", CODE C (99 = 113141), 23, 45, check, stop
    expect(syms[0]).toBe("211214");
    expect(syms[2]).toBe("113141");
    expect(syms).toHaveLength(7);
  });

  it("packs digit runs into subset C as label printers do", () => {
    const modules = (s: string) => generateBarcode(s, "code128").widths.reduce((a, b) => a + b, 0);
    // StartB 1 CodeC 23 45 67 89 chk stop: 8 symbols * 11 + 13
    expect(modules("123456789")).toBe(101);
    // StartB S N 0 CodeC 00 12 34 56 78 chk stop: 11 symbols * 11 + 13
    expect(modules("SN00012345678")).toBe(134);
    // A short run in the middle stays in B: "AB12CD" is 6 B symbols + start + check
    expect(modules("AB12CD")).toBe(8 * 11 + 13);
    // 6 digits in the middle switch to C and back: StartB A CodeC 12 34 56 CodeB B chk
    // = 9 symbols, against 10 in plain subset B
    expect(modules("A123456B")).toBe(9 * 11 + 13);
  });

  it("every one of the 100 subset-C symbols is 11 modules with an even bar sum (spec invariant)", () => {
    const seen = new Set<string>();
    for (let start = 0; start < 100; start += 24) {
      const pairs = [];
      for (let v = start; v < Math.min(start + 24, 100); v++)
        pairs.push(String(v).padStart(2, "0"));
      const syms = code128Symbols(generateBarcode(pairs.join(""), "code128").widths);
      for (const s of syms.slice(1, 1 + pairs.length)) {
        const n = s.split("").map(Number);
        expect(n.reduce((a, b) => a + b, 0)).toBe(11);
        expect((n[0] + n[2] + n[4]) % 2).toBe(0);
        seen.add(s);
      }
    }
    // all 100 values encode to distinct patterns
    expect(seen.size).toBe(100);
  });

  it("stop pattern makes the whole symbol 11*(n+2)+13 modules", () => {
    // "Hi": start + 2 chars + check = 4 symbols * 11 + stop 13 = 57
    const r = generateBarcode("Hi", "code128");
    expect(r.widths.reduce((a, b) => a + b, 0)).toBe(57);
  });

  it("trims the input and accepts printable ASCII including space", () => {
    const r = generateBarcode("  Hello World 123  ", "code128");
    expect(r.ok).toBe(true);
    expect(r.text).toBe("Hello World 123");
    expect(r.displayText).toBe("Hello World 123");
    expect(generateBarcode("~!@#", "code128").ok).toBe(true);
  });

  it("rejects non-ASCII (Cyrillic, emoji, control chars)", () => {
    for (const s of ["Привет", "hi 👍", "a\tb", "café"]) {
      const r = generateBarcode(s, "code128");
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/ASCII/);
    }
  });

  it("enforces the 48-character limit", () => {
    expect(generateBarcode("x".repeat(48), "code128").ok).toBe(true);
    const r = generateBarcode("x".repeat(49), "code128");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/48/);
  });

  it("returns the empty result for blank input", () => {
    expect(generateBarcode("   ", "code128")).toMatchObject({ ok: false, error: null, text: "" });
  });
});
