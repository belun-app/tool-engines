/**
 * Geometry for stamping a text or logo watermark onto a photo.
 *
 * The caller supplies the natural size of the mark — a measured text width for text,
 * the bitmap size for a logo — and gets back one centre point per stamp plus the size
 * to draw each one at. The same plan therefore covers a single corner mark and a tiled
 * pattern, and nothing here touches the DOM: the mount passes a `measureText` closure
 * and does the drawing.
 */

/** Text is measured at this font size, so the final font size is `REFERENCE_FONT_PX * scale`. */
export const REFERENCE_FONT_PX = 100;

export type WatermarkAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "tile";

/** Measures the rendered width of `text` at `fontSizePx`. Backed by `ctx.measureText`. */
export type WatermarkMeasure = (text: string, fontSizePx: number) => number;

export interface WatermarkPlanOptions {
  /** Output canvas width in pixels. */
  canvasWidth: number;
  /** Output canvas height in pixels. */
  canvasHeight: number;
  /** Unscaled mark width: measured text width, or the logo's pixel width. */
  markWidth: number;
  /** Unscaled mark height: text cap-to-descender height, or the logo's pixel height. */
  markHeight: number;
  /** Target mark width as a percentage of the image width. Default 25. */
  sizePercent?: number;
  /** Default "bottom-right" — the corner most people reach for. */
  anchor?: WatermarkAnchor;
  /** Clockwise rotation in degrees. Default 0. */
  rotation?: number;
  /** Edge inset as a percentage of the shorter image side. Default 3. */
  marginPercent?: number;
  /** Space between tiles as a percentage of one stamp's size. Default 60. */
  tileGapPercent?: number;
}

export interface WatermarkStamp {
  /** Centre of the stamp: translate here, rotate, then draw the mark centred on 0,0. */
  cx: number;
  cy: number;
}

export interface WatermarkPlan {
  stamps: WatermarkStamp[];
  /** Drawn width of one stamp before rotation. */
  width: number;
  /** Drawn height of one stamp before rotation. */
  height: number;
  /** Factor applied to the natural mark size. For text: `REFERENCE_FONT_PX * scale` px. */
  scale: number;
  /** Axis-aligned bounding box of one rotated stamp. */
  boundingWidth: number;
  boundingHeight: number;
  rotationRad: number;
  /** True when there is nothing to draw, e.g. empty text or a zero-size canvas. */
  empty: boolean;
}

const EMPTY_PLAN: WatermarkPlan = {
  stamps: [],
  width: 0,
  height: 0,
  scale: 0,
  boundingWidth: 0,
  boundingHeight: 0,
  rotationRad: 0,
  empty: true,
};

/** A tiled pattern never draws more than this many columns or rows. */
const MAX_TILES_PER_AXIS = 20;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * Bounding box of a `width` × `height` rectangle rotated by `degrees`. A 45° mark needs
 * noticeably more room than its own width, which is what keeps rotated watermarks from
 * hanging off the edge of the frame.
 */
export function rotatedBounds(
  width: number,
  height: number,
  degrees: number,
): { width: number; height: number } {
  const w = Math.max(0, num(width, 0));
  const h = Math.max(0, num(height, 0));
  const rad = (num(degrees, 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { width: w * cos + h * sin, height: w * sin + h * cos };
}

/**
 * Places one or many stamps on the canvas. Corner and edge anchors keep the rotated
 * bounding box clear of the margin; "tile" lays out a staggered grid that covers the
 * whole frame, the layout stock-photo agencies use.
 */
export function planWatermark(options: WatermarkPlanOptions): WatermarkPlan {
  const canvasWidth = Math.max(0, num(options.canvasWidth, 0));
  const canvasHeight = Math.max(0, num(options.canvasHeight, 0));
  const markWidth = Math.max(0, num(options.markWidth, 0));
  const markHeight = Math.max(0, num(options.markHeight, 0));

  // A fresh stamps array each time: a shallow copy would share one module-level array.
  if (!canvasWidth || !canvasHeight || !markWidth || !markHeight) {
    return { ...EMPTY_PLAN, stamps: [] };
  }

  const sizePercent = clamp(num(options.sizePercent, 25), 1, 100);
  const anchor = options.anchor ?? "bottom-right";
  const rotation = clamp(num(options.rotation, 0), -180, 180);
  const marginPercent = clamp(num(options.marginPercent, 3), 0, 25);
  const tileGapPercent = clamp(num(options.tileGapPercent, 60), 0, 400);

  // Size is expressed against the image width, so the same percentage gives the same
  // visual weight on a 1000 px thumbnail and a 6000 px export.
  let scale = (canvasWidth * (sizePercent / 100)) / markWidth;
  // A very wide mark rotated to vertical can still overflow the height, so cap it there too.
  const rotatedAtScale = rotatedBounds(markWidth * scale, markHeight * scale, rotation);
  if (rotatedAtScale.height > canvasHeight) {
    scale *= canvasHeight / rotatedAtScale.height;
  }

  const width = markWidth * scale;
  const height = markHeight * scale;
  const bounds = rotatedBounds(width, height, rotation);
  const rotationRad = (rotation * Math.PI) / 180;

  if (anchor === "tile") {
    const stepX = Math.max(
      bounds.width * (1 + tileGapPercent / 100),
      canvasWidth / MAX_TILES_PER_AXIS,
    );
    const stepY = Math.max(
      bounds.height * (1 + tileGapPercent / 100),
      canvasHeight / MAX_TILES_PER_AXIS,
    );
    const cols = Math.ceil(canvasWidth / stepX) + 1;
    const rows = Math.ceil(canvasHeight / stepY) + 1;
    // Centre the grid on the image so the pattern looks deliberate rather than clipped.
    const originX = canvasWidth / 2 - ((cols - 1) * stepX) / 2;
    const originY = canvasHeight / 2 - ((rows - 1) * stepY) / 2;

    const stamps: WatermarkStamp[] = [];
    for (let row = 0; row < rows; row++) {
      // Every other row is offset by half a step — a brick pattern is far harder to
      // crop out than a plain grid.
      const stagger = row % 2 === 0 ? 0 : stepX / 2;
      for (let col = 0; col < cols; col++) {
        stamps.push({ cx: originX + col * stepX + stagger, cy: originY + row * stepY });
      }
    }
    return {
      stamps,
      width,
      height,
      scale,
      boundingWidth: bounds.width,
      boundingHeight: bounds.height,
      rotationRad,
      empty: false,
    };
  }

  const margin = Math.min(canvasWidth, canvasHeight) * (marginPercent / 100);
  const halfW = bounds.width / 2;
  const halfH = bounds.height / 2;

  const left = margin + halfW;
  const right = canvasWidth - margin - halfW;
  const top = margin + halfH;
  const bottom = canvasHeight - margin - halfH;

  // When the mark is wider than the frame minus margins, left and right cross over;
  // centring is the only sane answer.
  const cx = anchor.endsWith("left")
    ? Math.min(left, canvasWidth / 2)
    : anchor.endsWith("right")
      ? Math.max(right, canvasWidth / 2)
      : canvasWidth / 2;
  const cy = anchor.startsWith("top")
    ? Math.min(top, canvasHeight / 2)
    : anchor.startsWith("bottom")
      ? Math.max(bottom, canvasHeight / 2)
      : canvasHeight / 2;

  return {
    stamps: [{ cx, cy }],
    width,
    height,
    scale,
    boundingWidth: bounds.width,
    boundingHeight: bounds.height,
    rotationRad,
    empty: false,
  };
}

/** Collapses a watermark caption to a single line — stamps are one line by definition. */
export function normalizeWatermarkText(text: string): string {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim();
}

/** CSS shorthand for the canvas `font` property. */
export function watermarkFontString(fontSizePx: number, fontFamily: string, bold = true): string {
  const size = Math.max(1, Math.round(num(fontSizePx, 1)));
  const family = fontFamily.trim() || "Arial, Helvetica, sans-serif";
  return `${bold ? "bold " : ""}${size}px ${family}`;
}

export type WatermarkFormatChoice = "keep" | "jpeg" | "png" | "webp";

export interface WatermarkOutput {
  mime: string;
  ext: string;
  /** JPEG and WebP take a quality argument; PNG ignores it. */
  lossy: boolean;
}

const OUTPUTS: Record<Exclude<WatermarkFormatChoice, "keep">, WatermarkOutput> = {
  jpeg: { mime: "image/jpeg", ext: "jpg", lossy: true },
  png: { mime: "image/png", ext: "png", lossy: false },
  webp: { mime: "image/webp", ext: "webp", lossy: true },
};

/**
 * Resolves the export format. "keep" stays with the source type where a canvas can
 * write it; GIF, AVIF, HEIC and SVG sources fall back to PNG, because `toBlob` cannot
 * produce those and would silently hand back a PNG under the wrong extension.
 */
export function resolveWatermarkOutput(
  sourceMime: string,
  choice: WatermarkFormatChoice = "keep",
): WatermarkOutput {
  if (choice !== "keep") return OUTPUTS[choice];
  const mime = (sourceMime || "").toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return OUTPUTS.jpeg;
  if (mime === "image/webp") return OUTPUTS.webp;
  return OUTPUTS.png;
}

/** `beach photo.JPG` -> `beach-photo-watermarked.jpg`. */
export function watermarkFileName(sourceName: string, ext: string, suffix = "watermarked"): string {
  const base = (sourceName || "image")
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "image"}-${suffix}.${ext}`;
}

/**
 * Caps the canvas so every browser can export it. Safari on iOS refuses canvases over
 * roughly 16.7 million pixels, which a 24 MP phone photo exceeds, so the longest side
 * is limited instead of failing at download time.
 */
export function fitCanvas(
  width: number,
  height: number,
  maxSide = 4096,
): { width: number; height: number; scale: number } {
  const w = Math.max(1, Math.round(num(width, 1)));
  const h = Math.max(1, Math.round(num(height, 1)));
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { width: w, height: h, scale: 1 };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  };
}

/** Byte counts for the "this export weighs" readout. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type { ZipEntry } from "../_zip.js";
export { buildZip } from "../_zip.js";
