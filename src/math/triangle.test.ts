import { describe, expect, it } from "vitest";
import { type TriangleResult, calculateTriangle, solveTriangle } from "./triangle.js";

function ok(a: number, b: number, c: number): TriangleResult {
  const r = calculateTriangle(a, b, c);
  if (!r.valid) throw new Error(`expected a valid triangle, got ${r.error}`);
  return r;
}

describe("calculateTriangle", () => {
  it("solves the 3-4-5 right triangle", () => {
    const r = ok(3, 4, 5);
    expect(r.area).toBeCloseTo(6, 10); // 3 * 4 / 2
    expect(r.perimeter).toBe(12);
    // A opposite 3: asin(3/5) = 36.8699°, B opposite 4: 53.1301°, C = 90°
    expect(r.angleA).toBeCloseTo(36.8699, 4);
    expect(r.angleB).toBeCloseTo(53.1301, 4);
    expect(r.angleC).toBeCloseTo(90, 10);
    // heights: 2 * area / side
    expect(r.heightA).toBeCloseTo(4, 10);
    expect(r.heightB).toBeCloseTo(3, 10);
    expect(r.heightC).toBeCloseTo(2.4, 10);
    expect(r.shape).toBe("scalene");
    expect(r.angleType).toBe("right");
  });

  it("solves an equilateral triangle", () => {
    const r = ok(2, 2, 2);
    expect(r.area).toBeCloseTo(Math.sqrt(3), 10); // sqrt(3)/4 * 2^2
    expect(r.angleA).toBeCloseTo(60, 10);
    expect(r.angleB).toBeCloseTo(60, 10);
    expect(r.angleC).toBeCloseTo(60, 10);
    expect(r.shape).toBe("equilateral");
    expect(r.angleType).toBe("acute");
  });

  it("classifies isosceles and obtuse triangles", () => {
    const iso = ok(5, 5, 6);
    expect(iso.shape).toBe("isosceles");
    expect(iso.area).toBeCloseTo(12, 10); // base 6, height 4
    expect(ok(5, 6, 5).shape).toBe("isosceles");
    expect(ok(6, 5, 5).shape).toBe("isosceles");
    const obtuse = ok(2, 3, 4);
    // C = acos((4 + 9 - 16) / 12) = acos(-0.25) = 104.4775°
    expect(obtuse.angleC).toBeCloseTo(104.4775, 4);
    expect(obtuse.angleType).toBe("obtuse");
  });

  it("angles always sum to 180", () => {
    const r = ok(7, 8.5, 11.2);
    expect(r.angleA + r.angleB + r.angleC).toBeCloseTo(180, 10);
  });

  it("recognises an isosceles right triangle with irrational sides", () => {
    const r = ok(1, 1, Math.SQRT2);
    expect(r.angleType).toBe("right");
    expect(r.shape).toBe("isosceles");
    expect(r.area).toBeCloseTo(0.5, 10);
  });

  it("rejects zero and negative sides", () => {
    for (const sides of [
      [0, 4, 5],
      [3, -4, 5],
      [3, 4, 0],
    ]) {
      const r = calculateTriangle(sides[0], sides[1], sides[2]);
      expect(r.valid).toBe(false);
    }
  });

  it("rejects sides that violate the triangle inequality, including degenerate ones", () => {
    expect(calculateTriangle(1, 2, 3).valid).toBe(false); // 1 + 2 = 3, degenerate
    expect(calculateTriangle(1, 2, 10).valid).toBe(false);
    expect(calculateTriangle(10, 1, 2).valid).toBe(false);
  });

  it("works for very small and very large sides", () => {
    expect(ok(3e-6, 4e-6, 5e-6).angleType).toBe("right");
    expect(ok(3e8, 4e8, 5e8).area).toBeCloseTo(6e16, -4);
  });

  it("rejects NaN and Infinity sides", () => {
    expect(calculateTriangle(Number.NaN, 4, 5).valid).toBe(false);
    const inf = Number.POSITIVE_INFINITY;
    expect(calculateTriangle(inf, inf, inf).valid).toBe(false);
  });
});

describe("error codes, degenerate decimals and extremes", () => {
  it("returns error codes the page can translate", () => {
    expect(calculateTriangle(0, 4, 5)).toMatchObject({ valid: false, code: "non-positive" });
    expect(calculateTriangle(1, 2, 10)).toMatchObject({ valid: false, code: "inequality" });
  });

  it("rejects decimal sides that lie on a line (0.1 + 0.2 = 0.3)", () => {
    expect(calculateTriangle(0.1, 0.2, 0.3)).toMatchObject({ valid: false, code: "inequality" });
    expect(calculateTriangle(1.1, 2.2, 3.3)).toMatchObject({ valid: false, code: "inequality" });
    expect(calculateTriangle(0.3, 0.1, 0.2).valid).toBe(false);
  });

  it("solves huge and tiny triangles without Infinity or NaN, or reports out-of-range", () => {
    const big = calculateTriangle(1e150, 1e150, 1e150);
    expect(big.valid).toBe(true);
    if (big.valid) {
      expect(big.angleA).toBeCloseTo(60, 9);
      expect(big.shape).toBe("equilateral");
      expect(big.angleType).toBe("acute");
    }
    expect(calculateTriangle(1e200, 1e200, 1e200)).toMatchObject({ code: "out-of-range" });
    const tiny = calculateTriangle(0.01, 0.01, 0.01);
    expect(tiny.valid && tiny.area).toBeCloseTo(0.0000433013, 10);
  });

  it("adds medians, bisectors and both radii", () => {
    const r = calculateTriangle(3, 4, 5);
    if (!r.valid) throw new Error("3-4-5 invalid");
    expect(r.inradius).toBeCloseTo(1, 12);
    expect(r.circumradius).toBeCloseTo(2.5, 12);
    expect(r.medianC).toBeCloseTo(2.5, 12); // median to the hypotenuse = half of it
    expect(r.medianA).toBeCloseTo(Math.sqrt(73) / 2, 12);
    expect(r.bisectorC).toBeCloseTo((12 * Math.SQRT2) / 7, 12);
    expect(r.semiperimeter).toBe(6);
  });
});

describe("solveTriangle", () => {
  const first = (s: ReturnType<typeof solveTriangle>) => {
    if (!s.valid) throw new Error(s.code);
    return s.solutions[0];
  };

  it("SSS matches calculateTriangle", () => {
    expect(first(solveTriangle({ mode: "sss", a: 3, b: 4, c: 5 })).area).toBeCloseTo(6, 12);
  });

  it("SAS: two sides and the angle between them", () => {
    const r = first(solveTriangle({ mode: "sas", a: 3, b: 4, C: 90 }));
    expect(r.c).toBeCloseTo(5, 12);
    const r2 = first(solveTriangle({ mode: "sas", a: 6, b: 8, C: 30 }));
    expect(r2.area).toBeCloseTo(12, 10);
    expect(r2.angleC).toBeCloseTo(30, 9);
  });

  it("ASA and AAS by the law of sines", () => {
    const asa = first(solveTriangle({ mode: "asa", A: 60, B: 60, c: 6 }));
    expect(asa.a).toBeCloseTo(6, 12);
    expect(asa.shape).toBe("equilateral");
    const aas = first(solveTriangle({ mode: "aas", A: 30, B: 90, a: 1 }));
    expect(aas.b).toBeCloseTo(2, 12);
    expect(aas.c).toBeCloseTo(Math.sqrt(3), 12);
    expect(solveTriangle({ mode: "asa", A: 100, B: 80, c: 5 })).toMatchObject({
      code: "angle-sum",
    });
    expect(solveTriangle({ mode: "aas", A: 0, B: 80, a: 5 })).toMatchObject({ code: "bad-angle" });
  });

  it("SSA: two, one or no triangles", () => {
    const two = solveTriangle({ mode: "ssa", a: 6, b: 8, A: 35 });
    expect(two.valid && two.solutions.length).toBe(2);
    if (two.valid) {
      expect(two.solutions[0].angleB).toBeCloseTo(49.8864, 3);
      expect(two.solutions[1].angleB).toBeCloseTo(130.1136, 3);
    }
    const right = solveTriangle({ mode: "ssa", a: 1, b: 2, A: 30 });
    expect(right.valid && right.solutions.length).toBe(1);
    expect(first(right).angleB).toBeCloseTo(90, 9);
    const big = solveTriangle({ mode: "ssa", a: 10, b: 8, A: 35 }); // a > b: one triangle
    expect(big.valid && big.solutions.length).toBe(1);
    expect(solveTriangle({ mode: "ssa", a: 2, b: 8, A: 35 })).toMatchObject({
      code: "no-solution",
    });
  });

  it("right triangle from any two sides", () => {
    expect(first(solveTriangle({ mode: "right", a: 3, b: 4 })).c).toBeCloseTo(5, 12);
    expect(first(solveTriangle({ mode: "right", a: 5, c: 13 })).b).toBeCloseTo(12, 12);
    expect(first(solveTriangle({ mode: "right", b: 12, c: 13 })).a).toBeCloseTo(5, 12);
    expect(first(solveTriangle({ mode: "right", a: 3, b: 4, c: 5 })).angleType).toBe("right");
    expect(solveTriangle({ mode: "right", a: 13, c: 5 })).toMatchObject({ code: "hypotenuse" });
    expect(solveTriangle({ mode: "right", a: 3, b: 4, c: 6 })).toMatchObject({ code: "not-right" });
    expect(solveTriangle({ mode: "right", a: 3 })).toMatchObject({ code: "missing" });
  });

  it("asks for every value the mode needs", () => {
    expect(solveTriangle({ mode: "sas", a: 3, b: 4 })).toMatchObject({ code: "missing" });
  });
});
