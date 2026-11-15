import { describe, expect, it } from "vitest";
import {
  type UnitCategory,
  convertUnits,
  convertUnitsDetailed,
  getUnits,
} from "./unit-converter.js";

const conv = (cat: UnitCategory, from: string, value: number) =>
  Object.fromEntries(convertUnits(cat, from, value).map((r) => [r.unitId, r.value]));

describe("getUnits", () => {
  it("lists units per category", () => {
    expect(getUnits("length").map((u) => u.id)).toEqual([
      "mm",
      "cm",
      "m",
      "km",
      "in",
      "ft",
      "yd",
      "mi",
    ]);
    expect(getUnits("weight")).toHaveLength(7);
    expect(getUnits("volume")).toHaveLength(9);
    expect(getUnits("temperature").map((u) => u.id)).toEqual(["c", "f", "k"]);
  });
});

describe("convertUnits — linear", () => {
  it("converts length by exact international definitions", () => {
    const r = conv("length", "mi", 1);
    expect(r.mi).toBe("1");
    expect(r.km).toBe("1.609344");
    expect(r.m).toBe("1609.344");
    expect(r.ft).toBe("5280");
    expect(r.yd).toBe("1760");
    expect(r.in).toBe("63360");
    expect(conv("length", "in", 1).cm).toBe("2.54");
    expect(conv("length", "ft", 1).in).toBe("12");
  });

  it("converts weight (1 lb = 16 oz, 1 st = 14 lb, 1 lb = 0.45359237 kg)", () => {
    const lb = conv("weight", "lb", 1);
    expect(lb.oz).toBe("16");
    expect(lb.kg).toBe("0.4535924");
    expect(conv("weight", "st", 1).lb).toBe("14");
    expect(conv("weight", "t", 1).kg).toBe("1000");
  });

  it("switches to exponential notation for very large and very small magnitudes", () => {
    expect(conv("length", "km", 1000).mm).toBe("1.0000e+9");
    expect(conv("length", "mm", 0.01).km).toBe("1.0000e-8");
    expect(conv("length", "m", 0).km).toBe("0");
  });

  it("handles negative values and rounds to 7 significant digits", () => {
    expect(conv("length", "m", -1).cm).toBe("-100");
    expect(conv("length", "m", 1).ft).toBe("3.28084");
  });

  it("returns dashes for non-finite input and [] for an unknown unit", () => {
    expect(convertUnits("length", "m", Number.NaN).every((r) => r.value === "—")).toBe(true);
    expect(convertUnits("weight", "kg", Number.POSITIVE_INFINITY)[0].value).toBe("—");
    expect(convertUnits("length", "furlong", 1)).toEqual([]);
  });

  it("names the reason when there is nothing to convert", () => {
    expect(convertUnitsDetailed("length", "m", Number.NaN).error).toBe("not-a-number");
    expect(convertUnitsDetailed("length", "m", Number.NaN).rows.length).toBeGreaterThan(0);
    expect(convertUnitsDetailed("length", "furlong", 1)).toEqual({
      rows: [],
      error: "unknown-unit",
    });
    expect(convertUnitsDetailed("temperature", "m", 1)).toEqual({
      rows: [],
      error: "unknown-unit",
    });
    expect(convertUnitsDetailed("speed" as UnitCategory, "m", 1)).toEqual({
      rows: [],
      error: "unknown-category",
    });
    expect(convertUnitsDetailed("length", "m", "5" as unknown as number).error).toBe(
      "not-a-number",
    );
    const ok = convertUnitsDetailed("length", "m", 1);
    expect(ok).not.toHaveProperty("error");
    expect(ok.rows).toEqual(convertUnits("length", "m", 1));
  });

  it("converts metric volume", () => {
    const r = conv("volume", "l", 1);
    expect(r.ml).toBe("1000");
  });

  it("keeps exact US customary volume relations", () => {
    const gal = conv("volume", "gal", 1);
    expect(gal.qt).toBe("4");
    expect(gal.l).toBe("3.785412");
    expect(conv("volume", "cup", 1).tbsp).toBe("16");
    expect(conv("volume", "tbsp", 1).tsp).toBe("3");
  });
});

describe("convertUnits — temperature", () => {
  it("converts between C, F and K", () => {
    expect(conv("temperature", "c", 100)).toEqual({ c: "100", f: "212", k: "373.15" });
    expect(conv("temperature", "f", 32)).toEqual({ c: "0", f: "32", k: "273.15" });
    expect(conv("temperature", "k", 0)).toEqual({ c: "-273.15", f: "-459.67", k: "0" });
    // -40 is the same in C and F
    expect(conv("temperature", "c", -40).f).toBe("-40");
    expect(conv("temperature", "f", 98.6).c).toBe("37");
  });

  it("returns dashes for non-finite temperatures", () => {
    expect(convertUnits("temperature", "c", Number.NaN).map((r) => r.value)).toEqual([
      "—",
      "—",
      "—",
    ]);
  });
});
