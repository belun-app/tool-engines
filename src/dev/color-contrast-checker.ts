/**
 * WCAG 2 contrast ratio between two colours, with the AA and AAA verdicts for normal and
 * large text.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface ContrastResult {
  valid: boolean;
  ratio: number;
  ratioText: string;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
  uiComponents: boolean;
  foregroundHex: string;
  backgroundHex: string;
}

const INVALID_RESULT: ContrastResult = {
  valid: false,
  ratio: 0,
  ratioText: "—",
  aaNormal: false,
  aaLarge: false,
  aaaNormal: false,
  aaaLarge: false,
  uiComponents: false,
  foregroundHex: "",
  backgroundHex: "",
};

export function parseColor(input: string): RgbColor | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  const hexMatch = value.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  const rgbMatch = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    if (r > 255 || g > 255 || b > 255) return null;
    return { r, g, b };
  }

  return null;
}

export function toHex(color: RgbColor): string {
  const part = (n: number) => n.toString(16).padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

export function relativeLuminance(color: RgbColor): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function checkContrast(foreground: string, background: string): ContrastResult {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return INVALID_RESULT;

  const raw = contrastRatio(fg, bg);
  const ratio = Math.round(raw * 100) / 100;

  return {
    valid: true,
    ratio,
    ratioText: `${ratio.toFixed(2)}:1`,
    aaNormal: raw >= 4.5,
    aaLarge: raw >= 3,
    aaaNormal: raw >= 7,
    aaaLarge: raw >= 4.5,
    uiComponents: raw >= 3,
    foregroundHex: toHex(fg),
    backgroundHex: toHex(bg),
  };
}
