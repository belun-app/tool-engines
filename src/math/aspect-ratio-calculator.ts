/**
 * Aspect ratio arithmetic: reduces a width and height to a ratio, solves a missing
 * dimension, and names the closest standard format.
 */

export interface AspectRatioResult {
  ratioWidth: number;
  ratioHeight: number;
  ratioString: string;
  scaledHeight: number | null;
  scaledWidth: number | null;
  /** Width ÷ height (1.7778 for 16:9), or 0 for invalid input. */
  decimal: number;
  /**
   * The named format this ratio is sold as, when it differs from the reduced
   * ratio: 64:27 → ≈ 21:9, 8:5 → = 16:10. Null when the reduced ratio already
   * is the name (16:9) or nothing common is close.
   */
  nearest: NearestAspectRatio | null;
}

export interface NearestAspectRatio {
  label: string;
  /** True when the ratio is exactly this format (8:5 is exactly 16:10). */
  exact: boolean;
}

/** Formats people name screens, video and photos by (landscape and portrait). */
export const COMMON_ASPECT_RATIOS: ReadonlyArray<{ label: string; w: number; h: number }> = [
  { label: "16:9", w: 16, h: 9 },
  { label: "16:10", w: 16, h: 10 },
  { label: "21:9", w: 21, h: 9 },
  { label: "32:9", w: 32, h: 9 },
  { label: "4:3", w: 4, h: 3 },
  { label: "3:2", w: 3, h: 2 },
  { label: "5:4", w: 5, h: 4 },
  { label: "1:1", w: 1, h: 1 },
  { label: "9:16", w: 9, h: 16 },
  { label: "10:16", w: 10, h: 16 },
  { label: "3:4", w: 3, h: 4 },
  { label: "2:3", w: 2, h: 3 },
  { label: "4:5", w: 4, h: 5 },
];

/**
 * How far (relative) a ratio may be from a named format and still be called
 * by its name. 3 % covers the "21:9" family (2560×1080 is 2.370, 3440×1440 is
 * 2.389, 21:9 itself is 2.333) and 1366×768 as 16:9, while 16:9 vs 16:10 (11 %)
 * and 4:3 vs 5:4 (6.7 %) stay apart.
 */
export const NEAREST_TOLERANCE = 0.03;

/** The closest named format within NEAREST_TOLERANCE, or null. */
export function nearestAspectRatio(width: number, height: number): NearestAspectRatio | null {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width / height)) return null;
  const ratio = width / height;
  let best: { label: string; diff: number } | null = null;
  for (const c of COMMON_ASPECT_RATIOS) {
    const diff = Math.abs(ratio - c.w / c.h) / (c.w / c.h);
    if (diff <= NEAREST_TOLERANCE && (!best || diff < best.diff)) best = { label: c.label, diff };
  }
  if (!best) return null;
  return { label: best.label, exact: best.diff < 1e-9 };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function calcAspectRatio(
  origWidth: number,
  origHeight: number,
  newWidth: number | null = null,
  newHeight: number | null = null,
): AspectRatioResult {
  if (
    !Number.isFinite(origWidth) ||
    !Number.isFinite(origHeight) ||
    origWidth <= 0 ||
    origHeight <= 0
  ) {
    return {
      ratioWidth: 0,
      ratioHeight: 0,
      ratioString: "—",
      scaledHeight: null,
      scaledWidth: null,
      decimal: 0,
      nearest: null,
    };
  }

  // Decimal sizes (1.5 × 2.5 in, 0.4 × 1 m) are scaled to whole numbers before the gcd,
  // so the ratio is their true one (3:5), not that of the rounded values (2:3, 0:1).
  const decimals = (n: number) => {
    const s = String(n);
    if (s.includes("e")) return 6;
    return Math.min(6, s.split(".")[1]?.length ?? 0);
  };
  const scale = 10 ** Math.max(decimals(origWidth), decimals(origHeight));
  const iw = Math.round(origWidth * scale);
  const ih = Math.round(origHeight * scale);
  const d = gcd(iw, ih);
  const rw = iw / d;
  const rh = ih / d;

  let scaledHeight: number | null = null;
  let scaledWidth: number | null = null;

  if (newWidth !== null && Number.isFinite(newWidth) && newWidth > 0) {
    scaledHeight = Math.round((newWidth * origHeight) / origWidth);
  }

  if (newHeight !== null && Number.isFinite(newHeight) && newHeight > 0) {
    scaledWidth = Math.round((newHeight * origWidth) / origHeight);
  }

  const ratioString = `${rw}:${rh}`;
  const near = nearestAspectRatio(origWidth, origHeight);

  return {
    ratioWidth: rw,
    ratioHeight: rh,
    ratioString,
    scaledHeight,
    scaledWidth,
    decimal: origWidth / origHeight,
    nearest: near && near.label !== ratioString ? near : null,
  };
}
