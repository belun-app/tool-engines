/**
 * Solves a triangle from three known sides and angles (SSS, SAS, ASA, AAS, or SSA with its
 * ambiguous case), or a right triangle from two sides.
 *
 * Triangle solver: three sides (SSS), two sides and the angle between them
 * (SAS), two angles and the side between them (ASA), two angles and a side
 * opposite one of them (AAS), two sides and an angle opposite one of them
 * (SSA, the ambiguous case with 0, 1 or 2 triangles) and a right triangle from
 * any two sides.
 *
 * Naming follows the school convention: side a is opposite angle A, b is
 * opposite B, c is opposite C. Angles are in degrees.
 *
 * Errors are returned as codes; pages show them in their own language.
 * `error` keeps an English sentence for logs and build-time tables.
 */

export interface TriangleResult {
  valid: true;
  a: number;
  b: number;
  c: number;
  area: number;
  perimeter: number;
  semiperimeter: number;
  angleA: number;
  angleB: number;
  angleC: number;
  /** Height to side a (from vertex A), and so on. */
  heightA: number;
  heightB: number;
  heightC: number;
  /** Median to side a (from vertex A). */
  medianA: number;
  medianB: number;
  medianC: number;
  /** Bisector of angle A, from A to side a. */
  bisectorA: number;
  bisectorB: number;
  bisectorC: number;
  /** Radius of the inscribed circle. */
  inradius: number;
  /** Radius of the circumscribed circle. */
  circumradius: number;
  shape: "equilateral" | "isosceles" | "scalene";
  angleType: "right" | "acute" | "obtuse";
}

export type TriangleErrorCode =
  /** A side is zero, negative or not a number. */
  | "non-positive"
  /** The sides break the triangle inequality (or meet it with equality). */
  | "inequality"
  /** Too large or too small to compute in double precision. */
  | "out-of-range"
  /** An angle is not between 0° and 180°. */
  | "bad-angle"
  /** The given angles add up to 180° or more. */
  | "angle-sum"
  /** SSA: the side opposite the angle is too short to reach. */
  | "no-solution"
  /** Right triangle: the hypotenuse is not the longest side. */
  | "hypotenuse"
  /** Right triangle: three sides typed, but a² + b² ≠ c². */
  | "not-right"
  /** A value the mode needs is missing. */
  | "missing";

export interface TriangleError {
  valid: false;
  code: TriangleErrorCode;
  error: string;
}

export const TRIANGLE_ERROR_TEXT: Record<TriangleErrorCode, string> = {
  "non-positive": "All sides must be positive numbers.",
  inequality: "These side lengths cannot form a valid triangle (triangle inequality violated).",
  "out-of-range": "These values are too large or too small to calculate.",
  "bad-angle": "Angles must be greater than 0° and less than 180°.",
  "angle-sum": "The two angles must add up to less than 180°.",
  "no-solution": "No triangle has these values: the side opposite the angle is too short.",
  hypotenuse: "The hypotenuse must be longer than either leg.",
  "not-right": "These sides do not make a right triangle: a² + b² ≠ c².",
  missing: "Fill in every value this mode needs.",
};

function fail(code: TriangleErrorCode): TriangleError {
  return { valid: false, code, error: TRIANGLE_ERROR_TEXT[code] };
}

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
/** Shape tolerance: sides equal to 1e-9 relative count as equal. */
const EPS = 1e-9;
/**
 * Relative slack for the triangle inequality. 0.1 + 0.2 is 0.30000000000000004
 * in a double, so 0.1/0.2/0.3 (a straight line) would pass a strict `>`.
 */
const LINE_TOL = 1e-12;

const clamp1 = (x: number) => Math.min(1, Math.max(-1, x));

/** Solves a triangle from its three sides. */
export function calculateTriangle(a: number, b: number, c: number): TriangleResult | TriangleError {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
    return fail("non-positive");
  }
  if (a <= 0 || b <= 0 || c <= 0) return fail("non-positive");

  // Work on sides scaled to the longest one, so Heron's product neither
  // overflows (1e200) nor underflows (1e-200), then scale the results back.
  const m = Math.max(a, b, c);
  const x = a / m;
  const y = b / m;
  const z = c / m;
  if (x + y - z <= LINE_TOL || x + z - y <= LINE_TOL || y + z - x <= LINE_TOL) {
    return fail("inequality");
  }

  const sn = (x + y + z) / 2;
  const areaN = Math.sqrt(sn * (sn - x) * (sn - y) * (sn - z));
  const area = areaN * m * m;
  const perimeter = a + b + c;
  if (!Number.isFinite(area) || !Number.isFinite(perimeter) || area === 0) {
    return fail("out-of-range");
  }

  // Law of cosines, clamped so rounding never pushes acos out of [-1, 1].
  const angleA = Math.acos(clamp1((y * y + z * z - x * x) / (2 * y * z))) * DEG;
  const angleB = Math.acos(clamp1((x * x + z * z - y * y) / (2 * x * z))) * DEG;
  const angleC = 180 - angleA - angleB;

  const heightA = (2 * areaN * m) / x;
  const heightB = (2 * areaN * m) / y;
  const heightC = (2 * areaN * m) / z;

  const median = (p: number, q: number, r: number) =>
    0.5 * Math.sqrt(2 * q * q + 2 * r * r - p * p) * m;
  const bisector = (p: number, q: number, r: number) =>
    Math.sqrt(q * r * (1 - (p / (q + r)) ** 2)) * m;

  let shape: TriangleResult["shape"];
  if (Math.abs(x - y) < EPS && Math.abs(y - z) < EPS) shape = "equilateral";
  else if (Math.abs(x - y) < EPS || Math.abs(y - z) < EPS || Math.abs(x - z) < EPS) {
    shape = "isosceles";
  } else shape = "scalene";

  const maxAngle = Math.max(angleA, angleB, angleC);
  let angleType: TriangleResult["angleType"];
  if (Math.abs(maxAngle - 90) < 0.01) angleType = "right";
  else if (maxAngle < 90) angleType = "acute";
  else angleType = "obtuse";

  return {
    valid: true,
    a,
    b,
    c,
    area,
    perimeter,
    semiperimeter: perimeter / 2,
    angleA,
    angleB,
    angleC,
    heightA,
    heightB,
    heightC,
    medianA: median(x, y, z),
    medianB: median(y, x, z),
    medianC: median(z, x, y),
    bisectorA: bisector(x, y, z),
    bisectorB: bisector(y, x, z),
    bisectorC: bisector(z, x, y),
    inradius: (areaN * m) / sn,
    circumradius: ((x * y * z) / (4 * areaN)) * m,
    shape,
    angleType,
  };
}

export type TriangleMode = "sss" | "sas" | "asa" | "aas" | "ssa" | "right";

/** Which inputs each mode reads. Angle C in SAS lies between sides a and b. */
export const TRIANGLE_MODE_FIELDS: Record<TriangleMode, ReadonlyArray<TriangleField>> = {
  sss: ["a", "b", "c"],
  sas: ["a", "b", "C"],
  asa: ["c", "A", "B"],
  aas: ["a", "A", "B"],
  ssa: ["a", "b", "A"],
  right: ["a", "b", "c"],
};

export type TriangleField = "a" | "b" | "c" | "A" | "B" | "C";

export interface TriangleInput {
  mode: TriangleMode;
  a?: number;
  b?: number;
  c?: number;
  /** Angles in degrees. */
  A?: number;
  B?: number;
  C?: number;
}

export type TriangleSolution =
  | { valid: true; mode: TriangleMode; solutions: TriangleResult[] }
  | TriangleError;

const given = (n: number | undefined): n is number => typeof n === "number" && !Number.isNaN(n);
const sideOk = (n: number) => Number.isFinite(n) && n > 0;
const angleOk = (n: number) => Number.isFinite(n) && n > 0 && n < 180;

function one(r: TriangleResult | TriangleError, mode: TriangleMode): TriangleSolution {
  return r.valid ? { valid: true, mode, solutions: [r] } : r;
}

/** From two angles (degrees) and the side opposite the first one. */
function fromAngles(
  A: number,
  B: number,
  side: number,
  sideIs: "a" | "c",
  mode: TriangleMode,
): TriangleSolution {
  if (!sideOk(side)) return fail("non-positive");
  if (!angleOk(A) || !angleOk(B)) return fail("bad-angle");
  const C = 180 - A - B;
  if (C <= 1e-9) return fail("angle-sum");
  const sA = Math.sin(A * RAD);
  const sB = Math.sin(B * RAD);
  const sC = Math.sin(C * RAD);
  // Law of sines: a / sin A = b / sin B = c / sin C.
  const k = sideIs === "a" ? side / sA : side / sC;
  return one(calculateTriangle(k * sA, k * sB, k * sC), mode);
}

/**
 * Solves a triangle from the three values (two for a right triangle) the mode
 * asks for. SSA can have two solutions; both are returned, the acute-B one first.
 */
export function solveTriangle(input: TriangleInput): TriangleSolution {
  const { mode } = input;
  const need = mode === "right" ? 2 : 3;
  const present = TRIANGLE_MODE_FIELDS[mode].filter((f) => given(input[f])).length;
  if (present < need) return fail("missing");

  switch (mode) {
    case "sss":
      return one(calculateTriangle(input.a as number, input.b as number, input.c as number), mode);

    case "sas": {
      const a = input.a as number;
      const b = input.b as number;
      const C = input.C as number;
      if (!sideOk(a) || !sideOk(b)) return fail("non-positive");
      if (!angleOk(C)) return fail("bad-angle");
      const m = Math.max(a, b);
      const x = a / m;
      const y = b / m;
      const c = Math.sqrt(Math.max(0, x * x + y * y - 2 * x * y * Math.cos(C * RAD))) * m;
      return one(calculateTriangle(a, b, c), mode);
    }

    case "asa":
      return fromAngles(input.A as number, input.B as number, input.c as number, "c", mode);

    case "aas":
      return fromAngles(input.A as number, input.B as number, input.a as number, "a", mode);

    case "ssa": {
      const a = input.a as number;
      const b = input.b as number;
      const A = input.A as number;
      if (!sideOk(a) || !sideOk(b)) return fail("non-positive");
      if (!angleOk(A)) return fail("bad-angle");
      // Law of sines for the angle opposite b.
      const sinB = (b * Math.sin(A * RAD)) / a;
      if (sinB > 1 + 1e-12) return fail("no-solution");
      const B1 = Math.asin(Math.min(1, sinB)) * DEG;
      const candidates = Math.abs(sinB - 1) <= 1e-12 ? [90] : [B1, 180 - B1];
      const solutions: TriangleResult[] = [];
      for (const B of candidates) {
        const C = 180 - A - B;
        if (C <= 1e-9) continue;
        const c = (a * Math.sin(C * RAD)) / Math.sin(A * RAD);
        const r = calculateTriangle(a, b, c);
        if (r.valid) solutions.push(r);
      }
      if (solutions.length === 0) return fail("no-solution");
      return { valid: true, mode, solutions };
    }

    case "right": {
      // Angle C = 90°: a and b are the legs, c the hypotenuse.
      const { a, b, c } = input;
      for (const v of [a, b, c]) if (given(v) && !sideOk(v)) return fail("non-positive");
      if (given(a) && given(b) && !given(c)) {
        return one(calculateTriangle(a, b, Math.hypot(a, b)), mode);
      }
      if (given(c) && (given(a) || given(b))) {
        const leg = (given(a) ? a : b) as number;
        if (given(a) && given(b)) {
          // All three typed: they must agree with Pythagoras.
          const r = calculateTriangle(a, b, c);
          if (!r.valid) return r;
          return Math.abs(Math.hypot(a, b) - c) <= 1e-9 * c ? one(r, mode) : fail("not-right");
        }
        if (c <= leg) return fail("hypotenuse");
        const other = Math.sqrt((c - leg) * (c + leg));
        return one(
          given(a) ? calculateTriangle(leg, other, c) : calculateTriangle(other, leg, c),
          mode,
        );
      }
      return fail("missing");
    }
  }
}
