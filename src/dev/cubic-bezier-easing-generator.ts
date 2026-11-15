export interface BezierPoint {
  x: number;
  y: number;
}

export interface CubicBezierOptions {
  /** First control point — x is clamped to the CSS-valid 0–1 range */
  p1: BezierPoint;
  /** Second control point — x is clamped to the CSS-valid 0–1 range */
  p2: BezierPoint;
}

export interface CubicBezierResult {
  /** The function value only, e.g. "cubic-bezier(0.42, 0, 1, 1)" */
  value: string;
  /** Ready-to-paste declaration, e.g. "transition-timing-function: cubic-bezier(0.42, 0, 1, 1);" */
  css: string;
  /** False when the input object is missing */
  valid: boolean;
}

/** Named CSS easing keywords expressed as their equivalent control points */
export const BEZIER_PRESETS: Record<string, CubicBezierOptions> = {
  linear: { p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 } },
  ease: { p1: { x: 0.25, y: 0.1 }, p2: { x: 0.25, y: 1 } },
  "ease-in": { p1: { x: 0.42, y: 0 }, p2: { x: 1, y: 1 } },
  "ease-out": { p1: { x: 0, y: 0 }, p2: { x: 0.58, y: 1 } },
  "ease-in-out": { p1: { x: 0.42, y: 0 }, p2: { x: 0.58, y: 1 } },
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Build a CSS cubic-bezier() timing function from two control points.
 * Pure — no DOM, no side effects. The x of each point is clamped to 0–1,
 * the valid domain for CSS easing functions; y is left free so overshoot
 * and bounce curves stay representable. Invalid input yields a zero-value
 * result rather than throwing.
 */
export function buildCubicBezierCss(options: CubicBezierOptions): CubicBezierResult {
  if (!options || !options.p1 || !options.p2) {
    return { value: "", css: "", valid: false };
  }

  const x1 = round3(clamp(options.p1.x, 0, 1));
  const y1 = round3(clamp(options.p1.y, -2, 2));
  const x2 = round3(clamp(options.p2.x, 0, 1));
  const y2 = round3(clamp(options.p2.y, -2, 2));

  const value = `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
  return { value, css: `transition-timing-function: ${value};`, valid: true };
}
