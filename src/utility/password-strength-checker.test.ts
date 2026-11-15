import { describe, expect, it } from "vitest";
import { checkPasswordStrength } from "./password-strength-checker.js";

const YEAR = 31_557_600;
/** Expected offline crack time: half the keyspace at 1e10 guesses/s. */
const crackSeconds = (bits: number) => 2 ** bits / 2e10;

describe("checkPasswordStrength", () => {
  it("returns the empty result for an empty password", () => {
    const r = checkPasswordStrength("");
    expect(r).toMatchObject({
      length: 0,
      poolSize: 0,
      entropyBits: 0,
      score: 0,
      label: "very-weak",
      crackTime: { value: 0, unit: "instant" },
      feedback: [],
    });
  });

  it("detects character classes and the guessing pool", () => {
    expect(checkPasswordStrength("abc")).toMatchObject({ hasLower: true, poolSize: 26 });
    expect(checkPasswordStrength("aB1")).toMatchObject({
      hasUpper: true,
      hasDigit: true,
      poolSize: 62,
    });
    expect(checkPasswordStrength("aB1!")).toMatchObject({ hasSymbol: true, poolSize: 95 });
  });

  it("collapses common passwords to ~8 bits", () => {
    const r = checkPasswordStrength("Password");
    // raw: 8 * log2(52) = 45.6 -> 46; capped at 8 because "password" is in the breach list
    expect(r.entropyBits).toBe(46);
    expect(r.effectiveEntropyBits).toBe(8);
    expect(r.score).toBe(0);
    expect(r.crackTime.unit).toBe("instant");
    expect(r.feedback).toEqual(["common", "add-length", "add-numbers", "add-symbols"]);
  });

  it("penalises keyboard / alphabet sequences and repeats by 8 bits each", () => {
    // abcd1234: 8 * log2(36) = 41.36, sequence -8 = 33.36 -> 33, weak
    const seq = checkPasswordStrength("abcd1234");
    expect(seq.effectiveEntropyBits).toBe(33);
    expect(seq.label).toBe("weak");
    expect(seq.feedback).toContain("sequence");
    // reversed runs count too
    expect(checkPasswordStrength("x9876x").feedback).toContain("sequence");
    expect(checkPasswordStrength("zzlkjhgf").feedback).toContain("sequence");
    // aaaaaa: 6 * log2(26) = 28.2, repeats -8 = 20.2 -> 20
    const rep = checkPasswordStrength("aaaaaa");
    expect(rep.effectiveEntropyBits).toBe(20);
    expect(rep.feedback.slice(0, 1)).toEqual(["repeats"]);
    // two repeats of a char are fine, three are not
    expect(checkPasswordStrength("aab").feedback).not.toContain("repeats");
  });

  it("never reports negative effective entropy", () => {
    // "000000" is common (capped at 8) and repeats (-8) -> 0, not -something
    expect(checkPasswordStrength("000000").effectiveEntropyBits).toBe(0);
    expect(checkPasswordStrength("000000").crackTime.unit).toBe("instant");
  });

  it("scores the classic Tr0ub4dor&3 as strong (72 bits, centuries offline)", () => {
    const r = checkPasswordStrength("Tr0ub4dor&3");
    // 11 * log2(95) = 72.27
    expect(r.entropyBits).toBe(72);
    expect(r.score).toBe(3);
    expect(r.label).toBe("strong");
    expect(r.crackTime).toEqual({ value: 0, unit: "century" });
    expect(r.feedback).toEqual(["add-length"]);
  });

  it("gives a long mixed password the 'excellent' feedback", () => {
    const r = checkPasswordStrength("xK9#mP2$vL7@nQ4&wR8!");
    // 20 * log2(95) = 131.4
    expect(r.score).toBe(4);
    expect(r.label).toBe("very-strong");
    expect(r.feedback).toEqual(["excellent"]);
  });

  it("buckets crack times into human units", () => {
    // lowercase, no patterns: 26^n / 2e10 seconds
    const cases: Array<[string, number, string]> = [
      ["jxqzvkwpg", Math.round(crackSeconds(9 * Math.log2(26)) / 60), "minute"], // 271 s -> 5 min
      ["jxqzvkwpgh", Math.round(crackSeconds(10 * Math.log2(26)) / 3600), "hour"], // 7 058 s -> 2 h
      ["jxqzvkwpghr", Math.round(crackSeconds(11 * Math.log2(26)) / 86_400), "day"], // 2.1 d -> 2
      ["jxqzvkwpghrt", Math.round(crackSeconds(12 * Math.log2(26)) / 2_629_800), "month"], // 1.8 -> 2
      ["jxqzvkwpghrtc", Math.round(crackSeconds(13 * Math.log2(26)) / YEAR), "year"], // 3.9 -> 4
    ];
    for (const [pw, value, unit] of cases) {
      expect(checkPasswordStrength(pw).crackTime).toEqual({ value, unit });
    }
    expect(cases.map((c) => c[1])).toEqual([5, 2, 2, 2, 4]);
    expect(checkPasswordStrength("jxqzvkwpghrtcfs").crackTime.unit).toBe("century");
  });

  it("maps score thresholds 28 / 36 / 60 / 120 bits", () => {
    // lowercase n chars = 4.70 n bits
    expect(checkPasswordStrength("jxqzvk").score).toBe(1); // 28.2
    expect(checkPasswordStrength("jxqzvkwp").score).toBe(2); // 37.6
    expect(checkPasswordStrength("jxqzvkwpghrtc").score).toBe(3); // 61.1
  });

  it("counts spaces and non-ASCII as symbols", () => {
    expect(checkPasswordStrength("a b").hasSymbol).toBe(true);
    expect(checkPasswordStrength("пароль").poolSize).toBe(33);
  });

  it("recognises mixed case in a Cyrillic password", () => {
    expect(checkPasswordStrength("ПарОльЁж").feedback).not.toContain("mix-case");
  });
});
