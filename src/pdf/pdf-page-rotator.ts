/**
 * Client-side PDF page rotator.
 *
 * Reads a single PDF and writes a new one with chosen pages rotated by 90°, 180°, or 270°.
 * Rotation is applied by adjusting each page's /Rotate value — the page content is never
 * re-rendered — so nothing loses quality and the output stays small. Leave the page selection
 * empty to rotate the whole document, or pass a range like "2, 4-6" to rotate only those pages.
 *
 * All parsing and writing is delegated to the shared PDF core. Nothing is uploaded.
 */

import {
  type PageSelection,
  type PdfDocument,
  type PdfInflate,
  buildPdf,
  formatFileSize,
  normalizeAngle,
  pageRotation,
  parseDocument,
  parsePageRanges,
} from "./_pdf-lib.js";

export type { PdfInflate } from "./_pdf-lib.js";
export { formatFileSize, parsePageRanges } from "./_pdf-lib.js";

export interface PdfInfo {
  ok: boolean;
  error?: string;
  pageCount: number;
}

export interface RotateOptions {
  /** Degrees to add clockwise: 90, 180, or 270. */
  angle: number;
  /** Which pages to rotate, e.g. "2, 4-6". Empty/omitted means every page. */
  ranges?: string;
}

export interface PdfRotateResult {
  ok: boolean;
  error?: string;
  bytes: Uint8Array;
  pageCount: number;
  rotatedCount: number;
  sizeBytes: number;
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
 * Rotates the chosen pages of a PDF and returns the new file. Pages that are not selected keep
 * their original orientation, content, and size. Bookmarks and form fields are not carried over.
 */
export async function rotatePdf(
  data: Uint8Array,
  options: RotateOptions,
  inflate: PdfInflate,
): Promise<PdfRotateResult> {
  const empty: PdfRotateResult = {
    ok: false,
    bytes: new Uint8Array(0),
    pageCount: 0,
    rotatedCount: 0,
    sizeBytes: 0,
  };

  if (!data || data.length === 0) return { ...empty, error: "add a PDF first" };

  const angle = normalizeAngle(options.angle);
  if (angle === 0) return { ...empty, error: "choose a rotation of 90°, 180°, or 270°" };

  let parsed: { doc: PdfDocument | null; error?: string };
  try {
    parsed = await parseDocument(data, inflate);
  } catch {
    parsed = { doc: null, error: "could not read this PDF" };
  }
  if (!parsed.doc) return { ...empty, error: parsed.error ?? "could not read this PDF" };

  const doc = parsed.doc;
  const pageCount = doc.pages.length;

  // Decide which pages to rotate. Empty selection rotates everything.
  let targets: Set<number>;
  const spec = (options.ranges ?? "").trim();
  if (spec) {
    const parsedRanges = parsePageRanges(spec, pageCount);
    if (!parsedRanges.ok) return { ...empty, error: parsedRanges.error };
    targets = new Set(parsedRanges.pages);
  } else {
    targets = new Set(Array.from({ length: pageCount }, (_, i) => i + 1));
  }

  const selections: PageSelection[] = doc.pages.map((page, i) => {
    if (targets.has(i + 1)) {
      return { index: i, rotate: normalizeAngle(pageRotation(page) + angle) };
    }
    return { index: i };
  });

  let bytes: Uint8Array;
  try {
    bytes = buildPdf(doc, selections);
  } catch {
    return { ...empty, error: "rotation failed — the file may be malformed" };
  }

  return {
    ok: true,
    bytes,
    pageCount,
    rotatedCount: targets.size,
    sizeBytes: bytes.length,
  };
}
