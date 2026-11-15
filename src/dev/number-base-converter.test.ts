import { describe, expect, it } from "vitest";
import { convertBase, solveConversion } from "./number-base-converter.js";

const INVALID = { binary: "", octal: "", decimal: "", hex: "", isValid: false };
const bad = (error: string) => ({ ...INVALID, error });

describe("convertBase", () => {
  it("converts 255 from every base (FF = 377 = 11111111)", () => {
    const expected = {
      binary: "11111111",
      octal: "377",
      decimal: "255",
      hex: "FF",
      isValid: true,
      error: null,
      value: 255n,
    };
    expect(convertBase("255", 10)).toEqual(expected);
    expect(convertBase("11111111", 2)).toEqual(expected);
    expect(convertBase("377", 8)).toEqual(expected);
    expect(convertBase("ff", 16)).toEqual(expected);
    expect(convertBase("FF", 16)).toEqual(expected);
  });

  it("converts zero", () => {
    expect(convertBase("0", 10)).toEqual({
      binary: "0",
      octal: "0",
      decimal: "0",
      hex: "0",
      isValid: true,
      error: null,
      value: 0n,
    });
  });

  it("converts 2^53 - 1 exactly", () => {
    // 9007199254740991 = 0x1FFFFFFFFFFFFF = 53 ones in binary
    const r = convertBase("9007199254740991", 10);
    expect(r.hex).toBe("1FFFFFFFFFFFFF");
    expect(r.binary).toBe("1".repeat(53));
    expect(r.octal).toBe("377777777777777777");
  });

  it("keeps leading zeros out of the outputs", () => {
    // 0010 binary = 2
    expect(convertBase("0010", 2).decimal).toBe("2");
  });

  it("trims surrounding whitespace", () => {
    expect(convertBase("  42 \n", 10).hex).toBe("2A");
  });

  it("returns the invalid result for empty and whitespace input", () => {
    expect(convertBase("", 10)).toMatchObject({ ...INVALID, error: null });
    expect(convertBase("   ", 16)).toMatchObject({ ...INVALID, error: null });
  });

  it("rejects digits that are not valid in the source base", () => {
    expect(convertBase("102", 2)).toMatchObject(bad("bad-digit"));
    expect(convertBase("8", 8)).toMatchObject(bad("bad-digit"));
    expect(convertBase("1A", 10)).toMatchObject(bad("bad-digit"));
    expect(convertBase("G", 16)).toMatchObject(bad("bad-digit"));
  });

  it("rejects negative numbers and fractions with a reason", () => {
    expect(convertBase("-5", 10)).toMatchObject(bad("negative"));
    expect(convertBase("1.5", 10)).toMatchObject(bad("fraction"));
    expect(convertBase("1,5", 10)).toMatchObject(bad("fraction"));
  });

  it("ignores spaces and underscores between digits", () => {
    // Was rejected before: textbooks group binary digits in fours.
    expect(convertBase("1101 0011", 2).decimal).toBe("211");
    expect(convertBase("1 0", 2).decimal).toBe("2");
    expect(convertBase("1_000", 10).binary).toBe("1111101000");
  });

  it("accepts the 0b and 0o prefixes as well as 0x", () => {
    expect(convertBase("0b1010", 2).decimal).toBe("10");
    expect(convertBase("0o17", 8).decimal).toBe("15");
    expect(convertBase("0X1f", 16).decimal).toBe("31");
    expect(convertBase("0b1010", 10)).toMatchObject(bad("bad-digit"));
  });

  it("rejects non-ASCII digits and Cyrillic look-alikes", () => {
    expect(convertBase("١٢", 10)).toMatchObject(bad("bad-digit")); // Arabic-Indic digits
    expect(convertBase("А", 16)).toMatchObject(bad("bad-digit")); // Cyrillic А
  });

  it("accepts a 0x prefix on hex input as the page promises", () => {
    expect(convertBase("0xFF", 16).decimal).toBe("255");
  });

  it("does not return an imprecise decimal for 64-bit values", () => {
    expect(convertBase("FFFFFFFFFFFFFFFF", 16).decimal).toBe("18446744073709551615");
  });

  it("stops at the documented maximum, 2^64 - 1", () => {
    expect(convertBase("18446744073709551615", 10).hex).toBe("FFFFFFFFFFFFFFFF");
    expect(convertBase("10000000000000000", 16)).toMatchObject(bad("too-large"));
  });

  it("returns the invalid result for absurdly long input instead of Infinity text", () => {
    // parseInt of 400 nines is Infinity -> engine must report invalid, not throw
    expect(convertBase("9".repeat(400), 10)).toMatchObject(bad("too-large"));
  });
});

describe("solveConversion (step-by-step solution)", () => {
  it("binary → decimal: digit × power of 2, then the sum", () => {
    const s = solveConversion(13n, 2, 10);
    expect(s?.kind).toBe("positional");
    if (s?.kind !== "positional") return;
    expect(s.terms.map((t) => [t.digit, t.power, t.product])).toEqual([
      ["1", 3, 8n],
      ["1", 2, 4n],
      ["0", 1, 0n],
      ["1", 0, 1n],
    ]);
    expect(s.result).toBe(13n);
  });

  it("hex → decimal uses the letter's value", () => {
    const s = solveConversion(255n, 16, 10);
    if (s?.kind !== "positional") throw new Error("kind");
    expect(s.terms.map((t) => [t.digit, t.digitValue, t.product])).toEqual([
      ["F", 15, 240n],
      ["F", 15, 15n],
    ]);
  });

  it("decimal → binary: division by 2, remainders read bottom-up", () => {
    const s = solveConversion(13n, 10, 2);
    if (s?.kind !== "division") throw new Error("kind");
    expect(s.rows.map((r) => [r.dividend, r.quotient, r.remainder])).toEqual([
      [13n, 6n, 1],
      [6n, 3n, 0],
      [3n, 1n, 1],
      [1n, 0n, 1],
    ]);
    expect(s.result).toBe("1101");
    expect(solveConversion(255n, 10, 16)).toMatchObject({ result: "FF" });
    expect(solveConversion(0n, 10, 2)).toMatchObject({ result: "0" });
  });

  it("binary ↔ octal/hex by groups of three or four bits", () => {
    expect(solveConversion(211n, 2, 16)).toMatchObject({
      kind: "group",
      direction: "pack",
      groupBits: 4,
      groups: [
        { bits: "1101", digit: "D" },
        { bits: "0011", digit: "3" },
      ],
      result: "D3",
    });
    expect(solveConversion(13n, 2, 8)).toMatchObject({
      groups: [
        { bits: "001", digit: "1" },
        { bits: "101", digit: "5" },
      ],
      result: "15",
    });
    expect(solveConversion(13n, 8, 2)).toMatchObject({ direction: "unpack", result: "1101" });
  });

  it("octal ↔ hex goes through binary", () => {
    const s = solveConversion(255n, 8, 16);
    expect(s?.kind).toBe("via-binary");
    if (s?.kind !== "via-binary") return;
    expect(s.first.result).toBe("11111111");
    expect(s.second.result).toBe("FF");
  });

  it("no steps for the same base or beyond 64 bits", () => {
    expect(solveConversion(5n, 10, 10)).toBeNull();
    expect(solveConversion(1n << 64n, 10, 2)).toBeNull();
  });
});
