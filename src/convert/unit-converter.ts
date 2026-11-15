/**
 * Converts a value between units of length, weight, temperature and volume, returning the
 * amount in every unit of the category.
 */

export type UnitCategory = "length" | "weight" | "temperature" | "volume";

export interface UnitDef {
  id: string;
  label: string;
}

export interface ConversionRow {
  unitId: string;
  label: string;
  /** Display string, en-US style (kept for callers that do not localize). */
  value: string;
  /** The converted number, rounded to 7 significant digits (NaN when the input is not a number). */
  amount: number;
}

interface LinearUnit extends UnitDef {
  factor: number;
}

const LENGTH: LinearUnit[] = [
  { id: "mm", label: "Millimeters (mm)", factor: 0.001 },
  { id: "cm", label: "Centimeters (cm)", factor: 0.01 },
  { id: "m", label: "Meters (m)", factor: 1 },
  { id: "km", label: "Kilometers (km)", factor: 1000 },
  { id: "in", label: "Inches (in)", factor: 0.0254 },
  { id: "ft", label: "Feet (ft)", factor: 0.3048 },
  { id: "yd", label: "Yards (yd)", factor: 0.9144 },
  { id: "mi", label: "Miles (mi)", factor: 1609.344 },
];

const WEIGHT: LinearUnit[] = [
  { id: "mg", label: "Milligrams (mg)", factor: 0.000001 },
  { id: "g", label: "Grams (g)", factor: 0.001 },
  { id: "kg", label: "Kilograms (kg)", factor: 1 },
  { id: "t", label: "Tonnes (t)", factor: 1000 },
  { id: "oz", label: "Ounces (oz)", factor: 0.028349523125 },
  { id: "lb", label: "Pounds (lb)", factor: 0.45359237 },
  { id: "st", label: "Stone (st)", factor: 6.35029318 },
];

// US liquid gallon is exactly 231 in³ = 3.785411784 l; the smaller US units are exact fractions of it.
const US_GALLON_L = 3.785411784;

const VOLUME: LinearUnit[] = [
  { id: "ml", label: "Milliliters (ml)", factor: 0.001 },
  { id: "l", label: "Liters (l)", factor: 1 },
  { id: "tsp", label: "Teaspoons (tsp)", factor: US_GALLON_L / 768 },
  { id: "tbsp", label: "Tablespoons (tbsp)", factor: US_GALLON_L / 256 },
  { id: "fl_oz", label: "Fluid Ounces (fl oz)", factor: US_GALLON_L / 128 },
  { id: "cup", label: "Cups (cup)", factor: US_GALLON_L / 16 },
  { id: "pt", label: "Pints (pt)", factor: US_GALLON_L / 8 },
  { id: "qt", label: "Quarts (qt)", factor: US_GALLON_L / 4 },
  { id: "gal", label: "Gallons (gal)", factor: US_GALLON_L },
];

const TEMPERATURE: UnitDef[] = [
  { id: "c", label: "Celsius (°C)" },
  { id: "f", label: "Fahrenheit (°F)" },
  { id: "k", label: "Kelvin (K)" },
];

function formatValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1_000_000 || abs < 0.0001)) {
    return n.toExponential(4);
  }
  return Number.parseFloat(n.toPrecision(7)).toString();
}

function round7(n: number): number {
  return Number.isFinite(n) ? Number.parseFloat(n.toPrecision(7)) : Number.NaN;
}

function toBaseCelsius(value: number, fromUnit: string): number {
  if (fromUnit === "f") return ((value - 32) * 5) / 9;
  if (fromUnit === "k") return value - 273.15;
  return value;
}

function fromBaseCelsius(celsius: number, toUnit: string): number {
  if (toUnit === "f") return (celsius * 9) / 5 + 32;
  if (toUnit === "k") return celsius + 273.15;
  return celsius;
}

export function getUnits(category: UnitCategory): UnitDef[] {
  if (category === "length") return LENGTH;
  if (category === "weight") return WEIGHT;
  if (category === "volume") return VOLUME;
  return TEMPERATURE;
}

/**
 * Why a conversion produced no numbers:
 * - `not-a-number`: the value is NaN or infinite (rows are still listed, with NaN amounts).
 * - `unknown-category`: the category is not one of {@link UnitCategory} (no rows).
 * - `unknown-unit`: the unit id is not in the category (no rows).
 */
export type UnitConversionError = "not-a-number" | "unknown-category" | "unknown-unit";

export interface UnitConversionResult {
  rows: ConversionRow[];
  /** Absent when every row holds a real number. */
  error?: UnitConversionError;
}

const CATEGORIES: readonly UnitCategory[] = ["length", "weight", "temperature", "volume"];

/** {@link convertUnits} with the reason when there is nothing to show. */
export function convertUnitsDetailed(
  category: UnitCategory,
  fromUnit: string,
  value: number,
): UnitConversionResult {
  if (!CATEGORIES.includes(category)) return { rows: [], error: "unknown-category" };
  const units = getUnits(category);
  if (!units.some((u) => u.id === fromUnit)) return { rows: [], error: "unknown-unit" };

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      rows: units.map((u) => ({ unitId: u.id, label: u.label, value: "—", amount: Number.NaN })),
      error: "not-a-number",
    };
  }

  if (category === "temperature") {
    const celsius = toBaseCelsius(value, fromUnit);
    return {
      rows: TEMPERATURE.map((u) => {
        const n = u.id === fromUnit ? value : fromBaseCelsius(celsius, u.id);
        return { unitId: u.id, label: u.label, value: formatValue(n), amount: round7(n) };
      }),
    };
  }

  const linearUnits = units as LinearUnit[];
  const fromDef = linearUnits.find((u) => u.id === fromUnit) as LinearUnit;
  const baseValue = value * fromDef.factor;

  return {
    rows: linearUnits.map((u) => {
      const n = u.id === fromUnit ? value : baseValue / u.factor;
      return { unitId: u.id, label: u.label, value: formatValue(n), amount: round7(n) };
    }),
  };
}

/**
 * Convert a value from one unit to every unit of its category. A value that is not a finite
 * number gives rows with NaN amounts and "—"; an unknown category or unit gives no rows.
 * Use {@link convertUnitsDetailed} to get the reason as a code.
 */
export function convertUnits(
  category: UnitCategory,
  fromUnit: string,
  value: number,
): ConversionRow[] {
  return convertUnitsDetailed(category, fromUnit, value).rows;
}
