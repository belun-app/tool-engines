import { afterEach, describe, expect, it, vi } from "vitest";
import { scriptedRandom, seededRandom } from "../_random.js";
import { MAX_UUIDS, MIN_UUIDS, generateUuids } from "./uuid-generator.js";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateUuids", () => {
  it("produces RFC 4122 v4 strings (version nibble 4, variant 8/9/a/b)", () => {
    const { uuids } = generateUuids(50, false);
    expect(uuids).toHaveLength(50);
    for (const u of uuids) expect(u).toMatch(V4);
    expect(new Set(uuids).size).toBe(50);
  });

  it("uppercases when asked", () => {
    const [u] = generateUuids(1, true).uuids;
    expect(u).toBe(u.toUpperCase());
    expect(u.toLowerCase()).toMatch(V4);
  });

  it("is deterministic given the random source (all-zero and max)", () => {
    const fill = (value: number) =>
      vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((arr: Uint8Array) => {
        arr.fill(value);
        return arr;
      }) as typeof crypto.getRandomValues);
    fill(0);
    expect(generateUuids(1, false).uuids[0]).toBe("00000000-0000-4000-8000-000000000000");
    fill(0xff);
    expect(generateUuids(1, false).uuids[0]).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("clamps the count to MIN_UUIDS..MAX_UUIDS, flags it, and handles junk", () => {
    expect([MIN_UUIDS, MAX_UUIDS]).toEqual([1, 100]);
    expect(generateUuids(0, false)).toMatchObject({ clamped: true });
    expect(generateUuids(0, false).uuids).toHaveLength(1);
    expect(generateUuids(-5, false).uuids).toHaveLength(1);
    expect(generateUuids(Number.NaN, false).uuids).toHaveLength(1);
    expect(generateUuids(2.9, false)).toMatchObject({ clamped: true });
    expect(generateUuids(2.9, false).uuids).toHaveLength(2);
    expect(generateUuids(1000, false).uuids).toHaveLength(100);
    expect(generateUuids(1000, false).clamped).toBe(true);
    expect(generateUuids(5, false)).toMatchObject({ clamped: false, error: "" });
  });

  it("uses an injected source, big-endian per word", () => {
    const rng = scriptedRandom([0x01234567, 0x89abcdef, 0x01234567, 0x89abcdef]);
    expect(generateUuids(1, false, { rng }).uuids[0]).toBe("01234567-89ab-4def-8123-456789abcdef");
    const a = generateUuids(3, false, { rng: seededRandom(9) }).uuids;
    expect(generateUuids(3, false, { rng: seededRandom(9) }).uuids).toEqual(a);
    for (const u of a) expect(u).toMatch(V4);
  });

  it("reports missing Web Crypto instead of throwing", () => {
    vi.stubGlobal("crypto", undefined);
    expect(generateUuids(2, false)).toEqual({
      uuids: [],
      clamped: false,
      error: "no-secure-random",
    });
  });

  it("does not derive UUIDs from Math.random", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const [u] = generateUuids(1, false).uuids;
    expect(u).not.toBe("00000000-0000-4000-8000-000000000000");
  });
});
