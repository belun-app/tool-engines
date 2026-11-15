/**
 * Client-side PDF page numberer.
 *
 * Stamps a page number onto every chosen page of a PDF and writes a new file. The number is
 * drawn as real text with one of the 14 built-in PDF fonts, so it stays selectable, searchable,
 * and sharp at any zoom — no rasterising, no watermark, and nothing is re-encoded.
 *
 * Two details most online stampers get wrong are handled here. Pages that carry a /Rotate flag
 * get a matching transform, so the number lands at the visual bottom of a landscape scan rather
 * than sideways along an edge. And the stamp is written into its own content stream after a
 * restore, which keeps it in place when the original page leaves an unbalanced `q` behind.
 *
 * The built-in fonts only cover Latin-1, so a Cyrillic or Greek label cannot be drawn; such
 * characters are dropped and reported back as a warning rather than silently mangled.
 */

import {
  type PageSelection,
  type PdfDocument,
  type PdfInflate,
  buildPdf,
  formatFileSize,
  pageBox,
  pageRotation,
  parseDocument,
  parsePageRanges,
  sanitizeWinAnsi,
  standardTextWidth,
  viewTransform,
  winAnsiHex,
} from "./_pdf-lib.js";

export type { PdfInflate } from "./_pdf-lib.js";
export { formatFileSize, parsePageRanges } from "./_pdf-lib.js";

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

export type NumberStyle = "arabic" | "roman-lower" | "roman-upper" | "alpha-lower" | "alpha-upper";

export type NumberPosition =
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "top-left"
  | "top-center"
  | "top-right";

export type NumberFont = "helvetica" | "helvetica-bold" | "times" | "times-bold" | "courier";

export interface PageNumberOptions {
  /** Template for the stamp. `{n}` is the page number, `{total}` the last number used. */
  format?: string;
  /** The number printed on the first page that gets one. Defaults to 1. */
  startNumber?: number;
  style?: NumberStyle;
  position?: NumberPosition;
  font?: NumberFont;
  /** Type size in points. Clamped to 4–72. */
  fontSize?: number;
  /** Distance from the page edge in points. 72 points is one inch. Clamped to 0–200. */
  margin?: number;
  /** Which pages get a number, e.g. "2-". Empty or omitted means every page. */
  ranges?: string;
}

export interface PdfInfo {
  ok: boolean;
  error?: string;
  pageCount: number;
}

export interface AddPageNumbersResult {
  ok: boolean;
  error?: string;
  /** Set when part of the label could not be drawn with a built-in font. */
  warning?: string;
  bytes: Uint8Array;
  pageCount: number;
  numberedCount: number;
  /** What was stamped on the first numbered page, for a confirmation line in the UI. */
  firstLabel: string;
  /** What was stamped on the last numbered page. */
  lastLabel: string;
  sizeBytes: number;
}

const DEFAULTS = {
  format: "{n}",
  startNumber: 1,
  style: "arabic" as NumberStyle,
  position: "bottom-center" as NumberPosition,
  font: "helvetica" as NumberFont,
  fontSize: 11,
  margin: 36,
};

const BASE_FONTS: Record<NumberFont, string> = {
  helvetica: "Helvetica",
  "helvetica-bold": "Helvetica-Bold",
  times: "Times-Roman",
  "times-bold": "Times-Bold",
  courier: "Courier",
};

/** Resource name for the stamp font. Deliberately odd so it cannot collide with the page's own. */
const FONT_RESOURCE = "PageNumberFont";

/* ------------------------------------------------------------------ *
 * Number formatting
 * ------------------------------------------------------------------ */

const ROMAN: Array<[number, string]> = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

function toRoman(value: number): string {
  // Roman numerals have no zero and get silly past 3999, so fall back to digits outside that.
  if (value < 1 || value > 3999) return String(value);
  let left = value;
  let out = "";
  for (const [weight, glyphs] of ROMAN) {
    while (left >= weight) {
      out += glyphs;
      left -= weight;
    }
  }
  return out;
}

/** Spreadsheet-column lettering: a…z, then aa, ab, and so on. */
function toAlpha(value: number): string {
  if (value < 1) return String(value);
  let left = value;
  let out = "";
  while (left > 0) {
    const rem = (left - 1) % 26;
    out = String.fromCharCode(97 + rem) + out;
    left = Math.floor((left - 1) / 26);
  }
  return out;
}

function renderNumber(value: number, style: NumberStyle): string {
  switch (style) {
    case "roman-lower":
      return toRoman(value);
    case "roman-upper":
      return toRoman(value).toUpperCase();
    case "alpha-lower":
      return toAlpha(value);
    case "alpha-upper":
      return toAlpha(value).toUpperCase();
    default:
      return String(value);
  }
}

/**
 * Fills `{n}` and `{total}` in the template. Anything else in the template is kept verbatim,
 * which is what lets people write "Page 3 of 12", "3 / 12", "— 3 —", or a section prefix.
 */
function fillTemplate(format: string, value: string, total: string): string {
  return format.replace(/\{n\}/g, value).replace(/\{total\}/g, total);
}

/** The label this configuration stamps on the nth numbered page (0-based). For UI previews. */
export function pageNumberLabel(
  options: PageNumberOptions,
  offset: number,
  numberedCount: number,
): string {
  const start = normalizeStart(options.startNumber);
  const style = options.style ?? DEFAULTS.style;
  const format = options.format ?? DEFAULTS.format;
  const total = renderNumber(start + Math.max(1, numberedCount) - 1, style);
  return sanitizeWinAnsi(fillTemplate(format, renderNumber(start + offset, style), total)).text;
}

function normalizeStart(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULTS.startNumber;
  return Math.max(0, Math.min(99999, Math.round(value)));
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/* ------------------------------------------------------------------ *
 * Stamp placement
 * ------------------------------------------------------------------ */

function stampContent(
  label: string,
  options: Required<Pick<PageNumberOptions, "position" | "font" | "fontSize" | "margin">>,
  rotation: number,
  box: { x0: number; y0: number; width: number; height: number },
): string {
  const { matrix, viewWidth, viewHeight } = viewTransform(rotation, box);
  const { fontSize, margin, position, font } = options;
  const width = standardTextWidth(label, BASE_FONTS[font], fontSize);

  let x: number;
  if (position.endsWith("-left")) x = margin;
  else if (position.endsWith("-right")) x = viewWidth - margin - width;
  else x = (viewWidth - width) / 2;

  // A tall type size at the top edge would otherwise sit with its ascenders off the paper.
  const y = position.startsWith("top-") ? viewHeight - margin - fontSize : margin;

  const clampedX = Math.max(0, Math.min(x, Math.max(0, viewWidth - width)));
  const clampedY = Math.max(0, Math.min(y, Math.max(0, viewHeight - fontSize)));

  return [
    "q",
    `${matrix.map(fmt).join(" ")} cm`,
    "BT",
    `/${FONT_RESOURCE} ${fmt(fontSize)} Tf`,
    "0 g",
    `${fmt(clampedX)} ${fmt(clampedY)} Td`,
    `<${winAnsiHex(label)}> Tj`,
    "ET",
    "Q",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/** Reads a single PDF and reports how many pages it has. */
export async function readPdfInfo(data: Uint8Array, inflate: PdfInflate): Promise<PdfInfo> {
  if (!data || data.length === 0) return { ok: false, error: "empty file", pageCount: 0 };

  try {
    const { doc, error } = await parseDocument(data, inflate);
    if (!doc) return { ok: false, error: error ?? "could not read this PDF", pageCount: 0 };
    return { ok: true, pageCount: doc.pages.length };
  } catch {
    return { ok: false, error: "could not read this PDF", pageCount: 0 };
  }
}

/**
 * Stamps page numbers onto a PDF and returns the new file. Pages outside the selection are
 * copied through untouched. Bookmarks, annotations on the page tree, and form fields are not
 * carried over — the output is a clean document containing the same pages plus the numbers.
 */
export async function addPageNumbers(
  data: Uint8Array,
  options: PageNumberOptions,
  inflate: PdfInflate,
): Promise<AddPageNumbersResult> {
  const empty: AddPageNumbersResult = {
    ok: false,
    bytes: new Uint8Array(0),
    pageCount: 0,
    numberedCount: 0,
    firstLabel: "",
    lastLabel: "",
    sizeBytes: 0,
  };

  if (!data || data.length === 0) return { ...empty, error: "add a PDF first" };

  const style = options.style ?? DEFAULTS.style;
  const format = (options.format ?? DEFAULTS.format).slice(0, 80);
  const start = normalizeStart(options.startNumber);
  const placement = {
    position: options.position ?? DEFAULTS.position,
    font: options.font ?? DEFAULTS.font,
    fontSize: clamp(options.fontSize, DEFAULTS.fontSize, 4, 72),
    margin: clamp(options.margin, DEFAULTS.margin, 0, 200),
  };

  if (!format.includes("{n}")) {
    return { ...empty, error: "the format needs {n} somewhere — that is the page number" };
  }

  let parsed: { doc: PdfDocument | null; error?: string };
  try {
    parsed = await parseDocument(data, inflate);
  } catch {
    parsed = { doc: null, error: "could not read this PDF" };
  }
  if (!parsed.doc) return { ...empty, error: parsed.error ?? "could not read this PDF" };

  const doc = parsed.doc;
  const pageCount = doc.pages.length;

  let targets: number[];
  const spec = (options.ranges ?? "").trim();
  if (spec) {
    const ranges = parsePageRanges(spec, pageCount);
    if (!ranges.ok) return { ...empty, error: ranges.error, pageCount };
    targets = ranges.pages;
  } else {
    targets = Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  // Numbers advance with the physical page, not with the selection, so skipping a cover page
  // leaves the body reading 1, 2, 3 instead of jumping.
  const firstPage = targets[0];
  const lastPage = targets[targets.length - 1];
  const totalLabel = renderNumber(start + (lastPage - firstPage), style);

  const wanted = new Map<number, string>();
  let dropped = false;
  for (const page of targets) {
    const raw = fillTemplate(format, renderNumber(start + (page - firstPage), style), totalLabel);
    const clean = sanitizeWinAnsi(raw);
    if (clean.dropped) dropped = true;
    if (clean.text.trim()) wanted.set(page, clean.text);
  }

  if (wanted.size === 0) {
    return {
      ...empty,
      pageCount,
      error: dropped
        ? "the built-in PDF fonts have no glyphs for those characters — use Latin letters and digits"
        : "the format is empty once trimmed",
    };
  }

  const selections: PageSelection[] = doc.pages.map((page, i) => {
    const label = wanted.get(i + 1);
    if (label === undefined) return { index: i };
    const content = stampContent(label, placement, pageRotation(page), pageBox(doc, page));
    return {
      index: i,
      overlay: { content, fonts: [{ name: FONT_RESOURCE, baseFont: BASE_FONTS[placement.font] }] },
    };
  });

  let bytes: Uint8Array;
  try {
    bytes = buildPdf(doc, selections);
  } catch {
    return { ...empty, pageCount, error: "numbering failed — the file may be malformed" };
  }

  return {
    ok: true,
    bytes,
    pageCount,
    numberedCount: wanted.size,
    firstLabel: wanted.get(firstPage) ?? "",
    lastLabel: wanted.get(lastPage) ?? "",
    sizeBytes: bytes.length,
    warning: dropped
      ? "some characters were skipped — the built-in PDF fonts only cover the Latin alphabet"
      : undefined,
  };
}

function clamp(value: number | undefined, fallback: number, lo: number, hi: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(lo, Math.min(hi, value));
}
