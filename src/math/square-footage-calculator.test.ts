import { describe, expect, it } from "vitest";
import {
  type RoomInput,
  areaToSqFt,
  calculateSquareFootage,
  formatFeetInches,
  sqFtToArea,
} from "./square-footage-calculator.js";

const room = (r: Partial<RoomInput>): RoomInput => ({
  name: "Room",
  shape: "rectangle",
  unit: "ft",
  a: "",
  ...r,
});

describe("calculateSquareFootage — shapes", () => {
  it("rectangle 12 x 10 ft = 120 sq ft", () => {
    const r = calculateSquareFootage([room({ a: 12, b: 10 })]);
    expect(r.totalSqFt).toBe(120);
    // 120 * 0.09290304 = 11.148
    expect(r.totalSqM).toBe(11.15);
    expect(r.totalSqYd).toBe(13.33);
    expect(r.totalSqIn).toBe(17_280);
    expect(r.rooms[0].perimeterFt).toBe(44);
    expect(r.totalAcres).toBe(0.0028);
  });

  it("L-shape subtracts the cut-out and keeps the bounding perimeter", () => {
    // 20x15 - 8x5 = 260
    const r = calculateSquareFootage([room({ shape: "lshape", a: 20, b: 15, c: 8, d: 5 })]);
    expect(r.totalSqFt).toBe(260);
    expect(r.rooms[0].perimeterFt).toBe(70);
  });

  it("circle by diameter, triangle by Heron, trapezoid by heights", () => {
    const circle = calculateSquareFootage([room({ shape: "circle", a: 10 })]);
    expect(circle.rooms[0].areaSqFt).toBe(78.5398); // pi * 25
    expect(circle.rooms[0].perimeterFt).toBe(31.4159);
    const tri = calculateSquareFootage([room({ shape: "triangle", a: 3, b: 4, c: 5 })]);
    expect(tri.totalSqFt).toBe(6);
    const trap = calculateSquareFootage([room({ shape: "trapezoid", a: 10, b: 6, c: 4 })]);
    expect(trap.totalSqFt).toBe(32); // (10+6)/2 * 4
    expect(trap.rooms[0].perimeterKnown).toBe(false);
  });

  it("reads feet + inches and decimal-comma metric input", () => {
    // 12'6" x 10' = 125 sq ft
    const ftin = calculateSquareFootage([room({ unit: "ftin", a: 12, aIn: 6, b: 10, bIn: 0 })]);
    expect(ftin.totalSqFt).toBe(125);
    // 4 m x 3 m = 12 m² = 129.17 sq ft
    const metric = calculateSquareFootage([room({ unit: "m", a: "4", b: "3,0" })]);
    expect(metric.totalSqM).toBe(12);
    expect(metric.totalSqFt).toBe(129.17);
    // 400 cm x 300 cm is the same room
    expect(calculateSquareFootage([room({ unit: "cm", a: 400, b: 300 })]).totalSqM).toBe(12);
    // 4 yd x 3 yd = 12 sq yd = 108 sq ft
    expect(calculateSquareFootage([room({ unit: "yd", a: 4, b: 3 })]).totalSqFt).toBe(108);
  });

  it("multiplies by quantity and computes wall area from ceiling height", () => {
    // 10x10, perimeter 40, ceiling 8 -> 320 per room, x2
    const r = calculateSquareFootage([room({ a: 10, b: 10, quantity: 2, ceilingHeight: 8 })]);
    expect(r.totalSqFt).toBe(200);
    expect(r.unitsCounted).toBe(2);
    expect(r.totalWallSqFt).toBe(640);
    expect(r.totalPerimeterFt).toBe(80);
  });

  it("reports row problems instead of throwing", () => {
    const r = calculateSquareFootage([
      room({ a: "", b: "" }),
      room({ a: 10 }),
      room({ a: 10, b: 0 }),
      room({ a: -10, b: 5 }),
      room({ shape: "triangle", a: 1, b: 2, c: 10 }),
      room({ shape: "lshape", a: 10, b: 10, c: 12, d: 2 }),
    ]);
    expect(r.rooms.map((x) => x.problem)).toEqual([
      "empty",
      "missing",
      "missing",
      "negative",
      "impossible-triangle",
      "cutout-too-big",
    ]);
    expect(r.rooms[0].used).toBe(false);
    expect(r.hasProblem).toBe(true);
    expect(r.totalSqFt).toBe(0);
    expect(r.materials.packsNeeded).toBe(0);
  });

  it("computes shares, largest and average across rooms", () => {
    const r = calculateSquareFootage([room({ a: 10, b: 10 }), room({ a: 10, b: 30 })]);
    expect(r.rooms.map((x) => x.sharePercent)).toEqual([25, 75]);
    expect(r.largestRoomSqFt).toBe(300);
    expect(r.averageRoomSqFt).toBe(200);
    expect(r.equivalentSquareSideFt).toBe(20);
  });
});

describe("calculateSquareFootage — materials", () => {
  it("rounds packs up and measures leftover against the bare floor", () => {
    // 120 sq ft + 10% = 132 ; 20 sq ft boxes -> 6.6 -> 7 boxes = 140 ; leftover 20 ; 7 x 30 = 210
    const r = calculateSquareFootage([room({ a: 12, b: 10 })], {
      wastePercent: 10,
      coveragePerPack: 20,
      pricePerPack: 30,
    });
    expect(r.materials).toMatchObject({
      orderSqFt: 132,
      wasteSqFt: 12,
      packsNeeded: 7,
      packsCoverSqFt: 140,
      leftoverSqFt: 20,
      totalCost: 210,
      costPerSqFt: 1.75,
      hasEstimate: true,
    });
  });

  it("prices by area in another unit", () => {
    // 129.17 sq ft (12 m²) + 0% at 10 per m² = 120
    const r = calculateSquareFootage([room({ unit: "m", a: 4, b: 3 })], {
      pricePerArea: 10,
      priceUnit: "sqm",
    });
    expect(r.materials.totalCost).toBe(120);
  });

  it("converts pack coverage given in square metres", () => {
    // 120 sq ft / (2 m² = 21.53 sq ft) = 5.57 -> 6
    const r = calculateSquareFootage([room({ a: 12, b: 10 })], {
      coveragePerPack: 2,
      coverageUnit: "sqm",
    });
    expect(r.materials.packsNeeded).toBe(6);
  });
});

describe("area helpers", () => {
  it("converts area units", () => {
    expect(areaToSqFt(1, "sqyd")).toBe(9);
    expect(areaToSqFt(1, "acre")).toBe(43_560);
    expect(sqFtToArea(144, "sqin")).toBe(20_736);
    expect(sqFtToArea(10.7639104, "sqm")).toBeCloseTo(1, 6);
  });

  it("formats decimal feet as feet and inches to the nearest 1/8", () => {
    expect(formatFeetInches(12.5)).toBe(`12' 6"`);
    expect(formatFeetInches(12.5417)).toBe(`12' 6 1/2"`);
    expect(formatFeetInches(10)).toBe(`10'`);
    expect(formatFeetInches(0)).toBe(`0'`);
    expect(formatFeetInches(-3)).toBe(`0'`);
  });
});
