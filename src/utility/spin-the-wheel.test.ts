import { afterEach, describe, expect, it, vi } from "vitest";
import { SecureRandomUnavailableError, scriptedRandom, seededRandom } from "../_random.js";
import {
  DEFAULT_PALETTE,
  MAX_ENTRIES,
  MAX_LABEL_LENGTH,
  POINTER_ANGLE,
  buildSegments,
  decodeWheel,
  encodeWheel,
  normaliseColor,
  parseEntries,
  parsePalette,
  segmentAtPointer,
  spinWheel,
  tallyHistory,
  textColorFor,
} from "./spin-the-wheel.js";

const TAU = Math.PI * 2;

afterEach(() => vi.restoreAllMocks());

describe("parseEntries", () => {
  it("trims, drops blanks and splits on LF/CRLF", () => {
    expect(parseEntries(" Pizza \r\n\nSushi\n  \nБорщ 🍲\n")).toEqual([
      "Pizza",
      "Sushi",
      "Борщ 🍲",
    ]);
    expect(parseEntries(null as unknown as string)).toEqual([]);
  });

  it("caps the label length and the entry count", () => {
    expect(parseEntries("x".repeat(500))[0]).toHaveLength(MAX_LABEL_LENGTH);
    const many = Array.from({ length: 600 }, (_, i) => `e${i}`).join("\n");
    expect(parseEntries(many)).toHaveLength(MAX_ENTRIES);
  });
});

describe("colours", () => {
  it("normalises 3- and 6-digit hex, with or without #", () => {
    expect(normaliseColor("#ABC")).toBe("#aabbcc");
    expect(normaliseColor("1d4ed8")).toBe("#1d4ed8");
    expect(normaliseColor(" #FFF ")).toBe("#ffffff");
    expect(normaliseColor("#abcd")).toBeNull();
    expect(normaliseColor("red")).toBeNull();
    expect(normaliseColor(5 as unknown as string)).toBeNull();
  });

  it("parses a palette from mixed separators, skipping junk", () => {
    expect(parsePalette("#f00, 00ff00;\n#0000FF nope")).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
    expect(parsePalette("")).toEqual([]);
  });

  it("chooses dark text on light slices and white on dark ones", () => {
    expect(textColorFor("#ffff00")).toBe("#18181b");
    expect(textColorFor("#ffffff")).toBe("#18181b");
    expect(textColorFor("#1d4ed8")).toBe("#ffffff");
    expect(textColorFor("garbage")).toBe("#ffffff");
    for (const c of DEFAULT_PALETTE) expect(textColorFor(c)).toBe("#ffffff");
  });
});

describe("buildSegments", () => {
  it("returns [] for no entries", () => {
    expect(buildSegments([])).toEqual([]);
    expect(buildSegments(["", "  "])).toEqual([]);
  });

  it("slices the circle into equal wedges", () => {
    const segs = buildSegments(["a", "b", "c", "d"]);
    expect(segs.map((s) => s.startAngle)).toEqual([0, TAU / 4, TAU / 2, (3 * TAU) / 4]);
    expect(segs[3].endAngle).toBeCloseTo(TAU, 12);
    expect(segs[0].midAngle).toBeCloseTo(TAU / 8, 12);
    expect(segs.map((s) => s.color)).toEqual(DEFAULT_PALETTE.slice(0, 4));
  });

  it("nudges the last colour so first and last slices never match", () => {
    // 7 slices, 6 colours: the 7th would reuse colour 0 next to slice 0 -> colour 1 instead
    const segs = buildSegments(Array.from({ length: 7 }, (_, i) => `e${i}`));
    expect(segs[6].color).toBe(DEFAULT_PALETTE[1]);
    expect(segs[6].color).not.toBe(segs[0].color);
    expect(segs[6].color).not.toBe(segs[5].color);
  });

  it("cycles a custom palette", () => {
    const segs = buildSegments(["a", "b", "c", "d"], ["#000000", "#ffffff"]);
    expect(segs.map((s) => s.color)).toEqual(["#000000", "#ffffff", "#000000", "#ffffff"]);
    expect(segs.map((s) => s.textColor)).toEqual(["#ffffff", "#18181b", "#ffffff", "#18181b"]);
  });

  it("a single entry fills the whole wheel", () => {
    const [s] = buildSegments(["only"]);
    expect(s.startAngle).toBe(0);
    expect(s.endAngle).toBeCloseTo(TAU, 12);
  });
});

describe("spinWheel / segmentAtPointer", () => {
  it("returns null without entries", () => {
    expect(spinWheel([])).toBeNull();
  });

  it("parks the chosen winner under the pointer (inverse check)", () => {
    for (const n of [1, 2, 3, 7, 12, 50]) {
      const entries = Array.from({ length: n }, (_, i) => `e${i}`);
      for (let w = 0; w < n; w += Math.max(1, Math.floor(n / 5))) {
        const spin = spinWheel(entries, { winnerIndex: w, from: 1.234 });
        expect(spin?.winnerIndex).toBe(w);
        expect(spin?.winner).toBe(`e${w}`);
        expect(segmentAtPointer(spin?.rotation ?? 0, n)).toBe(w);
      }
    }
  });

  it("always turns forward by at least `turns` full revolutions", () => {
    const from = 10;
    const spin = spinWheel(["a", "b", "c"], { from, turns: 4 });
    const travelled = (spin?.rotation ?? 0) - from;
    expect(travelled).toBeGreaterThanOrEqual(4 * TAU);
    expect(travelled).toBeLessThan(5 * TAU);
    expect(spin?.durationMs).toBeGreaterThanOrEqual(4200);
    expect(spin?.durationMs).toBeLessThanOrEqual(4800);
  });

  it("sanitises from / turns / forced winner", () => {
    const spin = spinWheel(["a", "b"], { from: Number.NaN, turns: 0, winnerIndex: 9 });
    expect(spin?.rotation).toBeGreaterThanOrEqual(TAU);
    expect([0, 1]).toContain(spin?.winnerIndex);
    expect(spinWheel(["a"], { turns: Number.POSITIVE_INFINITY })?.rotation).toBeGreaterThanOrEqual(
      6 * TAU,
    );
  });

  it("draws the winner from the random source with jitter inside the slice", () => {
    // 1st word -> winner (2 of 4); words 2-3 make the float 0.5 -> jitter 0; 4-5 -> duration
    const rng = scriptedRandom([2, 0x80000000, 0, 0, 0]);
    const spin = spinWheel(["a", "b", "c", "d"], { from: 0, turns: 1, rng });
    expect(spin?.winner).toBe("c");
    // target = 3π/2 - 2.5 * π/2 = π/4 -> rotation = 2π + π/4
    expect(spin?.rotation).toBeCloseTo(TAU + Math.PI / 4, 10);
    expect(spin?.durationMs).toBe(4200);
  });

  it("is roughly uniform over 800 real spins of a 4-slice wheel", () => {
    const counts = [0, 0, 0, 0];
    for (let k = 0; k < 800; k++) counts[spinWheel(["a", "b", "c", "d"])?.winnerIndex ?? 0]++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(120);
      expect(c).toBeLessThan(280);
    }
  });

  it("segmentAtPointer maps rotation 0 to the slice under 12 o'clock", () => {
    // pointer at 3π/2; with 4 slices that is slice 3 (3π/2 .. 2π)
    expect(segmentAtPointer(0, 4)).toBe(3);
    expect(segmentAtPointer(POINTER_ANGLE - 0.1, 4)).toBe(0);
    expect(segmentAtPointer(0, 0)).toBe(-1);
    expect(segmentAtPointer(Number.NaN, 4)).toBe(-1);
    expect(segmentAtPointer(0, 2.5)).toBe(-1);
  });
});

describe("tallyHistory", () => {
  it("counts wins, most frequent first, ties alphabetical", () => {
    expect(tallyHistory(["b", "a", "b", "c", "a", "b"])).toEqual([
      { label: "b", count: 3, percent: 50 },
      { label: "a", count: 2, percent: 33.3 },
      { label: "c", count: 1, percent: 16.7 },
    ]);
  });

  it("orders ties with the collation of the given locale", () => {
    // Swedish sorts "ä" after "z"; German sorts it with "a".
    const labels = (locale: string) => tallyHistory(["z", "ä", "a"], locale).map((t) => t.label);
    expect(labels("sv")).toEqual(["a", "z", "ä"]);
    expect(labels("de")).toEqual(["a", "ä", "z"]);
  });

  it("ignores junk and empty history", () => {
    expect(tallyHistory([])).toEqual([]);
    expect(tallyHistory(["", 4 as unknown as string, "x"])).toEqual([
      { label: "x", count: 1, percent: 100 },
    ]);
  });
});

describe("encodeWheel / decodeWheel", () => {
  it("round-trips Cyrillic and emoji through a URL-safe string", () => {
    const entries = ["Пицца", "Sushi 🍣", "a+b/c=d"];
    const code = encodeWheel(entries);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeWheel(code)).toEqual(entries);
  });

  it("encodes the known base64url of a simple list", () => {
    // "a\nb" = 0x61 0x0a 0x62 -> base64 "YQpi"
    expect(encodeWheel(["a", "b"])).toBe("YQpi");
    expect(encodeWheel([])).toBe("");
  });

  it("returns [] for malformed input", () => {
    expect(decodeWheel("")).toEqual([]);
    expect(decodeWheel("!!!")).toEqual([]);
    // 0xFF is not valid UTF-8 -> "_w"
    expect(decodeWheel("_w")).toEqual([]);
    expect(decodeWheel(undefined as unknown as string)).toEqual([]);
  });
});

describe("spinWheel randomness", () => {
  it("is reproducible with a seeded source", () => {
    const a = spinWheel(["a", "b", "c"], { rng: seededRandom(4) });
    expect(spinWheel(["a", "b", "c"], { rng: seededRandom(4) })).toEqual(a);
  });

  it("throws a typed error without Web Crypto, and works with an injected source", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => spinWheel(["a", "b"])).toThrow(SecureRandomUnavailableError);
    expect(spinWheel(["a", "b"], { rng: seededRandom(1) })?.winner).toMatch(/^[ab]$/);
  });
});
