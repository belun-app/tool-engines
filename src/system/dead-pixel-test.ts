/**
 * Dead Pixel Test — the logic behind a full-screen colour cycler.
 *
 * Nothing here touches the DOM: the palette, the cycle order, the readable-label
 * colour, the defect decision table and the ISO 9241-307 warranty allowances are
 * all plain data and arithmetic, so they can be unit-tested and reused.
 */

export interface TestColor {
  /** Stable id used for data attributes and translation lookups. */
  id: string;
  /** CSS colour, always a six-digit hex so contrast maths stays simple. */
  hex: string;
}

/**
 * The order matters. Red, green and blue come first because a single stuck
 * subpixel only ever shows up against its own primary — a red subpixel stuck on
 * is invisible on a red field and obvious on green. Black then exposes anything
 * that lights up when it should not, white exposes anything that stays dark, and
 * the secondaries catch a subpixel that is dim rather than fully dead.
 */
export const TEST_COLORS: readonly TestColor[] = [
  { id: "red", hex: "#ff0000" },
  { id: "green", hex: "#00ff00" },
  { id: "blue", hex: "#0000ff" },
  { id: "black", hex: "#000000" },
  { id: "white", hex: "#ffffff" },
  { id: "yellow", hex: "#ffff00" },
  { id: "cyan", hex: "#00ffff" },
  { id: "magenta", hex: "#ff00ff" },
  { id: "gray", hex: "#808080" },
];

/** Move through the palette with wrap-around in both directions. */
export function cycleIndex(current: number, step: number, total = TEST_COLORS.length): number {
  if (total <= 0) return 0;
  const safeCurrent = Number.isFinite(current) ? Math.trunc(current) : 0;
  const safeStep = Number.isFinite(step) ? Math.trunc(step) : 0;
  return (((safeCurrent + safeStep) % total) + total) % total;
}

function parseHex(hex: string): [number, number, number] {
  const cleaned = (hex ?? "").trim().replace(/^#/, "");
  const full = cleaned.length === 3 ? cleaned.replace(/(.)/g, "$1$1") : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0];
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance, 0 for black and 1 for white. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Which label colour stays readable on a given background. Pure green
 * (luminance 0.72) needs black text; pure blue (0.07) needs white.
 */
export function contrastTextColor(hex: string): "#000000" | "#ffffff" {
  // Pick whichever WCAG contrast ratio is higher: (L + 0.05) / 0.05 against black versus
  // 1.05 / (L + 0.05) against white. They cross at L = sqrt(1.05 * 0.05) - 0.05 ≈ 0.179,
  // so mid grey (#808080, L 0.22) gets black text (5.3:1), not white (3.9:1).
  const l = relativeLuminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}

const FLASH_SEQUENCE: readonly TestColor[] = [
  { id: "red", hex: "#ff0000" },
  { id: "black", hex: "#000000" },
  { id: "green", hex: "#00ff00" },
  { id: "black", hex: "#000000" },
  { id: "blue", hex: "#0000ff" },
  { id: "black", hex: "#000000" },
  { id: "white", hex: "#ffffff" },
  { id: "black", hex: "#000000" },
];

/**
 * Rapid primary flashing is the one home remedy with any track record for a
 * stuck subpixel: the transistor is held at a fixed value, and driving the cell
 * between full on and full off sometimes shakes it loose. Returns the colour to
 * paint on a given frame, alternating primaries with black.
 */
export function flashColor(frame: number): TestColor {
  const safe = Number.isFinite(frame) ? Math.trunc(frame) : 0;
  const length = FLASH_SEQUENCE.length;
  return FLASH_SEQUENCE[((safe % length) + length) % length];
}

export interface ScreenInfo {
  /** CSS pixels reported by the browser. */
  cssWidth: number;
  cssHeight: number;
  /** Device pixel ratio: 1 on a standard monitor, 2 or 3 on a phone. */
  pixelRatio: number;
}

export interface ScreenReport {
  /** CSS pixels, e.g. "1920 × 1080". */
  cssResolution: string;
  /** CSS pixels multiplied by the device pixel ratio, e.g. "2560 × 1440". */
  physicalResolution: string;
  pixelRatio: number;
  /** Physical pixels on the panel. */
  totalPixels: number;
  /** Physical subpixels — three per pixel on a standard RGB stripe panel. */
  totalSubpixels: number;
  megapixels: number;
}

const EMPTY_REPORT: ScreenReport = {
  cssResolution: "",
  physicalResolution: "",
  pixelRatio: 0,
  totalPixels: 0,
  totalSubpixels: 0,
  megapixels: 0,
};

export function describeScreen(input: ScreenInfo): ScreenReport {
  if (!input || input.cssWidth <= 0 || input.cssHeight <= 0) return { ...EMPTY_REPORT };

  const ratio = input.pixelRatio > 0 ? input.pixelRatio : 1;
  const cssW = Math.round(input.cssWidth);
  const cssH = Math.round(input.cssHeight);
  const physW = Math.round(cssW * ratio);
  const physH = Math.round(cssH * ratio);
  const totalPixels = physW * physH;

  return {
    cssResolution: `${cssW} × ${cssH}`,
    physicalResolution: `${physW} × ${physH}`,
    pixelRatio: Math.round(ratio * 100) / 100,
    totalPixels,
    totalSubpixels: totalPixels * 3,
    megapixels: Math.round((totalPixels / 1_000_000) * 100) / 100,
  };
}

/** What the viewer saw while stepping through the palette. */
export interface DefectObservation {
  /** A dot that lights up on the black field. */
  visibleOnBlack: boolean;
  /** A dot that stays dark on the white field. */
  visibleOnWhite: boolean;
  /** The same dot shows on every colour, not just one or two. */
  visibleOnEveryColor: boolean;
}

export type DefectKind = "none" | "dead" | "hot" | "stuck" | "dirt" | "inconclusive";

export interface DefectVerdict {
  kind: DefectKind;
  /** Whether flashing or gentle pressure is worth trying before a warranty claim. */
  worthTryingToFix: boolean;
  /** ISO 9241-307 fault type: 1 bright dot, 2 dark dot, 3 partial subpixel, 0 none. */
  isoFaultType: 0 | 1 | 2 | 3;
}

const NO_OBSERVATION: DefectObservation = {
  visibleOnBlack: false,
  visibleOnWhite: false,
  visibleOnEveryColor: false,
};

/**
 * The decision table a panel technician works from, in four rows.
 *
 * A pixel that never lights is dark on white and invisible on black — a dead
 * pixel, and no amount of flashing brings a severed transistor back. A pixel
 * stuck on is bright against black and blends into white; that one is a bright
 * dot and occasionally recoverable. A mark that shows against black *and*
 * against white is not a pixel at all unless it changes with the field colour:
 * dust on the panel or a scratch in the coating reads exactly like that.
 */
export function diagnoseDefect(observation: DefectObservation): DefectVerdict {
  const { visibleOnBlack, visibleOnWhite, visibleOnEveryColor } = observation ?? NO_OBSERVATION;

  if (!visibleOnBlack && !visibleOnWhite) {
    return visibleOnEveryColor
      ? { kind: "inconclusive", worthTryingToFix: false, isoFaultType: 0 }
      : { kind: "none", worthTryingToFix: false, isoFaultType: 0 };
  }

  if (visibleOnWhite && !visibleOnBlack) {
    return { kind: "dead", worthTryingToFix: false, isoFaultType: 2 };
  }

  if (visibleOnBlack && !visibleOnWhite) {
    return { kind: "hot", worthTryingToFix: true, isoFaultType: 1 };
  }

  // Visible on both extremes: dust or coating damage if it ignores the field
  // colour, a partially stuck subpixel if it only shows against some primaries.
  return visibleOnEveryColor
    ? { kind: "dirt", worthTryingToFix: true, isoFaultType: 0 }
    : { kind: "stuck", worthTryingToFix: true, isoFaultType: 3 };
}

export type PixelClass = 0 | 1 | 2 | 3 | 4;

export interface IsoAllowance {
  pixelClass: PixelClass;
  megapixels: number;
  /** Type 1 — pixels permanently lit. */
  brightDots: number;
  /** Type 2 — pixels permanently dark. */
  darkDots: number;
  /** Type 3 — stuck or dim single subpixels. */
  subpixelFaults: number;
  /** Faults permitted in total if the panel hits every limit at once. */
  total: number;
}

/** Faults permitted per million pixels, from the ISO 9241-307 fault-class table. */
const ISO_PER_MEGAPIXEL: Record<PixelClass, readonly [number, number, number]> = {
  0: [0, 0, 0],
  1: [1, 1, 2],
  2: [2, 2, 5],
  3: [5, 15, 50],
  4: [50, 150, 500],
};

/**
 * How many faults the panel's class tolerates before the warranty bites.
 *
 * Almost every consumer monitor and laptop ships as Class II, which on a
 * 1920 × 1080 panel (2.07 megapixels) allows four bright dots, four dark dots
 * and ten stuck subpixels — arithmetic manufacturers rarely spell out. Counts
 * round down, because a fraction of a permitted fault is not one.
 */
export function isoAllowance(totalPixels: number, pixelClass: PixelClass = 2): IsoAllowance {
  const table = ISO_PER_MEGAPIXEL[pixelClass] ?? ISO_PER_MEGAPIXEL[2];
  const megapixels = totalPixels > 0 ? totalPixels / 1_000_000 : 0;
  const brightDots = Math.floor(table[0] * megapixels);
  const darkDots = Math.floor(table[1] * megapixels);
  const subpixelFaults = Math.floor(table[2] * megapixels);

  return {
    pixelClass,
    megapixels: Math.round(megapixels * 100) / 100,
    brightDots,
    darkDots,
    subpixelFaults,
    total: brightDots + darkDots + subpixelFaults,
  };
}
