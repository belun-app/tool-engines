/**
 * Describes a camera stream from its settings: resolution name, aspect ratio, megapixels,
 * and the frame rate measured from frame timestamps.
 */

export interface VideoStreamInput {
  width: number;
  height: number;
  /** Frame rate reported by the camera driver, if any */
  reportedFrameRate?: number;
}

export interface WebcamInfoResult {
  /** e.g. "1280 × 720" */
  resolution: string;
  /** e.g. "HD 720p" */
  resolutionLabel: string;
  /** e.g. "16:9" */
  aspectRatio: string;
  megapixels: number;
  /** Reported frame rate, rounded to one decimal; 0 when unknown */
  frameRate: number;
}

const EMPTY: WebcamInfoResult = {
  resolution: "",
  resolutionLabel: "",
  aspectRatio: "",
  megapixels: 0,
  frameRate: 0,
};

const COMMON_RATIOS: Array<{ label: string; value: number }> = [
  { label: "16:9", value: 16 / 9 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:10", value: 16 / 10 },
  { label: "21:9", value: 21 / 9 },
  { label: "1:1", value: 1 },
  { label: "9:16", value: 9 / 16 },
  { label: "3:4", value: 3 / 4 },
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

function aspectRatioLabel(width: number, height: number): string {
  const ratio = width / height;
  for (const common of COMMON_RATIOS) {
    if (Math.abs(ratio - common.value) / common.value < 0.015) return common.label;
  }
  const divisor = gcd(Math.round(width), Math.round(height));
  const w = Math.round(width) / divisor;
  const h = Math.round(height) / divisor;
  if (w <= 40 && h <= 40) return `${w}:${h}`;
  return `${(ratio >= 1 ? ratio : 1 / ratio).toFixed(2)}:1`;
}

function resolutionLabel(width: number, height: number): string {
  const lines = Math.min(width, height);
  if (lines >= 2160) return "4K UHD";
  if (lines >= 1440) return "QHD 1440p";
  if (lines >= 1080) return "Full HD 1080p";
  if (lines >= 720) return "HD 720p";
  if (lines >= 480) return "SD 480p";
  if (lines > 0) return `${lines}p`;
  return "";
}

/** One decimal, or two below 0.1 MP so a 160 × 120 stream is not reported as 0. */
function megapixels(width: number, height: number): number {
  const mp = (width * height) / 1_000_000;
  return mp < 0.1 ? Math.round(mp * 100) / 100 : Math.round(mp * 10) / 10;
}

/** Analyze the properties of an active camera stream (from MediaTrackSettings). */
export function analyzeVideoStream(input: VideoStreamInput): WebcamInfoResult {
  if (!input || input.width <= 0 || input.height <= 0) return { ...EMPTY };

  const { width, height } = input;
  const reported = input.reportedFrameRate;

  return {
    resolution: `${Math.round(width)} × ${Math.round(height)}`,
    resolutionLabel: resolutionLabel(width, height),
    aspectRatio: aspectRatioLabel(width, height),
    megapixels: megapixels(width, height),
    frameRate: reported && reported > 0 ? Math.round(reported * 10) / 10 : 0,
  };
}

/**
 * Measure the actual frame rate from a series of frame timestamps in milliseconds
 * (e.g. collected via requestVideoFrameCallback). Returns 0 for fewer than 2 frames.
 */
export function measureFrameRate(timestamps: ArrayLike<number>): number {
  if (!timestamps || timestamps.length < 2) return 0;

  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];
  const elapsedMs = last - first;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;

  const fps = ((timestamps.length - 1) * 1000) / elapsedMs;
  return Math.round(fps * 10) / 10;
}
