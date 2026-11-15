/**
 * Turns freehand pen strokes into an SVG signature: stroke cleanup, smoothed path data, the
 * bounding box and the SVG document.
 */

export interface SignaturePoint {
  x: number;
  y: number;
}

export interface SignatureStroke {
  points: SignaturePoint[];
  color: string;
  width: number;
}

export interface SignatureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  empty: boolean;
}

export interface SignatureStats {
  strokes: number;
  points: number;
  empty: boolean;
}

function isPoint(p: SignaturePoint | undefined): p is SignaturePoint {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Drops non-finite points and collapses duplicates that sit closer than `minDistance`. */
export function cleanStroke(points: SignaturePoint[], minDistance = 0.6): SignaturePoint[] {
  if (!Array.isArray(points)) return [];
  const out: SignaturePoint[] = [];
  for (const point of points) {
    if (!isPoint(point)) continue;
    const last = out[out.length - 1];
    if (last) {
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (Math.hypot(dx, dy) < minDistance) continue;
    }
    out.push({ x: point.x, y: point.y });
  }
  return out;
}

/**
 * Builds an SVG/Canvas path string for one stroke. Consecutive points are joined
 * with quadratic curves through their midpoints, which is what turns a jittery
 * mouse trail into a line that looks like ink.
 */
export function strokeToPathData(points: SignaturePoint[], precision = 2): string {
  const pts = cleanStroke(points, 0);
  if (pts.length === 0) return "";

  const n = (value: number) => Number(value.toFixed(precision)).toString();

  if (pts.length === 1) {
    const p = pts[0];
    return `M ${n(p.x)} ${n(p.y)} L ${n(p.x + 0.01)} ${n(p.y)}`;
  }

  if (pts.length === 2) {
    return `M ${n(pts[0].x)} ${n(pts[0].y)} L ${n(pts[1].x)} ${n(pts[1].y)}`;
  }

  let d = `M ${n(pts[0].x)} ${n(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const current = pts[i];
    const next = pts[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    d += ` Q ${n(current.x)} ${n(current.y)} ${n(midX)} ${n(midY)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${n(last.x)} ${n(last.y)}`;
  return d;
}

/** Tightest box containing every stroke, grown by half the pen width plus `padding`. */
export function signatureBounds(strokes: SignatureStroke[], padding = 0): SignatureBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const stroke of strokes ?? []) {
    const half = Math.max(0, Number.isFinite(stroke?.width) ? stroke.width : 0) / 2;
    for (const point of stroke?.points ?? []) {
      if (!isPoint(point)) continue;
      found = true;
      if (point.x - half < minX) minX = point.x - half;
      if (point.y - half < minY) minY = point.y - half;
      if (point.x + half > maxX) maxX = point.x + half;
      if (point.y + half > maxY) maxY = point.y + half;
    }
  }

  if (!found) return { x: 0, y: 0, width: 0, height: 0, empty: true };

  const pad = Math.max(0, padding);
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
    empty: false,
  };
}

export function signatureStats(strokes: SignatureStroke[]): SignatureStats {
  let points = 0;
  let drawn = 0;
  for (const stroke of strokes ?? []) {
    const count = (stroke?.points ?? []).filter(isPoint).length;
    if (count > 0) drawn++;
    points += count;
  }
  return { strokes: drawn, points, empty: points === 0 };
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SvgOptions {
  /** Solid background colour; omit or pass "transparent" for no background rect. */
  background?: string;
  /** Crop the viewBox to the ink instead of exporting the whole canvas. */
  trim?: boolean;
  /** Extra space around the ink when trimming, in canvas pixels. */
  padding?: number;
}

/** Serialises the strokes as a standalone SVG document. */
export function strokesToSvg(
  strokes: SignatureStroke[],
  canvasWidth: number,
  canvasHeight: number,
  options: SvgOptions = {},
): string {
  const { background, trim = false, padding = 8 } = options;
  const bounds = trim
    ? signatureBounds(strokes, padding)
    : { x: 0, y: 0, width: canvasWidth, height: canvasHeight, empty: false };

  const viewX = bounds.empty ? 0 : bounds.x;
  const viewY = bounds.empty ? 0 : bounds.y;
  const viewW = Math.max(1, Math.round(bounds.empty ? canvasWidth : bounds.width));
  const viewH = Math.max(1, Math.round(bounds.empty ? canvasHeight : bounds.height));

  const paths: string[] = [];
  for (const stroke of strokes ?? []) {
    const d = strokeToPathData(stroke?.points ?? []);
    if (!d) continue;
    const color = escapeAttr(stroke.color || "#000000");
    const width = Math.max(0.1, Number.isFinite(stroke.width) ? stroke.width : 1);
    const caps = 'stroke-linecap="round" stroke-linejoin="round"';
    paths.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" ${caps}/>`);
  }

  const rect =
    background && background !== "transparent"
      ? `<rect x="${viewX}" y="${viewY}" width="${viewW}" height="${viewH}" fill="${escapeAttr(background)}"/>`
      : "";

  const attrs = `width="${viewW}" height="${viewH}" viewBox="${viewX} ${viewY} ${viewW} ${viewH}"`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>`;
  return `${open}${rect}${paths.join("")}</svg>`;
}

/** Filename for a downloaded signature, e.g. `signature-2026-08-06.png`. */
export function signatureFileName(extension: string, isoDate: string): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? "signature";
  const ext = extension.replace(/^\./, "").toLowerCase() || "png";
  return `signature-${date}.${ext}`;
}
