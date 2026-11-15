export const PALETTE_TYPES = [
  "complementary",
  "analogous",
  "triadic",
  "tetradic",
  "monochromatic",
] as const;
export type PaletteType = (typeof PALETTE_TYPES)[number];

export interface PaletteColor {
  hex: string;
  rgb: string;
  hsl: string;
  /** Relative luminance 0..1, useful for picking readable label colors */
  luminance: number;
}

export interface PaletteResult {
  valid: boolean;
  baseHex: string;
  type: PaletteType;
  colors: PaletteColor[];
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function parseHex(input: string): { r: number; g: number; b: number } | null {
  const match = input.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return null;
  const hex = match[1];
  if (hex.length === 3) {
    return {
      r: Number.parseInt(hex[0] + hex[0], 16),
      g: Number.parseInt(hex[1] + hex[1], 16),
      b: Number.parseInt(hex[2] + hex[2], 16),
    };
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function toColor(hsl: Hsl): PaletteColor {
  const s = Math.min(1, Math.max(0, hsl.s));
  const l = Math.min(1, Math.max(0, hsl.l));
  const { r, g, b } = hslToRgb(hsl.h, s, l);
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const hue = Math.round(((hsl.h % 360) + 360) % 360);
  return {
    hex,
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${hue}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`,
    luminance: relativeLuminance(r, g, b),
  };
}

/**
 * Generate a harmonious palette from a base color given as a 3- or 6-digit hex
 * string (with or without #). Invalid input yields { valid: false } with an
 * empty color list.
 */
export function generatePalette(input: string, type: PaletteType): PaletteResult {
  const paletteType = PALETTE_TYPES.includes(type) ? type : "complementary";
  const rgb = parseHex(input);
  if (!rgb) return { valid: false, baseHex: "", type: paletteType, colors: [] };

  const base = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const at = (offset: number): Hsl => ({ h: base.h + offset, s: base.s, l: base.l });

  let colors: Hsl[];
  switch (paletteType) {
    case "complementary":
      colors = [at(0), at(180)];
      break;
    case "analogous":
      colors = [at(-30), at(0), at(30)];
      break;
    case "triadic":
      colors = [at(0), at(120), at(240)];
      break;
    case "tetradic":
      colors = [at(0), at(90), at(180), at(270)];
      break;
    case "monochromatic": {
      const step = (offset: number): Hsl => ({
        h: base.h,
        s: base.s,
        l: Math.min(0.95, Math.max(0.05, base.l + offset)),
      });
      colors = [step(-0.3), step(-0.15), step(0), step(0.15), step(0.3)];
      break;
    }
  }

  return {
    valid: true,
    baseHex: toColor(base).hex,
    type: paletteType,
    colors: colors.map(toColor),
  };
}
