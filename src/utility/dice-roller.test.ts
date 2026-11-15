import { afterEach, describe, expect, it, vi } from "vitest";
import { SecureRandomUnavailableError, scriptedRandom, seededRandom } from "../_random.js";
import {
  DIE_TYPES,
  type DiceRoll,
  MAX_DICE,
  computeStats,
  rollDice,
  rollDie,
} from "./dice-roller.js";

/** Make crypto.getRandomValues fill Uint32 arrays from a fixed sequence. */
function stubUint32(values: number[]) {
  let i = 0;
  return vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((arr: Uint32Array) => {
    for (let k = 0; k < arr.length; k++) arr[k] = values[i++ % values.length];
    return arr;
  }) as typeof crypto.getRandomValues);
}

afterEach(() => vi.restoreAllMocks());

describe("rollDie", () => {
  it("maps a random word to 1..sides via modulo", () => {
    stubUint32([0, 5, 6, 11]);
    // 0%6+1 = 1, 5%6+1 = 6, 6%6+1 = 1, 11%6+1 = 6
    expect([rollDie(6), rollDie(6), rollDie(6), rollDie(6)]).toEqual([1, 6, 1, 6]);
  });

  it("rejects values in the biased tail (rejection sampling)", () => {
    // limit for d6 = floor(2^32 / 6) * 6 = 4 294 967 292; 0xFFFFFFFF is rejected, then 2 -> 3
    const spy = stubUint32([0xffffffff, 4_294_967_292, 2]);
    expect(rollDie(6)).toBe(3);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("returns 0 for fewer than two sides or junk", () => {
    expect(rollDie(1)).toBe(0);
    expect(rollDie(0)).toBe(0);
    expect(rollDie(-6)).toBe(0);
    expect(rollDie(Number.NaN)).toBe(0);
  });

  it("stays within 1..sides for every standard die (real randomness)", () => {
    for (const sides of DIE_TYPES) {
      for (let i = 0; i < 200; i++) {
        const v = rollDie(sides);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(sides);
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it("can roll every face of a d4 (600 rolls)", () => {
    const seen = new Set(Array.from({ length: 600 }, () => rollDie(4)));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("rollDice", () => {
  it("rolls several dice and totals them", () => {
    stubUint32([0, 1, 2]);
    expect(rollDice(6, 3)).toEqual({ sides: 6, values: [1, 2, 3], total: 6 });
  });

  it("caps the count at MAX_DICE and floors fractions", () => {
    expect(rollDice(6, 1000).values).toHaveLength(MAX_DICE);
    expect(rollDice(20, 2.7).values).toHaveLength(2);
    expect(rollDice(6.9, 1).sides).toBe(6);
  });

  it("returns an empty roll for invalid sides or counts", () => {
    expect(rollDice(1, 3)).toEqual({ sides: 0, values: [], total: 0 });
    expect(rollDice(6, 0)).toEqual({ sides: 6, values: [], total: 0 });
    expect(rollDice(6, Number.NaN)).toEqual({ sides: 6, values: [], total: 0 });
  });
});

describe("computeStats", () => {
  it("returns zeroes for an empty history", () => {
    expect(computeStats([])).toEqual({
      rolls: 0,
      dice: 0,
      sum: 0,
      average: 0,
      highest: 0,
      lowest: 0,
    });
    expect(computeStats([{ sides: 6, values: [], total: 0 }]).rolls).toBe(0);
  });

  it("aggregates over all rolls", () => {
    const history: DiceRoll[] = [
      { sides: 6, values: [1, 6], total: 7 },
      { sides: 20, values: [17], total: 17 },
    ];
    // 3 dice, sum 24, average 8.0
    expect(computeStats(history)).toEqual({
      rolls: 2,
      dice: 3,
      sum: 24,
      average: 8,
      highest: 17,
      lowest: 1,
    });
  });

  it("rounds the per-die average to one decimal", () => {
    // 10 / 3 = 3.33 -> 3.3
    expect(computeStats([{ sides: 6, values: [3, 3, 4], total: 10 }]).average).toBe(3.3);
  });
});

describe("dice randomness", () => {
  it("uses an injected source", () => {
    expect(rollDie(6, scriptedRandom([4]))).toBe(5);
    expect(rollDice(6, 3, { rng: scriptedRandom([0, 1, 2]) })).toEqual({
      sides: 6,
      values: [1, 2, 3],
      total: 6,
    });
    const a = rollDice(20, 5, { rng: seededRandom(2) });
    expect(rollDice(20, 5, { rng: seededRandom(2) })).toEqual(a);
  });

  it("reports missing Web Crypto: an error field from rollDice, a typed error from rollDie", () => {
    vi.stubGlobal("crypto", undefined);
    expect(rollDice(6, 2)).toEqual({ sides: 6, values: [], total: 0, error: "no-secure-random" });
    expect(() => rollDie(6)).toThrow(SecureRandomUnavailableError);
  });
});
