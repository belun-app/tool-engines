import { describe, expect, it, vi } from "vitest";
import { scriptedRandom, seededRandom } from "../_random.js";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type PasswordOptions,
  generatePassword,
  passwordEntropy,
} from "./random-password-generator.js";

const all: PasswordOptions = {
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
};

const none = { uppercase: false, lowercase: false, numbers: false, symbols: false };

describe("generatePassword", () => {
  it("returns an empty weak result with an error code for no charset or a bad length", () => {
    const empty = { password: "", strength: "weak", entropy: 0, charsetSize: 0, clamped: false };
    expect(generatePassword({ ...all, ...none })).toEqual({ ...empty, errorCode: "no-charset" });
    expect(generatePassword({ ...all, length: 0 })).toEqual({
      ...empty,
      errorCode: "invalid-length",
    });
    expect(generatePassword({ ...all, length: -5 }).errorCode).toBe("invalid-length");
  });

  it("uses only the selected character sets", () => {
    const digits = generatePassword({ ...all, ...none, numbers: true, length: 64 });
    expect(digits.password).toMatch(/^[0-9]{64}$/);
    expect(digits.charsetSize).toBe(10);
    const lower = generatePassword({ ...all, ...none, lowercase: true, length: 64 });
    expect(lower.password).toMatch(/^[a-z]{64}$/);
  });

  it("has a 26+26+10+26 = 88 character pool with everything on", () => {
    expect(generatePassword(all).charsetSize).toBe(88);
  });

  it("maps accepted random words onto the charset", () => {
    // Upper + lower: 52 characters. Words 0, 1, 26, 27 -> "A", "B", "a", "b".
    const r = generatePassword({
      ...all,
      numbers: false,
      symbols: false,
      length: 4,
      rng: scriptedRandom([0, 1, 26, 27]),
    });
    expect(r.password).toBe("ABab");
  });

  it("rejects biased words instead of wrapping them with %", () => {
    // 2^32 % 10 = 6, so the top 6 words are rejected for a 10-character charset.
    const top = 2 ** 32 - 1;
    const rng = vi.fn(scriptedRandom([top, 1, 2, 3, 4]));
    const r = generatePassword({ ...all, ...none, numbers: true, length: 4, rng });
    expect(r.password).toBe("1234");
    expect(rng).toHaveBeenCalledTimes(5);
  });

  it("redraws a password that misses a selected class", () => {
    // First draw "AAAA" (no lowercase) is discarded, the second "aAAA" is kept.
    const rng = scriptedRandom([0, 0, 0, 0, 26, 0, 0, 0]);
    const r = generatePassword({ ...all, numbers: false, symbols: false, length: 4, rng });
    expect(r.password).toBe("aAAA");
  });

  it("contains every selected class, for many seeds and the shortest length", () => {
    for (let seed = 0; seed < 200; seed++) {
      const { password } = generatePassword({ ...all, length: 4, rng: seededRandom(seed) });
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it("still contains every class with a degenerate source", () => {
    const r = generatePassword({ ...all, length: 4, rng: () => 0 });
    expect(r.password).toHaveLength(4);
    expect(r.password).toMatch(/[A-Z]/);
    expect(r.password).toMatch(/[a-z]/);
    expect(r.password).toMatch(/[0-9]/);
    expect(r.password).toMatch(/[^A-Za-z0-9]/);
  });

  it("clamps the length to MIN..MAX and flags it", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(4);
    expect(MAX_PASSWORD_LENGTH).toBe(128);
    const short = generatePassword({ ...all, length: 2 });
    expect(short.password).toHaveLength(4);
    expect(short.clamped).toBe(true);
    const long = generatePassword({ ...all, length: 500 });
    expect(long.password).toHaveLength(128);
    expect(long.clamped).toBe(true);
    const fraction = generatePassword({ ...all, length: 12.9 });
    expect(fraction.password).toHaveLength(12);
    expect(fraction.clamped).toBe(true);
    expect(generatePassword(all).clamped).toBe(false);
  });

  it("counts entropy over passwords that contain every class and buckets strength", () => {
    // One class: plain log2(pool) * length. 10 digits * 8: 26.6 -> 27 bits, weak.
    expect(generatePassword({ ...all, ...none, numbers: true, length: 8 })).toMatchObject({
      entropy: 27,
      strength: "weak",
    });
    // 62 characters * 8 is 47.6 bits; requiring all three classes leaves 47.2.
    expect(generatePassword({ ...all, symbols: false, length: 8 })).toMatchObject({
      entropy: 47,
      strength: "fair",
    });
    expect(generatePassword({ ...all, symbols: false, length: 12 })).toMatchObject({
      entropy: 71,
      strength: "strong",
    });
    expect(generatePassword(all)).toMatchObject({ entropy: 103, strength: "very-strong" });
  });

  it("passwordEntropy matches a brute-force count on a tiny alphabet", () => {
    // Classes of sizes 1 and 2 (alphabet {a, b, c}), length 3: 27 strings, minus 8 without
    // "a" and 1 without "b"/"c" -> 18.
    expect(2 ** passwordEntropy([1, 2], 3)).toBeCloseTo(18, 9);
    expect(passwordEntropy([10], 8)).toBeCloseTo(8 * Math.log2(10), 9);
    expect(passwordEntropy([], 8)).toBe(0);
  });

  it("produces different passwords on successive calls with Web Crypto", () => {
    expect(generatePassword(all).password).not.toBe(generatePassword(all).password);
  });

  it("is reproducible with a seeded source", () => {
    const a = generatePassword({ ...all, rng: seededRandom(5) }).password;
    expect(generatePassword({ ...all, rng: seededRandom(5) }).password).toBe(a);
  });

  it("treats a NaN length as invalid", () => {
    const r = generatePassword({ ...all, length: Number.NaN });
    expect(r.strength).toBe("weak");
    expect(r.errorCode).toBe("invalid-length");
    expect(Number.isNaN(r.entropy)).toBe(false);
  });

  it("reports missing Web Crypto instead of throwing", () => {
    vi.stubGlobal("crypto", undefined);
    expect(generatePassword(all)).toMatchObject({ password: "", errorCode: "no-secure-random" });
    expect(generatePassword({ ...all, rng: seededRandom(1) }).password).toHaveLength(16);
  });
});
