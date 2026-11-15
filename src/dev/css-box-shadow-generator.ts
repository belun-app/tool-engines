export interface ShadowLayer {
  /** Horizontal offset in px — negative moves the shadow left */
  offsetX: number;
  /** Vertical offset in px — negative moves the shadow up */
  offsetY: number;
  /** Blur radius in px, 0 is a hard edge */
  blur: number;
  /** Spread radius in px — negative shrinks the shadow */
  spread: number;
  /** HEX color like "#000000" (#rgb and #rrggbb accepted) */
  color: string;
  /** Shadow opacity, 0–100 (%) */
  opacity: number;
  /** Draw the shadow inside the box instead of behind it */
  inset: boolean;
}

export interface BoxShadowResult {
  /** The value only, e.g. "0px 8px 24px 0px rgba(0, 0, 0, 0.25)" */
  shadow: string;
  /** Ready-to-paste declaration, e.g. "box-shadow: ...;" */
  css: string;
  /** False when there are no usable layers */
  valid: boolean;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** A HEX color at full opacity stays HEX; anything translucent becomes rgba(). */
function formatColor(color: string, opacity: number): string {
  const alpha = clamp(Math.round(opacity), 0, 100);
  const trimmed = color.trim();
  if (alpha >= 100) return trimmed;
  const rgb = hexToRgb(trimmed);
  if (!rgb) return trimmed;
  const a = (alpha / 100).toFixed(2).replace(/0$/, "");
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

/**
 * Build a CSS box-shadow value from one or more shadow layers.
 * Pure — no DOM, no side effects. Empty or invalid input yields a
 * zero-value result rather than throwing.
 */
export function buildBoxShadow(layers: ShadowLayer[]): BoxShadowResult {
  const list = Array.isArray(layers) ? layers : [];
  const usable = list.filter(
    (layer) => layer && typeof layer.color === "string" && layer.color.trim() !== "",
  );

  if (usable.length === 0) {
    return { shadow: "", css: "", valid: false };
  }

  const parts = usable.map((layer) => {
    const x = Math.round(clamp(layer.offsetX, -200, 200));
    const y = Math.round(clamp(layer.offsetY, -200, 200));
    const blur = Math.round(clamp(layer.blur, 0, 200));
    const spread = Math.round(clamp(layer.spread, -100, 100));
    const color = formatColor(layer.color, layer.opacity);
    const prefix = layer.inset ? "inset " : "";
    return `${prefix}${x}px ${y}px ${blur}px ${spread}px ${color}`;
  });

  const shadow = parts.join(", ");
  return { shadow, css: `box-shadow: ${shadow};`, valid: true };
}
