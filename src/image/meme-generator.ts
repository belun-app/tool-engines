/**
 * Meme caption layout: caption normalisation, greedy word wrapping to the image width and
 * font sizing for the top and bottom text.
 */

export type MemeCaptionPosition = "top" | "bottom";

/**
 * Measures the rendered width of `text` at `fontSizePx`. The mount passes a closure
 * around `CanvasRenderingContext2D.measureText`, which keeps this file DOM-free.
 */
export type MemeMeasure = (text: string, fontSizePx: number) => number;

export interface MemeLayoutOptions {
  /** Rendered image width in pixels. */
  width: number;
  /** Rendered image height in pixels. */
  height: number;
  position: MemeCaptionPosition;
  /** Starting cap height as a fraction of image height. Default 0.1. */
  fontScale?: number;
  /** Horizontal breathing room on each side, as a fraction of image width. Default 0.04. */
  paddingScale?: number;
  /** Baseline-to-baseline distance as a multiple of the font size. Default 1.12. */
  lineHeight?: number;
  /** Classic meme styling shouts. Default true. */
  uppercase?: boolean;
  /** Caption block is shrunk until it fits this many lines. Default 4. */
  maxLines?: number;
  /** Auto-shrink never goes below this. Default 10. */
  minFontSizePx?: number;
}

export interface MemeLine {
  text: string;
  /** Measured width at the final font size. */
  width: number;
  /** Baseline y coordinate in image pixels. */
  y: number;
}

export interface MemeCaptionLayout {
  lines: MemeLine[];
  fontSizePx: number;
  /** Outline thickness that keeps white-on-white captions readable. */
  strokeWidthPx: number;
  /** Center x — captions are drawn with textAlign "center". */
  x: number;
  /** Total height from the top of the first line to the bottom of the last. */
  blockHeight: number;
  empty: boolean;
}

const EMPTY_LAYOUT: MemeCaptionLayout = {
  lines: [],
  fontSizePx: 0,
  strokeWidthPx: 0,
  x: 0,
  blockHeight: 0,
  empty: true,
};

/** Collapses runs of spaces and tabs but keeps deliberate line breaks intact. */
export function normalizeCaption(text: string, uppercase = true): string {
  if (typeof text !== "string") return "";
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return uppercase ? cleaned.toUpperCase() : cleaned;
}

/** Splits a single word that is wider than the line box into pieces that fit. */
function breakLongWord(word: string, maxWidth: number, size: number, measure: MemeMeasure) {
  const pieces: string[] = [];
  let piece = "";
  for (const char of word) {
    const candidate = piece + char;
    if (piece && measure(candidate, size) > maxWidth) {
      pieces.push(piece);
      piece = char;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Greedy word wrap. Manual line breaks in `text` are always honoured. */
export function wrapMemeText(
  text: string,
  maxWidth: number,
  fontSizePx: number,
  measure: MemeMeasure,
): string[] {
  if (!text) return [];
  const width = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : Number.POSITIVE_INFINITY;
  const out: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate, fontSizePx) > width) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
      if (measure(line, fontSizePx) > width) {
        const pieces = breakLongWord(line, width, fontSizePx, measure);
        line = pieces.pop() ?? "";
        out.push(...pieces);
      }
    }
    out.push(line);
  }

  return out;
}

/**
 * Wraps one caption and places every line, shrinking the font until the block fits
 * both the line budget and the top (or bottom) 45% of the image.
 */
export function layoutMemeCaption(
  rawText: string,
  measure: MemeMeasure,
  options: MemeLayoutOptions,
): MemeCaptionLayout {
  const width = Number.isFinite(options.width) ? Math.max(1, options.width) : 1;
  const height = Number.isFinite(options.height) ? Math.max(1, options.height) : 1;
  const {
    position,
    fontScale = 0.1,
    paddingScale = 0.04,
    lineHeight = 1.12,
    uppercase = true,
    maxLines = 4,
    minFontSizePx = 10,
  } = options;

  const text = normalizeCaption(rawText, uppercase);
  if (!text) return EMPTY_LAYOUT;

  const padX = width * Math.max(0, paddingScale);
  const padY = height * 0.035;
  const maxTextWidth = Math.max(1, width - padX * 2);
  const maxBlockHeight = height * 0.45;

  let size = Math.max(minFontSizePx, Math.round(height * Math.max(0.01, fontScale)));
  let lines = wrapMemeText(text, maxTextWidth, size, measure);

  while (
    size > minFontSizePx &&
    (lines.length > maxLines || lines.length * size * lineHeight > maxBlockHeight)
  ) {
    size = Math.max(minFontSizePx, Math.floor(size * 0.92));
    lines = wrapMemeText(text, maxTextWidth, size, measure);
  }

  const step = size * lineHeight;
  const blockHeight = lines.length * step;
  const strokeWidthPx = Math.max(1, size / 12);

  const placed: MemeLine[] = lines.map((line, i) => {
    const y =
      position === "top"
        ? padY + size * 0.86 + i * step
        : height - padY - (lines.length - 1 - i) * step - size * 0.2;
    return { text: line, width: measure(line, size), y };
  });

  return {
    lines: placed,
    fontSizePx: size,
    strokeWidthPx,
    x: width / 2,
    blockHeight,
    empty: false,
  };
}

/** CSS shorthand for the canvas `font` property. */
export function memeFontString(fontSizePx: number, fontFamily: string): string {
  const size = Math.max(1, Math.round(fontSizePx));
  const family = fontFamily.trim() || "Impact, sans-serif";
  return `bold ${size}px ${family}`;
}

/** Keeps very large uploads inside a canvas size every browser handles comfortably. */
export function fitWithin(
  width: number,
  height: number,
  maxSide = 2000,
): { width: number; height: number; scale: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { width: Math.round(w), height: Math.round(h), scale: 1 };
  const scale = maxSide / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale), scale };
}

/** `cat.jpg` + "top text" -> `top-text-meme.png`, falling back to the source name. */
export function memeFileName(caption: string, sourceName = "image"): string {
  const fromCaption = normalizeCaption(caption, false)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40)
    .replace(/-+$/, "");
  const fromSource = sourceName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const base = fromCaption || fromSource || "meme";
  return `${base}-meme.png`;
}
