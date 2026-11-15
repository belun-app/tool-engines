/**
 * Describes a screen from its size and device pixel ratio: physical resolution, aspect
 * ratio, marketing name and estimated browser zoom.
 */

export interface ScreenInfoInput {
  screenWidth: number;
  screenHeight: number;
  availWidth: number;
  availHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  colorDepth: number;
}

export interface ScreenInfoResult {
  resolution: string;
  physicalResolution: string;
  viewport: string;
  available: string;
  aspectRatio: string;
  orientation: string;
  megapixels: number;
  pixelRatio: number;
  /** English label, kept for callers that have no page texts; prefer `pixelDensity`. */
  pixelDensityLabel: string;
  /** Marketing name of the physical resolution ("Full HD (1080p)"), or "". */
  resolutionName: string;
  /** Density class as a code; the page maps it to its own label. */
  pixelDensity: PixelDensity;
  colorDepth: number;
}

export type PixelDensity = "" | "standard" | "hidpi" | "retina" | "super-retina";

const EMPTY: ScreenInfoResult = {
  resolution: "",
  physicalResolution: "",
  viewport: "",
  available: "",
  aspectRatio: "",
  orientation: "",
  megapixels: 0,
  pixelRatio: 0,
  pixelDensityLabel: "",
  resolutionName: "",
  pixelDensity: "",
  colorDepth: 0,
};

const COMMON_RATIOS: Array<{ label: string; value: number }> = [
  { label: "16:9", value: 16 / 9 },
  { label: "16:10", value: 16 / 10 },
  { label: "21:9", value: 21 / 9 },
  // Ultrawides are sold as "21:9" although their panels are 64:27 (2560×1080)
  // and 43:18 (3440×1440); 21/9 itself is 1.6 % away from both.
  { label: "21:9", value: 64 / 27 },
  { label: "21:9", value: 43 / 18 },
  { label: "32:9", value: 32 / 9 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "5:4", value: 5 / 4 },
  { label: "1:1", value: 1 },
  { label: "9:16", value: 9 / 16 },
  { label: "10:16", value: 10 / 16 },
  { label: "3:4", value: 3 / 4 },
  { label: "2:3", value: 2 / 3 },
  { label: "9:21", value: 27 / 64 },
  { label: "9:21", value: 18 / 43 },
];

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

export function simplifyAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) return "";

  const ratio = width / height;
  for (const common of COMMON_RATIOS) {
    if (Math.abs(ratio - common.value) / common.value < 0.012) return common.label;
  }

  const divisor = gcd(Math.round(width), Math.round(height));
  const w = Math.round(width) / divisor;
  const h = Math.round(height) / divisor;
  if (w <= 40 && h <= 40) return `${w}:${h}`;

  // Portrait screens keep the portrait form ("1:2.16"), like the orientation.
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

function pixelDensityClass(ratio: number): PixelDensity {
  if (ratio <= 0) return "";
  if (ratio < 1.25) return "standard";
  if (ratio < 2) return "hidpi";
  if (ratio < 3) return "retina";
  return "super-retina";
}

function pixelDensityLabel(ratio: number): string {
  if (ratio <= 0) return "";
  if (ratio < 1.25) return "Standard (1×)";
  if (ratio < 2) return "HiDPI (1.25–1.99×)";
  if (ratio < 3) return "Retina / HiDPI (2×)";
  return "Super Retina (3×+)";
}

/**
 * Marketing names of common panel resolutions, keyed by "long×short" physical
 * pixels. Names are the same in English and Russian ("Full HD", "4K UHD").
 */
const RESOLUTION_NAMES: Record<string, string> = {
  "1024x768": "XGA",
  "1280x720": "HD (720p)",
  "1280x800": "WXGA",
  "1280x1024": "SXGA",
  "1366x768": "HD (WXGA)",
  "1440x900": "WXGA+",
  "1600x900": "HD+ (900p)",
  "1680x1050": "WSXGA+",
  "1920x1080": "Full HD (1080p)",
  "1920x1200": "WUXGA",
  "2560x1080": "Ultrawide Full HD (21:9)",
  "2560x1440": "QHD / 2K (1440p)",
  "2560x1600": "WQXGA",
  "3440x1440": "Ultrawide QHD (21:9)",
  "3840x1600": "Ultrawide 4K (WQHD+)",
  "3840x2160": "4K UHD (2160p)",
  "4096x2160": "DCI 4K",
  "5120x1440": "Dual QHD (32:9)",
  "5120x2880": "5K",
  "7680x4320": "8K UHD",
};

/**
 * Marketing name of a physical resolution ("Full HD (1080p)"), or "" when the
 * panel is not one of the named sizes (phones, laptops with odd panels).
 * Orientation does not matter: 1080×1920 is still Full HD.
 */
export function resolutionName(width: number, height: number): string {
  const w = Math.round(width);
  const h = Math.round(height);
  if (w <= 0 || h <= 0) return "";
  return RESOLUTION_NAMES[`${Math.max(w, h)}x${Math.min(w, h)}`] ?? "";
}

/** Zoom levels Chrome, Edge and Firefox offer, as fractions. */
const ZOOM_LEVELS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.1, 1.2, 1.25, 1.33, 1.5, 1.7, 1.75, 2, 2.4, 2.5, 3, 4, 5,
];

/**
 * Estimates the browser zoom from the window's outer and inner widths. Returns the
 * zoom as a percentage (150) when it is clearly not 100 % and lands on a zoom level
 * browsers actually offer, else 0. A docked DevTools panel or a sidebar shrinks the
 * inner width by an arbitrary amount, so ratios that match no zoom level are ignored.
 */
export function estimateZoom(outerWidth: number, innerWidth: number): number {
  if (!(outerWidth > 0) || !(innerWidth > 0)) return 0;
  const ratio = outerWidth / innerWidth;
  if (Math.abs(ratio - 1) < 0.08) return 0;
  const level = ZOOM_LEVELS.find((z) => Math.abs(ratio - z) / z < 0.02);
  return level ? Math.round(level * 100) : 0;
}

const formatPair = (w: number, h: number): string =>
  w > 0 && h > 0 ? `${Math.round(w)} × ${Math.round(h)}` : "";

export function analyzeScreen(input: ScreenInfoInput): ScreenInfoResult {
  const { screenWidth, screenHeight } = input;
  if (screenWidth <= 0 || screenHeight <= 0) return { ...EMPTY };

  const ratio = input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
  const physicalWidth = screenWidth * ratio;
  const physicalHeight = screenHeight * ratio;

  let orientation = "Square";
  if (screenWidth > screenHeight) orientation = "Landscape";
  else if (screenWidth < screenHeight) orientation = "Portrait";

  return {
    resolution: formatPair(screenWidth, screenHeight),
    physicalResolution: formatPair(physicalWidth, physicalHeight),
    viewport: formatPair(input.viewportWidth, input.viewportHeight),
    available: formatPair(input.availWidth, input.availHeight),
    aspectRatio: simplifyAspectRatio(screenWidth, screenHeight),
    orientation,
    megapixels: Math.round((physicalWidth * physicalHeight) / 100_000) / 10,
    pixelRatio: Math.round(ratio * 100) / 100,
    pixelDensityLabel: pixelDensityLabel(ratio),
    resolutionName: resolutionName(physicalWidth, physicalHeight),
    pixelDensity: pixelDensityClass(ratio),
    colorDepth: input.colorDepth > 0 ? input.colorDepth : 0,
  };
}
