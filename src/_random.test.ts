import { describe, expect, it, vi } from "vitest";
import {
  SecureRandomUnavailableError,
  hasSecureRandom,
  pick,
  randomFloat,
  randomInt,
  randomUint32,
  scriptedRandom,
  secureRandom,
  seededRandom,
  shuffle,
} from "./_random.js";

const TWO_32 = 2 ** 32;
const TWO_53 = 2 ** 53;

describe("randomInt", () => {
  it("maps an accepted word to word % n", () => {
    expect(randomInt(6, scriptedRandom([0]))).toBe(0);
    expect(randomInt(6, scriptedRandom([13]))).toBe(1);
    expect(randomInt(10, scriptedRandom([TWO_32 - 7]))).toBe((TWO_32 - 7) % 10);
  });

  it("rejects words in the incomplete top block and redraws", () => {
    // 2^32 = 4294967296; for n = 6 the accepted words are 0 .. 4294967291 (a multiple of 6).
    const limit = TWO_32 - (TWO_32 % 6);
    expect(limit % 6).toBe(0);
    const rng = vi.fn(scriptedRandom([limit, TWO_32 - 1, limit - 1]));
    expect(randomInt(6, rng)).toBe((limit - 1) % 6);
    expect(rng).toHaveBeenCalledTimes(3);
  });

  it("accepts exactly the same number of words for every result (no modulo bias)", () => {
    for (const n of [3, 6, 7, 10, 26, 88, 1000, 2 ** 31 + 1]) {
      const limit = TWO_32 - (TWO_32 % n);
      // Accepted words are [0, limit): limit / n words per result, an integer.
      expect(Number.isInteger(limit / n)).toBe(true);
      // The boundary word is the first rejected one.
      const rng = vi.fn(scriptedRandom([limit, 0]));
      expect(randomInt(n, rng)).toBe(0);
      expect(rng).toHaveBeenCalledTimes(2);
    }
  });

  it("never rejects when n is a power of two", () => {
    expect(randomInt(2 ** 32, scriptedRandom([TWO_32 - 1]))).toBe(TWO_32 - 1);
    expect(randomInt(8, scriptedRandom([TWO_32 - 1]))).toBe(7);
  });

  it("combines two words into 53 bits for ranges wider than 2^32", () => {
    const n = 2 ** 40;
    // High word keeps its low 21 bits.
    const value = randomInt(n, scriptedRandom([0xffe00001, 5]));
    expect(value).toBe((1 * TWO_32 + 5) % n);
  });

  it("rejects the incomplete top block of a 53-bit range", () => {
    const n = 3 * 2 ** 50; // 2^53 % n = 2^51, so draws at or above 6 * 2^50 are rejected
    const rng = vi.fn(scriptedRandom([0x1fffff, 0xffffffff, 0, 9]));
    expect(randomInt(n, rng)).toBe(9);
    expect(rng).toHaveBeenCalledTimes(4);
  });

  it("returns 0 for n = 1 without drawing", () => {
    const rng = vi.fn(scriptedRandom([]));
    expect(randomInt(1, rng)).toBe(0);
    expect(rng).not.toHaveBeenCalled();
  });

  it("throws RangeError for an invalid n", () => {
    for (const n of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, TWO_53 + 2]) {
      expect(() => randomInt(n, seededRandom(1))).toThrow(RangeError);
    }
  });

  it("stays in range with the default Web Crypto source", () => {
    for (let i = 0; i < 200; i++) {
      const v = randomInt(7);
      expect(Number.isInteger(v) && v >= 0 && v < 7).toBe(true);
    }
  });
});

describe("randomUint32 and randomFloat", () => {
  it("coerces source output to an unsigned 32-bit integer", () => {
    expect(randomUint32(() => -1)).toBe(TWO_32 - 1);
  });

  it("randomFloat spans [0, 1)", () => {
    expect(randomFloat(scriptedRandom([0, 0]))).toBe(0);
    const max = randomFloat(scriptedRandom([TWO_32 - 1, TWO_32 - 1]));
    expect(max).toBeLessThan(1);
    expect(max).toBe((TWO_53 - 1) / TWO_53);
  });
});

describe("pick and shuffle", () => {
  it("pick uses randomInt over the array length", () => {
    expect(pick(["a", "b", "c"], scriptedRandom([4]))).toBe("b");
    expect(() => pick([], seededRandom(1))).toThrow(RangeError);
  });

  it("shuffle returns a permutation and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, seededRandom(42));
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("shuffle produces every order of three items", () => {
    // Fisher–Yates draws randomInt(3) then randomInt(2): 3 * 2 scripted paths, 6 orders.
    const orders = new Set<string>();
    for (const a of [0, 1, 2]) {
      for (const b of [0, 1]) {
        orders.add(shuffle(["x", "y", "z"], scriptedRandom([a, b])).join(""));
      }
    }
    expect(orders.size).toBe(6);
  });
});

describe("seededRandom", () => {
  it("is deterministic per seed and yields 32-bit words", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const c = seededRandom(8);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, c)).not.toEqual(seqA);
    for (const w of seqA) expect(Number.isInteger(w) && w >= 0 && w < TWO_32).toBe(true);
  });
});

describe("without Web Crypto", () => {
  it("reports it and throws a typed error from the default source", () => {
    vi.stubGlobal("crypto", undefined);
    expect(hasSecureRandom()).toBe(false);
    expect(() => secureRandom()).toThrow(SecureRandomUnavailableError);
    expect(() => randomInt(6)).toThrow(SecureRandomUnavailableError);
    expect(new SecureRandomUnavailableError().code).toBe("no-secure-random");
    // An injected source still works.
    expect(randomInt(6, scriptedRandom([5]))).toBe(5);
  });
});
