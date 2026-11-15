/**
 * Rotation and mirroring math for the Rotate / Flip Image tool.
 *
 * The browser part only decodes the file and calls drawImage; every number it
 * needs — canvas size, transform matrix, filename, labels — comes from here.
 */

export type RotateFormat = "jpeg" | "png" | "webp";

export interface RotateFormatInfo {
  value: RotateFormat;
  label: string;
  mime: string;
  ext: string;
  /** PNG and WebP keep an alpha channel; JPEG has to fill the corners. */
  supportsAlpha: boolean;
}

export const ROTATE_FORMATS: RotateFormatInfo[] = [
  { value: "jpeg", label: "JPEG", mime: "image/jpeg", ext: "jpg", supportsAlpha: false },
  { value: "png", label: "PNG", mime: "image/png", ext: "png", supportsAlpha: true },
  { value: "webp", label: "WebP", mime: "image/webp", ext: "webp", supportsAlpha: true },
];

export function getFormatInfo(format: RotateFormat): RotateFormatInfo {
  return ROTATE_FORMATS.find((f) => f.value === format) ?? ROTATE_FORMATS[0];
}

export interface TransformState {
  /** Clockwise rotation in degrees, always normalised to 0–359.99. */
  angle: number;
  /** Mirror left-to-right, applied in screen space after rotation. */
  flipH: boolean;
  /** Mirror top-to-bottom, applied in screen space after rotation. */
  flipV: boolean;
}

export interface Size {
  width: number;
  height: number;
}

/** 2D affine matrix in canvas setTransform order: a, b, c, d, e, f. */
export type Matrix = [number, number, number, number, number, number];

export interface DrawPlan {
  /** Canvas size that fits the transformed image exactly. */
  canvas: Size;
  matrix: Matrix;
  /** Top-left corner for drawImage once the matrix is active. */
  drawX: number;
  drawY: number;
  /** True when the corners stay filled, so no background colour is needed. */
  isRightAngle: boolean;
}

export const IDENTITY_STATE: TransformState = { angle: 0, flipH: false, flipV: false };

export function identityState(): TransformState {
  return { ...IDENTITY_STATE };
}

/** Fold any degree value into 0–359.99, so -90 and 270 are the same rotation. */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = deg % 360;
  const positive = wrapped < 0 ? wrapped + 360 : wrapped;
  // 359.9999999 from float drift should read as 0, not as a near-full turn.
  const rounded = Math.round(positive * 100) / 100;
  return rounded >= 360 ? 0 : rounded;
}

/** A multiple of 90° leaves no empty triangles in the corners. */
export function isRightAngle(angle: number): boolean {
  return normalizeAngle(angle) % 90 === 0;
}

export function rotateBy(state: TransformState, deltaDeg: number): TransformState {
  return { ...state, angle: normalizeAngle(state.angle + deltaDeg) };
}

export function setAngle(state: TransformState, deg: number): TransformState {
  return { ...state, angle: normalizeAngle(deg) };
}

export function toggleFlipH(state: TransformState): TransformState {
  return { ...state, flipH: !state.flipH };
}

export function toggleFlipV(state: TransformState): TransformState {
  return { ...state, flipV: !state.flipV };
}

export function isIdentity(state: TransformState): boolean {
  return normalizeAngle(state.angle) === 0 && !state.flipH && !state.flipV;
}

/**
 * Bounding box of a w×h rectangle turned by `angle`.
 * At 90° and 270° this is the swapped original size; in between it grows.
 */
export function getRotatedSize(width: number, height: number, angle: number): Size {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const a = normalizeAngle(angle);
  if (a === 0 || a === 180) return { width, height };
  if (a === 90 || a === 270) return { width: height, height: width };
  const rad = (a * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: Math.max(1, Math.round(width * cos + height * sin)),
    height: Math.max(1, Math.round(width * sin + height * cos)),
  };
}

/**
 * Everything the canvas needs for one render.
 *
 * The matrix is built as translate → scale → rotate, so a horizontal flip
 * always mirrors what the viewer currently sees rather than the original
 * pixel grid. That ordering is what people expect from a photo editor: after
 * a 90° turn, "flip horizontally" still mirrors left-to-right on screen.
 */
export function getDrawPlan(width: number, height: number, state: TransformState): DrawPlan {
  const canvas = getRotatedSize(width, height, state.angle);
  const a = normalizeAngle(state.angle);
  const rad = (a * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = state.flipH ? -1 : 1;
  const sy = state.flipV ? -1 : 1;
  return {
    canvas,
    matrix: [sx * cos, sy * sin, -sx * sin, sy * cos, canvas.width / 2, canvas.height / 2],
    drawX: -width / 2,
    drawY: -height / 2,
    isRightAngle: isRightAngle(a),
  };
}

/** Does the result need a background fill behind it? */
export function needsBackground(state: TransformState, format: RotateFormat): boolean {
  if (!isRightAngle(state.angle)) return true;
  return !getFormatInfo(format).supportsAlpha;
}

export type RotateLang = "en" | "ru";

export interface TransformLabels {
  rotation: string;
  flip: string;
  /** Filename-safe summary such as "rot90-fliph". Empty for an untouched image. */
  slug: string;
}

const WORDS: Record<RotateLang, Record<string, string>> = {
  en: {
    none: "None",
    clockwise: "clockwise",
    horizontal: "Horizontal",
    vertical: "Vertical",
    both: "Horizontal + vertical",
  },
  ru: {
    none: "Нет",
    clockwise: "по часовой",
    horizontal: "По горизонтали",
    vertical: "По вертикали",
    both: "По горизонтали и вертикали",
  },
};

/** Human-readable summary of the current transform, for the status line. */
export function describeTransform(state: TransformState, lang: RotateLang = "en"): TransformLabels {
  const w = WORDS[lang] ?? WORDS.en;
  const angle = normalizeAngle(state.angle);
  const rotation = angle === 0 ? w.none : `${formatAngle(angle)}° ${w.clockwise}`;
  let flip = w.none;
  if (state.flipH && state.flipV) flip = w.both;
  else if (state.flipH) flip = w.horizontal;
  else if (state.flipV) flip = w.vertical;

  const parts: string[] = [];
  if (angle !== 0) parts.push(`rot${formatAngle(angle).replace(".", "-")}`);
  if (state.flipH) parts.push("fliph");
  if (state.flipV) parts.push("flipv");
  return { rotation, flip, slug: parts.join("-") };
}

/** Trim trailing zeros so 90 stays "90" and 12.5 stays "12.5". */
export function formatAngle(angle: number): string {
  const a = normalizeAngle(angle);
  return Number.isInteger(a) ? String(a) : a.toFixed(1).replace(/\.0$/, "");
}

export function getRotatedFilename(originalName: string, state: TransformState): string {
  const base = originalName.replace(/\.[^.]+$/, "") || "image";
  const suffix = describeTransform(state).slug;
  return suffix ? `${base}-${suffix}` : `${base}-rotated`;
}

/** Snap a freehand angle to the nearest multiple of `step` when it is close. */
export function snapAngle(angle: number, step = 90, tolerance = 2): number {
  const a = normalizeAngle(angle);
  const nearest = Math.round(a / step) * step;
  return Math.abs(a - nearest) <= tolerance ? normalizeAngle(nearest) : a;
}

/** Hex colour guard for the background picker; falls back to white. */
export function normalizeHexColor(value: string, fallback = "#ffffff"): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}
