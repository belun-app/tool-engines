export type CssUnit = "px" | "rem" | "em";

export interface CssUnitResult {
  px: number;
  rem: number;
  em: number;
}

export interface ConversionTableRow {
  px: number;
  rem: number;
}

export const DEFAULT_ROOT_FONT_SIZE = 16;

const TABLE_PX_VALUES = [
  1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128,
];

/**
 * Convert a CSS length between px, rem, and em using the given root font
 * size. rem and em share the same base here — the tool treats the element
 * font size as equal to the root. Invalid input yields zeros, not errors.
 */
export function convertCssUnits(value: number, unit: CssUnit, rootFontSize: number): CssUnitResult {
  if (!Number.isFinite(value) || !Number.isFinite(rootFontSize) || rootFontSize <= 0) {
    return { px: 0, rem: 0, em: 0 };
  }

  const px = unit === "px" ? value : value * rootFontSize;
  const relative = px / rootFontSize;

  return { px, rem: relative, em: relative };
}

/** Build a px → rem reference table of common sizes for the given root font size. */
export function buildConversionTable(
  rootFontSize: number,
  pxValues: number[] = TABLE_PX_VALUES,
): ConversionTableRow[] {
  if (!Number.isFinite(rootFontSize) || rootFontSize <= 0) return [];
  return pxValues.filter((px) => Number.isFinite(px)).map((px) => ({ px, rem: px / rootFontSize }));
}

/** Format a number for display: up to `maxDecimals` decimals, no trailing zeros. */
export function formatCssNumber(value: number, maxDecimals = 4): string {
  if (!Number.isFinite(value)) return "0";
  return String(Number(value.toFixed(maxDecimals)));
}
