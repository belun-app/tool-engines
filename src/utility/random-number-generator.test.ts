import { describe, expect, it, vi } from "vitest";
import { scriptedRandom, seededRandom } from "../_random.js";
import { type RandomNumberOptions, generateRandomNumbers } from "./random-number-generator.js";

const opts = (over: Partial<RandomNumberOptions>): RandomNumberOptions => ({
  min: 1,
  max: 100,
  count: 1,
  unique: false,
  sort: "none",
  ...over,
});

describe("generateRandomNumbers", () => {
  it("maps random words into the inclusive range", () => {
    // span 100: 0 -> 1, 99 -> 100, 100 -> 1, 4294967199 % 100 = 99 -> 100
    const rng = scriptedRandom([0, 99, 100, 4_294_967_199]);
    expect(generateRandomNumbers(opts({ count: 4, rng }))).toEqual({
      numbers: [1, 100, 1, 100],
      error: "",
      errorCode: "",
    });
  });

  it("rejects words from the incomplete top block instead of wrapping them", () => {
    // 2^32 % 100 = 96: words 4294967200 .. 4294967295 would favour 1..96, so they are redrawn.
    const rng = vi.fn(scriptedRandom([4_294_967_295, 4_294_967_200, 41]));
    expect(generateRandomNumbers(opts({ rng })).numbers).toEqual([42]);
    expect(rng).toHaveBeenCalledTimes(3);
  });

  it("is reproducible with a seeded source", () => {
    const a = generateRandomNumbers(opts({ count: 20, rng: seededRandom(3) })).numbers;
    expect(generateRandomNumbers(opts({ count: 20, rng: seededRandom(3) })).numbers).toEqual(a);
  });

  it("includes both endpoints and stays in range (real randomness)", () => {
    const { numbers } = generateRandomNumbers(opts({ min: 1, max: 6, count: 600 }));
    expect(numbers).toHaveLength(600);
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers)).toBe(6);
    expect(numbers.every(Number.isInteger)).toBe(true);
  });

  it("supports negative ranges and min == max", () => {
    const neg = generateRandomNumbers(opts({ min: -10, max: -5, count: 50 })).numbers;
    expect(neg.every((n) => n >= -10 && n <= -5)).toBe(true);
    expect(generateRandomNumbers(opts({ min: 7, max: 7, count: 3 })).numbers).toEqual([7, 7, 7]);
  });

  it("rounds fractional bounds inward and floors the count", () => {
    // min 1.2 -> 2, max 3.8 -> 3
    const r = generateRandomNumbers(opts({ min: 1.2, max: 3.8, count: 40.9 }));
    expect(r.numbers).toHaveLength(40);
    expect(r.numbers.every((n) => n === 2 || n === 3)).toBe(true);
  });

  it("draws unique numbers covering the whole range when count == range size", () => {
    const r = generateRandomNumbers(
      opts({ min: 1, max: 10, count: 10, unique: true, sort: "asc" }),
    );
    expect(r.numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("never repeats in unique mode", () => {
    const r = generateRandomNumbers(opts({ min: 1, max: 1000, count: 200, unique: true }));
    expect(new Set(r.numbers).size).toBe(200);
  });

  it("sorts ascending / descending on request", () => {
    const asc = generateRandomNumbers(
      opts({ count: 3, sort: "asc", rng: scriptedRandom([5, 1, 9]) }),
    );
    expect(asc.numbers).toEqual([2, 6, 10]);
    const desc = generateRandomNumbers(
      opts({ count: 3, sort: "desc", rng: scriptedRandom([5, 1, 9]) }),
    );
    expect(desc.numbers).toEqual([10, 6, 2]);
  });

  it("reports an error for min > max and for too many unique numbers", () => {
    expect(generateRandomNumbers(opts({ min: 10, max: 1 }))).toEqual({
      numbers: [],
      error: "Minimum must be less than or equal to maximum.",
      errorCode: "min-greater-than-max",
    });
    expect(generateRandomNumbers(opts({ min: 1, max: 5, count: 10, unique: true })).error).toBe(
      "Cannot generate 10 unique numbers from a range of only 5.",
    );
  });

  it("gives every error as a code plus the numbers a page needs for its own message", () => {
    expect(generateRandomNumbers(opts({ min: 1, max: 5, count: 10, unique: true }))).toMatchObject({
      errorCode: "not-enough-unique",
      errorParams: { count: 10, rangeSize: 5 },
    });
    expect(generateRandomNumbers(opts({ count: 20_000 }))).toMatchObject({
      errorCode: "too-many",
      errorParams: { max: 10_000 },
    });
    expect(generateRandomNumbers(opts({ min: -1e16, max: 0 })).errorCode).toBe("unsafe-range");
  });

  it("reports missing or non-finite inputs as invalid-input", () => {
    expect(generateRandomNumbers(opts({ min: Number.NaN })).errorCode).toBe("invalid-input");
    expect(generateRandomNumbers(opts({ count: Number.POSITIVE_INFINITY })).errorCode).toBe(
      "invalid-input",
    );
    const empty = generateRandomNumbers({} as RandomNumberOptions);
    expect(empty).toMatchObject({ numbers: [], errorCode: "invalid-input" });
    expect(empty.error).not.toBe("");
    expect(
      generateRandomNumbers({ min: "1", max: 5, count: 1 } as unknown as RandomNumberOptions)
        .errorCode,
    ).toBe("invalid-input");
  });

  it("returns nothing (no error) for count < 1", () => {
    expect(generateRandomNumbers(opts({ count: 0 }))).toEqual({
      numbers: [],
      error: "",
      errorCode: "",
    });
  });

  it("defaults to not unique and unsorted when those options are left out", () => {
    const r = generateRandomNumbers({ min: 1, max: 3, count: 2, rng: scriptedRandom([2, 0]) });
    expect(r.numbers).toEqual([3, 1]);
  });

  it("covers the full width of a 2^40 range with two words per draw", () => {
    // High word 0x80 contributes 128 * 2^32; low word 7.
    const r = generateRandomNumbers(
      opts({ min: 0, max: 2 ** 40 - 1, rng: scriptedRandom([0x80, 7]) }),
    );
    expect(r.numbers).toEqual([128 * 2 ** 32 + 7]);
  });

  it("reports missing Web Crypto instead of throwing", () => {
    vi.stubGlobal("crypto", undefined);
    expect(generateRandomNumbers(opts({}))).toMatchObject({
      numbers: [],
      errorCode: "no-secure-random",
    });
    expect(generateRandomNumbers(opts({ rng: seededRandom(1) })).numbers).toHaveLength(1);
  });

  it("can reach the upper part of a range wider than 2^32", () => {
    const { numbers } = generateRandomNumbers(opts({ min: 0, max: 1e12, count: 50 }));
    expect(numbers.some((n) => n > 2 ** 32)).toBe(true);
    expect(numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 1e12)).toBe(true);
  });

  it("draws unique numbers from a range wider than 2^32", () => {
    const r = generateRandomNumbers(opts({ min: -1e15, max: 1e15, count: 100, unique: true }));
    expect(new Set(r.numbers).size).toBe(100);
    expect(r.numbers.every((n) => n >= -1e15 && n <= 1e15)).toBe(true);
  });

  it("rejects bounds outside the safe-integer range", () => {
    const r = generateRandomNumbers(opts({ min: 0, max: 1e20 }));
    expect(r.numbers).toEqual([]);
    expect(r.error).not.toBe("");
  });

  it("caps the count at a sane maximum instead of allocating count numbers", () => {
    const r = generateRandomNumbers(opts({ count: 1e9 }));
    expect(r.numbers).toEqual([]);
    expect(r.error).toMatch(/at most 10,000/);
    expect(generateRandomNumbers(opts({ count: 10_000 })).numbers).toHaveLength(10_000);
  });
});
