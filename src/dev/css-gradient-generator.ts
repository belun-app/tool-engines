export type GradientType = "linear" | "radial";
export type RadialShape = "circle" | "ellipse";

export interface ColorStop {
  /** Any CSS color string — a HEX value like "#3b82f6", or rgb()/hsl() */
  color: string;
  /** Stop position along the gradient axis, 0–100 (%) */
  position: number;
}

export interface GradientOptions {
  type: GradientType;
  /** Angle in degrees for linear gradients, 0–360 */
  angle: number;
  /** Shape for radial gradients */
  shape: RadialShape;
  stops: ColorStop[];
}

export interface GradientResult {
  /** The gradient function only, e.g. "linear-gradient(90deg, #fff 0%, #000 100%)" */
  gradient: string;
  /** Ready-to-paste declaration, e.g. "background: linear-gradient(...);" */
  css: string;
  /** False when there are no usable color stops */
  valid: boolean;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Build a CSS gradient string from a set of color stops and options.
 * Pure — no DOM, no side effects. Empty or invalid input yields a
 * zero-value result rather than throwing.
 */
export function buildGradient(options: GradientOptions): GradientResult {
  const stops = Array.isArray(options?.stops) ? options.stops : [];
  const usable = stops.filter(
    (stop) => stop && typeof stop.color === "string" && stop.color.trim() !== "",
  );

  if (usable.length === 0) {
    return { gradient: "", css: "", valid: false };
  }

  const stopStrings = usable.map((stop) => {
    const position = Math.round(clamp(stop.position, 0, 100));
    return `${stop.color.trim()} ${position}%`;
  });
  const inner = stopStrings.join(", ");

  let gradient: string;
  if (options.type === "radial") {
    const shape = options.shape === "ellipse" ? "ellipse" : "circle";
    gradient = `radial-gradient(${shape}, ${inner})`;
  } else {
    const angle = Math.round(clamp(options.angle, 0, 360));
    gradient = `linear-gradient(${angle}deg, ${inner})`;
  }

  return { gradient, css: `background: ${gradient};`, valid: true };
}
