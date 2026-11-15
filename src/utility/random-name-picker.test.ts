import { afterEach, describe, expect, it, vi } from "vitest";
import { scriptedRandom, seededRandom } from "../_random.js";
import { parseNames, pickNames } from "./random-name-picker.js";

function stubUint32(values: number[]) {
  let i = 0;
  return vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((arr: Uint32Array) => {
    for (let k = 0; k < arr.length; k++) arr[k] = values[i++ % values.length];
    return arr;
  }) as typeof crypto.getRandomValues);
}

afterEach(() => vi.restoreAllMocks());

describe("parseNames", () => {
  it("splits on LF and CRLF, trims and drops blank lines", () => {
    expect(parseNames("  Alice \r\n\nBob\n   \nАнна\n")).toEqual(["Alice", "Bob", "Анна"]);
  });

  it("returns [] for empty or non-string input", () => {
    expect(parseNames("")).toEqual([]);
    expect(parseNames(42 as unknown as string)).toEqual([]);
  });

  it("keeps duplicates and commas inside a line", () => {
    expect(parseNames("Smith, John\nSmith, John")).toEqual(["Smith, John", "Smith, John"]);
  });
});

describe("pickNames", () => {
  const names = ["Alice", "Bob", "Carol", "Dave"];

  it("draws with a partial Fisher–Yates shuffle", () => {
    // i=0: j = 0 + (2 % 4) = 2 -> swap 0,2 -> [2,1,0,3]; i=1: j = 1 + (0 % 3) = 1 -> no swap
    stubUint32([2, 0]);
    expect(pickNames(names, 2)).toEqual({
      winners: ["Carol", "Bob"],
      remaining: ["Alice", "Dave"],
      total: 4,
    });
  });

  it("rejects random words from the biased tail", () => {
    // first draw over 4: limit = 2^32 (4 divides it) -> none rejected; over 3: limit = 4294967295
    const spy = stubUint32([1, 4_294_967_295, 2]);
    const r = pickNames(names, 2);
    // i=0: j = 1 -> [1,0,2,3]; i=1: 4294967295 rejected, then 2 % 3 = 2 -> j = 3 -> [1,3,2,0]
    expect(r.winners).toEqual(["Bob", "Dave"]);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("caps the count at the list size and keeps the remaining order", () => {
    const r = pickNames(names, 10);
    expect(r.winners).toHaveLength(4);
    expect([...r.winners].sort()).toEqual([...names].sort());
    expect(r.remaining).toEqual([]);
  });

  it("returns no winners for an empty list or a non-positive count", () => {
    expect(pickNames([], 3)).toEqual({ winners: [], remaining: [], total: 0 });
    expect(pickNames(names, 0)).toEqual({ winners: [], remaining: names, total: 4 });
    expect(pickNames(names, Number.NaN).winners).toEqual([]);
    expect(pickNames(null as unknown as string[], 1).total).toBe(0);
  });

  it("filters empty strings and non-strings out of the list", () => {
    const r = pickNames(["A", "", 5 as unknown as string, "B"], 1);
    expect(r.total).toBe(2);
  });

  it("never picks the same entry twice and partitions the list (real randomness)", () => {
    for (let k = 0; k < 20; k++) {
      const r = pickNames(names, 2);
      expect(new Set(r.winners).size).toBe(2);
      expect([...r.winners, ...r.remaining].sort()).toEqual([...names].sort());
    }
  });

  it("gives every name a chance to win (1 200 draws)", () => {
    const wins = new Map<string, number>();
    for (let k = 0; k < 1200; k++) {
      const w = pickNames(names, 1).winners[0];
      wins.set(w, (wins.get(w) ?? 0) + 1);
    }
    // expected 300 each; 150..450 is > 10 sigma wide
    for (const n of names) {
      expect(wins.get(n)).toBeGreaterThan(150);
      expect(wins.get(n)).toBeLessThan(450);
    }
  });
});

describe("pickNames randomness", () => {
  const names = ["Alice", "Bob", "Carol", "Dave"];

  it("uses an injected source and is reproducible with a seed", () => {
    expect(pickNames(names, 1, { rng: scriptedRandom([3]) }).winners).toEqual(["Dave"]);
    const a = pickNames(names, 3, { rng: seededRandom(8) });
    expect(pickNames(names, 3, { rng: seededRandom(8) })).toEqual(a);
  });

  it("rejects biased words instead of wrapping them", () => {
    // 2^32 % 3 = 1: the single top word 2^32 - 1 is rejected for a 3-name list.
    const r = pickNames(["a", "b", "c"], 1, { rng: scriptedRandom([2 ** 32 - 1, 2]) });
    expect(r.winners).toEqual(["c"]);
  });

  it("reports missing Web Crypto instead of throwing", () => {
    vi.stubGlobal("crypto", undefined);
    expect(pickNames(names, 2)).toEqual({
      winners: [],
      remaining: names,
      total: 4,
      error: "no-secure-random",
    });
  });
});
