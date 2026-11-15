/**
 * Client-side PDF signer.
 *
 * Stamps a signature — either ink drawn with a mouse, trackpad, or finger, or a name set in one
 * of the fonts every PDF reader already has — onto a chosen page of a PDF and writes a new file.
 * Everything runs through the shared PDF core (_pdf-lib), so the document is parsed, stamped, and
 * rebuilt in the browser and never leaves the tab.
 *
 * Drawn ink is emitted as real vector paths, not a pasted bitmap. The pad's quadratic smoothing
 * is converted to the cubic curves PDF speaks, so the signature stays crisp at 400% zoom and in
 * print, and adds a couple of kilobytes rather than a couple of hundred. A typed name is drawn as
 * text in a built-in font, which keeps it selectable and searchable.
 *
 * Placement is expressed as fractions of the page as a reader sees it, and pages carrying a
 * /Rotate flag get a matching transform — so a signature dropped on the bottom right of a
 * sideways-scanned contract lands on the bottom right, not along an edge.
 *
 * This stamps visible ink, which is what people mean when they say "sign a PDF" and what a
 * counterparty expects to see. It is not a cryptographic signature: nothing here certifies who
 * signed or detects a later edit.
 */

import {
  type PageSelection,
  type PdfDocument,
  type PdfInflate,
  buildPdf,
  pageBox,
  pageRotation,
  parseDocument,
  sanitizeWinAnsi,
  standardTextWidth,
  viewTransform,
  winAnsiHex,
} from "./_pdf-lib.js";

export type { PdfInflate } from "./_pdf-lib.js";
export { formatFileSize } from "./_pdf-lib.js";

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

export type SignatureMode = "draw" | "type";

export type SignatureFont =
  | "times-italic"
  | "times-bolditalic"
  | "helvetica-oblique"
  | "helvetica"
  | "courier";

export interface InkPoint {
  x: number;
  y: number;
}

/** One pen-down-to-pen-up trail, in pad pixels with y pointing down. */
export interface InkStroke {
  points: InkPoint[];
  /** Pen width in pad pixels. Scaled along with the ink when the stamp is resized. */
  width: number;
}

export interface SignaturePlacement {
  /** Left edge of the stamp as a fraction of the visible page width. */
  x: number;
  /** Top edge of the stamp as a fraction of the visible page height. */
  y: number;
  /** Stamp width as a fraction of the visible page width. Clamped to 0.03–1. */
  width: number;
}

export interface SignPdfOptions {
  mode: SignatureMode;
  /** Drawn ink. Used when `mode` is "draw". */
  strokes?: InkStroke[];
  /** Typed name. Used when `mode` is "type". Latin-1 only. */
  text?: string;
  font?: SignatureFont;
  /** Ink colour as #rrggbb. Defaults to a blue-black fountain-pen ink. */
  color?: string;
  placement: SignaturePlacement;
  /** 1-based page that gets the signature. Out-of-range values are clamped. */
  page: number;
  /** Stamp the same signature in the same spot on every page. */
  everyPage?: boolean;
}

export interface SignPdfResult {
  ok: boolean;
  error?: string;
  /** Set when part of a typed name could not be drawn with a built-in font. */
  warning?: string;
  bytes: Uint8Array;
  pageCount: number;
  signedCount: number;
  sizeBytes: number;
}

export interface InkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  empty: boolean;
}

export interface StampGeometry {
  /** Distance from the left edge of the visible page, in the same units as `viewWidth`. */
  left: number;
  /** Distance from the top edge of the visible page. */
  top: number;
  width: number;
  height: number;
}

const BASE_FONTS: Record<SignatureFont, string> = {
  "times-italic": "Times-Italic",
  "times-bolditalic": "Times-BoldItalic",
  "helvetica-oblique": "Helvetica-Oblique",
  helvetica: "Helvetica",
  courier: "Courier",
};

/** Resource name for the signature font. Deliberately odd so it cannot collide with the page's. */
const FONT_RESOURCE = "SignatureFont";

/** Where the baseline sits inside a one-em tall box, leaving room for descenders. */
const BASELINE_FROM_TOP = 0.78;

/** Blue-black fountain-pen ink (#16213e), used when the colour cannot be parsed. */
const DEFAULT_INK: [number, number, number] = [0.086, 0.129, 0.243];
const MIN_WIDTH_FRAC = 0.03;
const MAX_TEXT_LENGTH = 60;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function clamp(value: number | undefined, lo: number, hi: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(lo, Math.min(hi, value));
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Splits #rgb or #rrggbb into the three 0–1 components a PDF colour operator wants. */
function parseColor(input: string | undefined): [number, number, number] {
  const hex = (input ?? "").trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return DEFAULT_INK;
  const n = Number.parseInt(full, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function isPoint(p: InkPoint | undefined): p is InkPoint {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Tightest box containing every stroke, grown by half the pen width so the round cap at the end
 * of a flourish sits inside the stamp rather than getting shaved off by it.
 */
export function inkBounds(strokes: InkStroke[] | undefined): InkBounds {
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
      minX = Math.min(minX, point.x - half);
      minY = Math.min(minY, point.y - half);
      maxX = Math.max(maxX, point.x + half);
      maxY = Math.max(maxY, point.y + half);
    }
  }

  if (!found) return { x: 0, y: 0, width: 0, height: 0, empty: true };
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    empty: false,
  };
}

/** Trims a typed name to what the built-in fonts can draw, and reports what was dropped. */
export function cleanSignatureText(text: string | undefined): { text: string; dropped: boolean } {
  const clean = sanitizeWinAnsi((text ?? "").slice(0, MAX_TEXT_LENGTH));
  return { text: clean.text.replace(/\s+/g, " ").trim(), dropped: clean.dropped };
}

/** True when there is something to stamp: ink on the pad, or a name that can be drawn. */
export function hasSignature(options: SignPdfOptions): boolean {
  if (options.mode === "type") return cleanSignatureText(options.text).text.length > 0;
  return !inkBounds(options.strokes).empty;
}

/**
 * Height of the stamp divided by its width. The mount uses this to size the draggable box over
 * the page preview, which is how the preview and the stamped file end up agreeing.
 */
export function signatureAspect(options: SignPdfOptions): number {
  if (options.mode === "type") {
    const { text } = cleanSignatureText(options.text);
    if (!text) return 0.25;
    const em = standardTextWidth(text, BASE_FONTS[options.font ?? "times-italic"], 1);
    return em > 0 ? 1 / em : 0.25;
  }
  const bounds = inkBounds(options.strokes);
  if (bounds.empty) return 0.4;
  return Math.max(0.02, Math.min(20, bounds.height / bounds.width));
}

/**
 * Where the stamp lands on a page of the given visible size. Keeps the box fully on the paper,
 * which is the difference between a signature on the line and one half off the edge.
 */
export function stampGeometry(
  options: SignPdfOptions,
  viewWidth: number,
  viewHeight: number,
): StampGeometry {
  const aspect = signatureAspect(options);
  let width = clamp(options.placement?.width, MIN_WIDTH_FRAC, 1, 0.3) * viewWidth;
  let height = width * aspect;
  if (height > viewHeight) {
    height = viewHeight;
    width = height / aspect;
  }

  const left = clamp(options.placement?.x, 0, 1, 0.55) * viewWidth;
  const top = clamp(options.placement?.y, 0, 1, 0.8) * viewHeight;
  return {
    left: Math.min(left, Math.max(0, viewWidth - width)),
    top: Math.min(top, Math.max(0, viewHeight - height)),
    width,
    height,
  };
}

/* ------------------------------------------------------------------ *
 * Content stream
 * ------------------------------------------------------------------ */

/**
 * Turns one pen trail into PDF path operators. The pad smooths a jittery mouse trail by running
 * quadratic curves through the midpoints between samples; PDF has no quadratic operator, so each
 * one is lifted to the equivalent cubic — the control points sit two thirds of the way from the
 * ends towards the quadratic's control point, which reproduces the curve exactly.
 */
function strokePath(points: InkPoint[]): string {
  const pts = points.filter(isPoint);
  if (pts.length === 0) return "";

  const ops: string[] = [`${fmt(pts[0].x)} ${fmt(pts[0].y)} m`];

  if (pts.length === 1) {
    // A single tap: a zero-length segment plus a round cap renders as a dot.
    ops.push(`${fmt(pts[0].x + 0.01)} ${fmt(pts[0].y)} l`);
    return ops.join("\n");
  }
  if (pts.length === 2) {
    ops.push(`${fmt(pts[1].x)} ${fmt(pts[1].y)} l`);
    return ops.join("\n");
  }

  let cur = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const ctrl = pts[i];
    const end = { x: (ctrl.x + pts[i + 1].x) / 2, y: (ctrl.y + pts[i + 1].y) / 2 };
    const c1x = cur.x + (2 / 3) * (ctrl.x - cur.x);
    const c1y = cur.y + (2 / 3) * (ctrl.y - cur.y);
    const c2x = end.x + (2 / 3) * (ctrl.x - end.x);
    const c2y = end.y + (2 / 3) * (ctrl.y - end.y);
    ops.push(`${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(end.x)} ${fmt(end.y)} c`);
    cur = end;
  }
  const last = pts[pts.length - 1];
  ops.push(`${fmt(last.x)} ${fmt(last.y)} l`);
  return ops.join("\n");
}

function drawnContent(
  options: SignPdfOptions,
  geometry: StampGeometry,
  viewHeight: number,
  matrix: number[],
): string {
  const bounds = inkBounds(options.strokes);
  if (bounds.empty) return "";

  const scale = geometry.width / bounds.width;
  const originX = geometry.left;
  // View space counts up from the bottom of the page; the pad counts down from its own top.
  const originY = viewHeight - geometry.top;
  const toView = (p: InkPoint): InkPoint => ({
    x: originX + (p.x - bounds.x) * scale,
    y: originY - (p.y - bounds.y) * scale,
  });

  const [r, g, b] = parseColor(options.color);
  const ops = [
    "q",
    `${matrix.map(fmt).join(" ")} cm`,
    "1 J 1 j",
    `${fmt(r)} ${fmt(g)} ${fmt(b)} RG`,
  ];

  for (const stroke of options.strokes ?? []) {
    const path = strokePath((stroke?.points ?? []).map(toView));
    if (!path) continue;
    const pen = Math.max(0.2, (Number.isFinite(stroke.width) ? stroke.width : 2) * scale);
    ops.push(`${fmt(pen)} w`, path, "S");
  }

  ops.push("Q", "");
  return ops.join("\n");
}

function typedContent(
  text: string,
  options: SignPdfOptions,
  geometry: StampGeometry,
  viewHeight: number,
  matrix: number[],
): string {
  const baseFont = BASE_FONTS[options.font ?? "times-italic"];
  const em = standardTextWidth(text, baseFont, 1);
  const size = em > 0 ? geometry.width / em : geometry.height;
  const x = geometry.left;
  const y = viewHeight - geometry.top - size * BASELINE_FROM_TOP;

  const [r, g, b] = parseColor(options.color);
  return [
    "q",
    `${matrix.map(fmt).join(" ")} cm`,
    "BT",
    `/${FONT_RESOURCE} ${fmt(size)} Tf`,
    `${fmt(r)} ${fmt(g)} ${fmt(b)} rg`,
    `${fmt(x)} ${fmt(y)} Td`,
    `<${winAnsiHex(text)}> Tj`,
    "ET",
    "Q",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export interface PdfInfo {
  ok: boolean;
  error?: string;
  pageCount: number;
}

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
 * Stamps the signature onto the chosen page (or every page) and returns the new file. Pages that
 * are not signed are copied through untouched. Bookmarks, existing annotations, and form fields
 * are not carried over — the output holds the same pages plus the signature.
 */
export async function signPdf(
  data: Uint8Array,
  options: SignPdfOptions,
  inflate: PdfInflate,
): Promise<SignPdfResult> {
  const empty: SignPdfResult = {
    ok: false,
    bytes: new Uint8Array(0),
    pageCount: 0,
    signedCount: 0,
    sizeBytes: 0,
  };

  if (!data || data.length === 0) return { ...empty, error: "add a PDF first" };

  const typed = cleanSignatureText(options.text);
  if (options.mode === "type" && !typed.text) {
    return {
      ...empty,
      error: typed.dropped
        ? "the built-in PDF fonts have no glyphs for those characters — type a Latin name, or draw the signature instead"
        : "type a name to sign with",
    };
  }
  if (options.mode === "draw" && inkBounds(options.strokes).empty) {
    return { ...empty, error: "draw a signature on the pad first" };
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
  const target = Math.round(clamp(options.page, 1, pageCount, 1));

  const selections: PageSelection[] = doc.pages.map((page, i) => {
    if (!options.everyPage && i + 1 !== target) return { index: i };

    const { matrix, viewWidth, viewHeight } = viewTransform(pageRotation(page), pageBox(doc, page));
    const geometry = stampGeometry(options, viewWidth, viewHeight);
    const content =
      options.mode === "type"
        ? typedContent(typed.text, options, geometry, viewHeight, matrix)
        : drawnContent(options, geometry, viewHeight, matrix);
    if (!content) return { index: i };

    return {
      index: i,
      overlay: {
        content,
        fonts:
          options.mode === "type"
            ? [{ name: FONT_RESOURCE, baseFont: BASE_FONTS[options.font ?? "times-italic"] }]
            : undefined,
      },
    };
  });

  let bytes: Uint8Array;
  try {
    bytes = buildPdf(doc, selections);
  } catch {
    return { ...empty, pageCount, error: "signing failed — the file may be malformed" };
  }

  return {
    ok: true,
    bytes,
    pageCount,
    signedCount: options.everyPage ? pageCount : 1,
    sizeBytes: bytes.length,
    warning:
      options.mode === "type" && typed.dropped
        ? "some characters were skipped — the built-in PDF fonts only cover the Latin alphabet"
        : undefined,
  };
}
