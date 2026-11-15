import { afterEach, describe, expect, it, vi } from "vitest";
import { SecureRandomUnavailableError, scriptedRandom } from "../_random.js";
import { type CoinSide, computeStats, flipCoin, flipCoins } from "./coin-flip.js";

/** Make crypto.getRandomValues fill byte arrays from a fixed sequence. */
function stubBytes(bytes: number[]) {
  let i = 0;
  return vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((arr: Uint8Array) => {
    for (let k = 0; k < arr.length; k++) arr[k] = bytes[i++ % bytes.length];
    return arr;
  }) as typeof crypto.getRandomValues);
}

afterEach(() => vi.restoreAllMocks());

describe("flipCoin / flipCoins", () => {
  it("uses the lowest bit of a random byte: even -> heads, odd -> tails", () => {
    stubBytes([0, 1, 254, 255]);
    expect([flipCoin(), flipCoin(), flipCoin(), flipCoin()]).toEqual([
      "heads",
      "tails",
      "heads",
      "tails",
    ]);
  });

  it("flips the requested number of coins and floors fractions", () => {
    stubBytes([2, 3]);
    expect(flipCoins(3)).toEqual(["heads", "tails", "heads"]);
    expect(flipCoins(2.9)).toHaveLength(2);
  });

  it("returns [] for zero, negative or invalid counts", () => {
    expect(flipCoins(0)).toEqual([]);
    expect(flipCoins(-4)).toEqual([]);
    expect(flipCoins(Number.NaN)).toEqual([]);
    expect(flipCoins(0.5)).toEqual([]);
  });

  it("produces both sides with real randomness (sanity, 400 flips)", () => {
    const flips = flipCoins(400);
    const heads = flips.filter((s) => s === "heads").length;
    // P(heads outside 120..280) for a fair coin is ~1e-15
    expect(heads).toBeGreaterThan(120);
    expect(heads).toBeLessThan(280);
  });
});

describe("computeStats", () => {
  it("returns zeroes for an empty or invalid history", () => {
    const empty = {
      total: 0,
      heads: 0,
      tails: 0,
      headsPercent: 0,
      tailsPercent: 0,
      streak: 0,
      streakSide: null,
    };
    expect(computeStats([])).toEqual(empty);
    expect(computeStats(null as unknown as CoinSide[])).toEqual(empty);
    expect(computeStats(["edge" as CoinSide])).toEqual(empty);
  });

  it("computes percentages to one decimal and the trailing streak", () => {
    // 1 heads / 3 = 33.3 %, 2 tails = 66.7 %; ends with two tails
    expect(computeStats(["heads", "tails", "tails"])).toEqual({
      total: 3,
      heads: 1,
      tails: 2,
      headsPercent: 33.3,
      tailsPercent: 66.7,
      streak: 2,
      streakSide: "tails",
    });
  });

  it("counts a streak over the whole history when all sides match", () => {
    expect(computeStats(["heads", "heads", "heads", "heads"])).toMatchObject({
      streak: 4,
      streakSide: "heads",
      headsPercent: 100,
      tailsPercent: 0,
    });
  });

  it("skips invalid entries before computing", () => {
    const r = computeStats(["heads", "x" as CoinSide, "heads"]);
    expect(r.total).toBe(2);
    expect(r.streak).toBe(2);
  });
});

describe("coin flip randomness", () => {
  it("uses an injected source", () => {
    expect(flipCoins(4, scriptedRandom([7, 8, 2 ** 32 - 1, 0]))).toEqual([
      "tails",
      "heads",
      "tails",
      "heads",
    ]);
  });

  it("throws a typed error without Web Crypto", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => flipCoin()).toThrow(SecureRandomUnavailableError);
    expect(flipCoin(scriptedRandom([1]))).toBe("tails");
  });
});
