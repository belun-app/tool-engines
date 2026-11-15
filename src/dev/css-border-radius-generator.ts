export type RadiusUnit = "px" | "%";

export interface BorderRadiusCorners {
  /** Top-left radius */
  topLeft: number;
  /** Top-right radius */
  topRight: number;
  /** Bottom-right radius */
  bottomRight: number;
  /** Bottom-left radius */
  bottomLeft: number;
  /** Unit applied to all four corners */
  unit: RadiusUnit;
}

export interface BorderRadiusResult {
  /** The value only, e.g. "8px 24px" */
  radius: string;
  /** Ready-to-paste declaration, e.g. "border-radius: 8px 24px;" */
  css: string;
  /** False when the input object is missing */
  valid: boolean;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

/**
 * Build a CSS border-radius value from four corner radii, collapsing to the
 * shortest shorthand (the same top-left-first rules as margin/padding).
 * Pure — no DOM, no side effects. Invalid input yields a zero-value result
 * rather than throwing.
 */
export function buildBorderRadius(corners: BorderRadiusCorners): BorderRadiusResult {
  if (!corners || typeof corners !== "object") {
    return { radius: "", css: "", valid: false };
  }

  const unit: RadiusUnit = corners.unit === "%" ? "%" : "px";
  const max = unit === "%" ? 100 : 500;

  const tl = Math.round(clamp(corners.topLeft, 0, max));
  const tr = Math.round(clamp(corners.topRight, 0, max));
  const br = Math.round(clamp(corners.bottomRight, 0, max));
  const bl = Math.round(clamp(corners.bottomLeft, 0, max));

  // Shorthand order is top-left, top-right, bottom-right, bottom-left;
  // trailing values collapse when they mirror an earlier corner.
  const values = [tl, tr, br, bl];
  if (values[3] === values[1]) values.pop();
  if (values.length === 3 && values[2] === values[0]) values.pop();
  if (values.length === 2 && values[1] === values[0]) values.pop();

  const radius = values.map((v) => `${v}${unit}`).join(" ");
  return { radius, css: `border-radius: ${radius};`, valid: true };
}
