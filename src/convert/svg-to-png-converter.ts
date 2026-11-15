/**
 * Prepares an SVG for rendering to PNG: checks the markup, reads its size from width, height
 * or viewBox, and computes the output size; the caller draws it on a canvas.
 */

export interface SvgMeta {
  /** Width attribute resolved to CSS pixels, or null when missing/relative. */
  width: number | null;
  /** Height attribute resolved to CSS pixels, or null when missing/relative. */
  height: number | null;
  /** viewBox values [minX, minY, width, height], or null when absent. */
  viewBox: [number, number, number, number] | null;
}

export interface PixelSize {
  width: number;
  height: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 150;

// Absolute CSS unit -> pixel multipliers (96 CSS px per inch).
const UNIT_TO_PX: Record<string, number> = {
  "": 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
};

/** Parse a length attribute like "120", "120px", or "10pt" into CSS pixels. */
function lengthToPx(value: string): number | null {
  const match = value.trim().match(/^(-?[\d.]+)\s*([a-z%]*)$/i);
  if (!match) return null;
  const num = Number.parseFloat(match[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  const factor = UNIT_TO_PX[match[2].toLowerCase()];
  // Relative units (%, em, rem) need a container to resolve, so skip them.
  if (factor === undefined) return null;
  return num * factor;
}

function getOpeningSvgTag(svg: string): string | null {
  const match = svg.match(/<svg\b[^>]*>/i);
  return match ? match[0] : null;
}

function getAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  if (!match) return null;
  return match[2] ?? match[3] ?? null;
}

/** Quick heuristic that the input string contains a complete SVG element. */
export function looksLikeSvg(input: string): boolean {
  return /<svg\b[^>]*>/i.test(input) && /<\/svg\s*>/i.test(input);
}

/** Read the root width, height, and viewBox from SVG markup without a DOM. */
export function parseSvgMeta(svg: string): SvgMeta {
  const tag = getOpeningSvgTag(svg);
  if (!tag) return { width: null, height: null, viewBox: null };

  const widthRaw = getAttr(tag, "width");
  const heightRaw = getAttr(tag, "height");
  const viewBoxRaw = getAttr(tag, "viewBox");

  let viewBox: [number, number, number, number] | null = null;
  if (viewBoxRaw) {
    const parts = viewBoxRaw
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      viewBox = [parts[0], parts[1], parts[2], parts[3]];
    }
  }

  return {
    width: widthRaw ? lengthToPx(widthRaw) : null,
    height: heightRaw ? lengthToPx(heightRaw) : null,
    viewBox,
  };
}

/** Resolve the intrinsic raster size of an SVG following the SVG sizing rules. */
export function resolveIntrinsicSize(meta: SvgMeta): PixelSize {
  const { width, height, viewBox } = meta;
  if (width && height) return { width, height };

  if (viewBox) {
    const [, , vbW, vbH] = viewBox;
    if (vbW > 0 && vbH > 0) {
      // A single explicit dimension keeps the viewBox aspect ratio.
      if (width && !height) return { width, height: (width * vbH) / vbW };
      if (height && !width) return { width: (height * vbW) / vbH, height };
      return { width: vbW, height: vbH };
    }
  }

  if (width && !height) return { width, height: DEFAULT_HEIGHT };
  if (height && !width) return { width: DEFAULT_WIDTH, height };
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

/** Scale a base size by a factor, rounding to whole pixels (minimum 1). */
export function scaledSize(base: PixelSize, scale: number): PixelSize {
  return {
    width: Math.max(1, Math.round(base.width * scale)),
    height: Math.max(1, Math.round(base.height * scale)),
  };
}

/** Derive the height that preserves the aspect ratio for a target width. */
export function sizeFromWidth(base: PixelSize, targetWidth: number): PixelSize {
  const width = Math.max(1, Math.round(targetWidth));
  const ratio = base.width > 0 ? base.height / base.width : 1;
  return { width, height: Math.max(1, Math.round(width * ratio)) };
}

/** Replace the source extension with .png (or append it when absent). */
export function getPngFilename(svgName: string): string {
  const trimmed = svgName.trim();
  if (!trimmed) return "image.png";
  const base = /\.svg$/i.test(trimmed)
    ? trimmed.replace(/\.svg$/i, "")
    : trimmed.replace(/\.[^.]+$/, "");
  return `${base || "image"}.png`;
}

/**
 * Return SVG markup ready to rasterise at an exact pixel size: the root width
 * and height are set to the target, a viewBox is guaranteed, and the SVG
 * namespace is present so the browser can render it as an <img> source.
 */
export function prepareSvgForRender(svg: string, width: number, height: number): string {
  const tag = getOpeningSvgTag(svg);
  if (!tag) return svg;

  const meta = parseSvgMeta(svg);
  const intrinsic = resolveIntrinsicSize(meta);
  const viewBox = meta.viewBox
    ? meta.viewBox.join(" ")
    : `0 0 ${intrinsic.width} ${intrinsic.height}`;

  const inner = tag
    .replace(/^<svg/i, "")
    .replace(/>$/, "")
    .replace(/\s(width|height|viewBox)\s*=\s*("[^"]*"|'[^']*')/gi, "");

  let attrs = ` width="${width}" height="${height}" viewBox="${viewBox}"`;
  if (!/\bxmlns\s*=/i.test(inner)) attrs += ` xmlns="${SVG_NS}"`;

  return svg.replace(tag, () => `<svg${inner}${attrs}>`);
}
