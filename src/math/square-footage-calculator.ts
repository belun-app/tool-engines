/**
 * Square footage for rooms and plots: five shapes, mixed input units, a project
 * total across any number of rooms, and a materials estimate with a waste allowance.
 *
 * Everything is reduced to feet first and the area is kept in square feet, then
 * converted on the way out. Converting each room into its own unit and adding the
 * results afterwards is what makes hand-built spreadsheets drift — 12'6" typed as
 * 12.6 is off by 0.4 inches per measurement, and that compounds across a floor plan.
 */

export type ShapeKind = "rectangle" | "lshape" | "circle" | "triangle" | "trapezoid";

export type LengthUnit = "ft" | "in" | "ftin" | "yd" | "m" | "cm" | "mm";

export type AreaUnit = "sqft" | "sqm" | "sqyd" | "sqin" | "acre";

export interface RoomInput {
  /** Free-text label, echoed back in the breakdown. */
  name: string;
  shape: ShapeKind;
  /** Unit every dimension of this room is measured in. */
  unit: LengthUnit;
  /** Rectangle length · L-shape outer length · circle diameter · triangle side a · trapezoid side a. */
  a: string | number;
  /** Rectangle width · L-shape outer width · triangle side b · trapezoid side b. */
  b?: string | number;
  /** L-shape cut-out length · triangle side c · trapezoid height. */
  c?: string | number;
  /** L-shape cut-out width. */
  d?: string | number;
  /** Inches part, used only when `unit` is "ftin" — one per dimension. */
  aIn?: string | number;
  bIn?: string | number;
  cIn?: string | number;
  dIn?: string | number;
  /** How many identical rooms like this one. Blank or 0 is read as 1. */
  quantity?: string | number;
  /** Ceiling height in the room's unit; drives the wall-area readout for paint. */
  ceilingHeight?: string | number;
  ceilingHeightIn?: string | number;
}

export type RoomProblem =
  | "empty"
  | "missing"
  | "negative"
  | "impossible-triangle"
  | "cutout-too-big";

export interface RoomResult {
  name: string;
  shape: ShapeKind;
  /** At least one dimension held a value, so the row is meant to count. */
  used: boolean;
  /** Why the row produced no area. `null` once the row is good. */
  problem: RoomProblem | null;
  quantity: number;
  /** One unit of this room. */
  areaSqFt: number;
  /** `areaSqFt` × quantity — the figure that reaches the project total. */
  totalSqFt: number;
  totalSqM: number;
  totalSqYd: number;
  /** Outline length of one unit, in feet. 0 when the shape does not fix it. */
  perimeterFt: number;
  /** Shapes whose perimeter cannot be derived from the dimensions entered. */
  perimeterKnown: boolean;
  /** Perimeter × ceiling height × quantity, in square feet. 0 with no height. */
  wallAreaSqFt: number;
  wallAreaSqM: number;
  /** Share of the project total, 0–100. */
  sharePercent: number;
}

export interface MaterialOptions {
  /** Extra area ordered for cuts and offcuts. 10 is the usual flooring allowance. */
  wastePercent?: string | number;
  /** Area one box, roll, or can covers. 0 means the material is sold by area. */
  coveragePerPack?: string | number;
  /** Unit `coveragePerPack` is quoted in. */
  coverageUnit?: AreaUnit;
  /** Price of one pack. Used when `coveragePerPack` is above 0. */
  pricePerPack?: string | number;
  /** Price per unit area. Used when the material is sold by area. */
  pricePerArea?: string | number;
  /** Unit `pricePerArea` is quoted in. */
  priceUnit?: AreaUnit;
}

export interface MaterialResult {
  /** Order area: the project total plus the waste allowance. */
  orderSqFt: number;
  orderSqM: number;
  orderSqYd: number;
  /** Area added by the allowance alone. */
  wasteSqFt: number;
  /** Whole packs to buy — always rounded up, you cannot buy 7.3 boxes. */
  packsNeeded: number;
  /** Area those packs actually cover, in square feet. */
  packsCoverSqFt: number;
  /** Area left over after the job, in square feet. Keep it for repairs. */
  leftoverSqFt: number;
  totalCost: number;
  /** Delivered cost per square foot of finished floor, waste included. */
  costPerSqFt: number;
  /** Either a pack size or a price was entered, so the estimate means something. */
  hasEstimate: boolean;
}

export interface SquareFootageResult {
  rooms: RoomResult[];
  /** Rows that produced a usable area. */
  roomsCounted: number;
  /** Rooms × quantity. */
  unitsCounted: number;
  totalSqFt: number;
  totalSqM: number;
  totalSqYd: number;
  totalSqIn: number;
  totalAcres: number;
  /** Summed perimeter of every room whose outline is known, in feet. */
  totalPerimeterFt: number;
  totalPerimeterM: number;
  /** Wall area across the project — perimeter × ceiling height. */
  totalWallSqFt: number;
  totalWallSqM: number;
  /** Side of the square with the same area, in feet — a sanity check on the total. */
  equivalentSquareSideFt: number;
  largestRoomSqFt: number;
  averageRoomSqFt: number;
  materials: MaterialResult;
  hasProblem: boolean;
}

/** Feet per unit. The foot has been exactly 0.3048 m since the 1959 agreement. */
const FEET_PER_UNIT: Record<LengthUnit, number> = {
  ft: 1,
  in: 1 / 12,
  ftin: 1,
  yd: 3,
  m: 1 / 0.3048,
  cm: 0.01 / 0.3048,
  mm: 0.001 / 0.3048,
};

/** Square feet per square unit. */
const SQ_FEET_PER_UNIT: Record<AreaUnit, number> = {
  sqft: 1,
  sqm: 1 / 0.09290304,
  sqyd: 9,
  sqin: 1 / 144,
  acre: 43560,
};

const SQ_FT_TO_SQ_M = 0.09290304;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function toNumber(value: string | number | undefined, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  // Accept a decimal comma, and the foot-inch marks people type out of habit.
  const cleaned = raw.replace(/[\s'"″′]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isBlank(value: string | number | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  return String(value).trim().length === 0;
}

/**
 * One dimension, in feet. For the feet-and-inches unit the two boxes are added,
 * which is the whole point of that mode: 12 ft 6 in is 12.5 ft, not 12.6 ft.
 */
function toFeet(
  whole: string | number | undefined,
  inches: string | number | undefined,
  unit: LengthUnit,
): number {
  const main = toNumber(whole, 0) * FEET_PER_UNIT[unit];
  if (unit !== "ftin") return main;
  return main + toNumber(inches, 0) / 12;
}

/** How many of a, b, c, d a shape reads. */
const DIMENSION_COUNT: Record<ShapeKind, number> = {
  rectangle: 2,
  lshape: 4,
  circle: 1,
  triangle: 3,
  trapezoid: 3,
};

/** Square feet and outline length for one unit of a shape. */
function shapeArea(
  shape: ShapeKind,
  dims: number[],
): { area: number; perimeter: number; perimeterKnown: boolean; problem: RoomProblem | null } {
  const [a = 0, b = 0, c = 0, d = 0] = dims;

  if (dims.some((v) => v < 0)) {
    return { area: 0, perimeter: 0, perimeterKnown: false, problem: "negative" };
  }

  switch (shape) {
    case "rectangle":
      return { area: a * b, perimeter: 2 * (a + b), perimeterKnown: true, problem: null };

    case "lshape": {
      // The cut-out has to fit inside the bounding rectangle, or the shape is not an L.
      if (c > a || d > b) {
        return { area: 0, perimeter: 0, perimeterKnown: false, problem: "cutout-too-big" };
      }
      // An L made by removing one corner has exactly the perimeter of its bounding
      // rectangle: the two cut edges replace the two they hide, inch for inch.
      return { area: a * b - c * d, perimeter: 2 * (a + b), perimeterKnown: true, problem: null };
    }

    case "circle": {
      const radius = a / 2;
      return {
        area: Math.PI * radius * radius,
        perimeter: Math.PI * a,
        perimeterKnown: true,
        problem: null,
      };
    }

    case "triangle": {
      // Heron's formula, so three tape measurements are enough — no height needed.
      if (a + b <= c || a + c <= b || b + c <= a) {
        return { area: 0, perimeter: 0, perimeterKnown: false, problem: "impossible-triangle" };
      }
      const s = (a + b + c) / 2;
      const area = Math.sqrt(s * (s - a) * (s - b) * (s - c));
      return { area, perimeter: a + b + c, perimeterKnown: true, problem: null };
    }

    case "trapezoid":
      // a and b are the parallel sides, c the perpendicular distance between them.
      // The slanted legs are unknown, so the outline length is not derivable.
      return { area: ((a + b) / 2) * c, perimeter: 0, perimeterKnown: false, problem: null };

    default:
      return { area: 0, perimeter: 0, perimeterKnown: false, problem: "missing" };
  }
}

function emptyRoom(name: string, shape: ShapeKind, problem: RoomProblem | null): RoomResult {
  return {
    name,
    shape,
    used: problem !== "empty",
    problem,
    quantity: 0,
    areaSqFt: 0,
    totalSqFt: 0,
    totalSqM: 0,
    totalSqYd: 0,
    perimeterFt: 0,
    perimeterKnown: false,
    wallAreaSqFt: 0,
    wallAreaSqM: 0,
    sharePercent: 0,
  };
}

/** Convert an area given in `unit` into square feet. */
export function areaToSqFt(value: number, unit: AreaUnit): number {
  return value * SQ_FEET_PER_UNIT[unit];
}

/** Convert square feet into `unit`. */
export function sqFtToArea(sqft: number, unit: AreaUnit): number {
  return sqft / SQ_FEET_PER_UNIT[unit];
}

/** Decimal feet as feet and inches — "12.542 ft" reads back as 12' 6 1/2". */
export function formatFeetInches(feet: number): string {
  if (!Number.isFinite(feet) || feet <= 0) return `0'`;
  const totalEighths = Math.round(feet * 12 * 8);
  const wholeFeet = Math.floor(totalEighths / 96);
  const remainder = totalEighths - wholeFeet * 96;
  const inches = Math.floor(remainder / 8);
  const eighths = remainder - inches * 8;

  const parts = [`${wholeFeet}'`];
  if (inches || eighths) {
    const fraction = eighths ? ` ${eighths / gcd(eighths, 8)}/${8 / gcd(eighths, 8)}` : "";
    parts.push(`${inches}${fraction}"`);
  }
  return parts.join(" ");
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function emptyMaterials(): MaterialResult {
  return {
    orderSqFt: 0,
    orderSqM: 0,
    orderSqYd: 0,
    wasteSqFt: 0,
    packsNeeded: 0,
    packsCoverSqFt: 0,
    leftoverSqFt: 0,
    totalCost: 0,
    costPerSqFt: 0,
    hasEstimate: false,
  };
}

export function calculateSquareFootage(
  rooms: RoomInput[],
  materials: MaterialOptions = {},
): SquareFootageResult {
  const results: RoomResult[] = rooms.map((room) => {
    const shape = room.shape ?? "rectangle";
    const unit = room.unit ?? "ft";
    const name = (room.name ?? "").trim();
    const needed = DIMENSION_COUNT[shape] ?? 2;

    const raw = [room.a, room.b, room.c, room.d];
    const inches = [room.aIn, room.bIn, room.cIn, room.dIn];
    const required = raw.slice(0, needed);
    const requiredInches = inches.slice(0, needed);

    const anyEntered = required.some((v, i) => !isBlank(v) || !isBlank(requiredInches[i]));
    if (!anyEntered) return emptyRoom(name, shape, "empty");

    const allEntered = required.every((v, i) => !isBlank(v) || !isBlank(requiredInches[i]));
    if (!allEntered) return emptyRoom(name, shape, "missing");

    const dims = required.map((v, i) => toFeet(v, requiredInches[i], unit));
    // A zero dimension is a half-typed row, not a zero-area room.
    if (dims.some((v) => v === 0)) return emptyRoom(name, shape, "missing");

    const { area, perimeter, perimeterKnown, problem } = shapeArea(shape, dims);
    if (problem) return emptyRoom(name, shape, problem);

    const quantityRaw = Math.floor(toNumber(room.quantity, 1));
    const quantity = quantityRaw > 0 ? quantityRaw : 1;

    const ceilingFt = toFeet(room.ceilingHeight, room.ceilingHeightIn, unit);
    const wallAreaSqFt = perimeterKnown && ceilingFt > 0 ? perimeter * ceilingFt * quantity : 0;

    const totalSqFt = area * quantity;

    return {
      name,
      shape,
      used: true,
      problem: null,
      quantity,
      areaSqFt: round4(area),
      totalSqFt: round4(totalSqFt),
      totalSqM: round4(totalSqFt * SQ_FT_TO_SQ_M),
      totalSqYd: round4(totalSqFt / 9),
      perimeterFt: round4(perimeter),
      perimeterKnown,
      wallAreaSqFt: round4(wallAreaSqFt),
      wallAreaSqM: round4(wallAreaSqFt * SQ_FT_TO_SQ_M),
      sharePercent: 0,
    };
  });

  const good = results.filter((r) => r.used && r.problem === null);
  const totalSqFt = good.reduce((sum, r) => sum + r.totalSqFt, 0);

  for (const room of results) {
    room.sharePercent = totalSqFt > 0 ? round2((room.totalSqFt / totalSqFt) * 100) : 0;
  }

  const totalPerimeterFt = good
    .filter((r) => r.perimeterKnown)
    .reduce((sum, r) => sum + r.perimeterFt * r.quantity, 0);
  const totalWallSqFt = good.reduce((sum, r) => sum + r.wallAreaSqFt, 0);

  // Materials.
  const wastePercent = Math.max(0, toNumber(materials.wastePercent, 0));
  const coverageUnit = materials.coverageUnit ?? "sqft";
  const priceUnit = materials.priceUnit ?? "sqft";
  const coveragePerPack = Math.max(0, toNumber(materials.coveragePerPack, 0));
  const pricePerPack = Math.max(0, toNumber(materials.pricePerPack, 0));
  const pricePerArea = Math.max(0, toNumber(materials.pricePerArea, 0));

  const orderSqFt = totalSqFt * (1 + wastePercent / 100);
  const packCoverSqFt = areaToSqFt(coveragePerPack, coverageUnit);
  const sellsByPack = packCoverSqFt > 0;

  const packsNeeded = sellsByPack && orderSqFt > 0 ? Math.ceil(orderSqFt / packCoverSqFt) : 0;
  const packsCoverSqFt = packsNeeded * packCoverSqFt;
  // Leftover is measured against the bare floor, not against the padded order —
  // the waste allowance is meant to be cut up, the surplus boxes are not.
  const leftoverSqFt = sellsByPack ? Math.max(0, packsCoverSqFt - totalSqFt) : 0;

  const totalCost = sellsByPack
    ? packsNeeded * pricePerPack
    : (orderSqFt / SQ_FEET_PER_UNIT[priceUnit]) * pricePerArea;

  const hasEstimate = sellsByPack || pricePerArea > 0 || wastePercent > 0;

  const materialResult: MaterialResult =
    totalSqFt > 0
      ? {
          orderSqFt: round2(orderSqFt),
          orderSqM: round2(orderSqFt * SQ_FT_TO_SQ_M),
          orderSqYd: round2(orderSqFt / 9),
          wasteSqFt: round2(orderSqFt - totalSqFt),
          packsNeeded,
          packsCoverSqFt: round2(packsCoverSqFt),
          leftoverSqFt: round2(leftoverSqFt),
          totalCost: round2(totalCost),
          costPerSqFt: totalSqFt > 0 ? round2(totalCost / totalSqFt) : 0,
          hasEstimate,
        }
      : emptyMaterials();

  return {
    rooms: results,
    roomsCounted: good.length,
    unitsCounted: good.reduce((sum, r) => sum + r.quantity, 0),
    totalSqFt: round2(totalSqFt),
    totalSqM: round2(totalSqFt * SQ_FT_TO_SQ_M),
    totalSqYd: round2(totalSqFt / 9),
    totalSqIn: Math.round(totalSqFt * 144),
    totalAcres: round4(totalSqFt / 43560),
    totalPerimeterFt: round2(totalPerimeterFt),
    totalPerimeterM: round2(totalPerimeterFt * 0.3048),
    totalWallSqFt: round2(totalWallSqFt),
    totalWallSqM: round2(totalWallSqFt * SQ_FT_TO_SQ_M),
    equivalentSquareSideFt: round2(Math.sqrt(totalSqFt)),
    largestRoomSqFt: good.reduce((max, r) => (r.totalSqFt > max ? r.totalSqFt : max), 0),
    averageRoomSqFt: good.length ? round2(totalSqFt / good.length) : 0,
    materials: materialResult,
    hasProblem: results.some((r) => r.used && r.problem !== null),
  };
}
