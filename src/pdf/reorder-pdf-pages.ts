/**
 * Client-side PDF page reordering.
 *
 * Reads a single PDF and writes a new one whose pages appear in whatever order the caller asks
 * for. The order is just a list of 1-based source page numbers, so the same primitive covers
 * every case: moving one page, reversing the document, interleaving two halves of a duplex scan,
 * duplicating a page, or dropping one by leaving it out.
 *
 * Pages are copied through the shared PDF core, so content streams, page size, and rotation
 * survive byte-for-byte — nothing is re-rendered or re-compressed. Nothing is uploaded.
 */

import {
  type PdfDocument,
  type PdfInflate,
  buildPdf,
  formatFileSize,
  parseDocument,
} from "./_pdf-lib.js";

export type { PdfInflate, PdfDocument } from "./_pdf-lib.js";
export { formatFileSize } from "./_pdf-lib.js";

export interface PdfInfo {
  ok: boolean;
  error?: string;
  pageCount: number;
}

export interface OrderParse {
  ok: boolean;
  error?: string;
  /** 1-based source page numbers, in output order. */
  order: number[];
  /** Source pages that the order never mentions — they will not be in the output. */
  omitted: number[];
  /** Source pages that the order mentions more than once. */
  duplicated: number[];
}

export interface ReorderOptions {
  /** 1-based source page numbers in output order, e.g. [3, 1, 2]. */
  order: number[];
  /** Base file name (without extension) used to name the output. */
  baseName?: string;
}

export interface PdfReorderResult {
  ok: boolean;
  error?: string;
  bytes: Uint8Array;
  name: string;
  /** How many pages the source PDF had. */
  originalPages: number;
  /** How many pages the output has. */
  outputPages: number;
  /** True when the output order is identical to the input order. */
  unchanged: boolean;
  sizeBytes: number;
}

const EMPTY_RESULT: PdfReorderResult = {
  ok: false,
  bytes: new Uint8Array(0),
  name: "",
  originalPages: 0,
  outputPages: 0,
  unchanged: true,
  sizeBytes: 0,
};

function sanitizeBaseName(name: string | undefined): string {
  const stripped = (name ?? "").replace(/\.pdf$/i, "").trim();
  // letters of any script (Cyrillic file names stay readable), digits, _ - .
  const cleaned = stripped.replace(/[^\p{L}\p{M}\p{N}_\-.]+/gu, "_").replace(/_{2,}/g, "_");
  return cleaned || "document";
}

/** The untouched order: 1, 2, 3, … n. */
export function identityOrder(pageCount: number): number[] {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return [];
  return Array.from({ length: Math.floor(pageCount) }, (_, i) => i + 1);
}

/** Last page first — what you want after scanning a stack that came out upside down. */
export function reverseOrder(pageCount: number): number[] {
  return identityOrder(pageCount).reverse();
}

/**
 * Interleaves the two halves of a document that was scanned one side at a time: all the fronts
 * first, then all the backs. For 6 pages that gives 1, 4, 2, 5, 3, 6.
 *
 * `backsReversed` handles the common follow-up mistake — flipping the whole stack over before
 * feeding it back in, which puts the backs in descending order. Then 6 pages become
 * 1, 6, 2, 5, 3, 4.
 *
 * An odd page count means the halves are uneven; the extra page stays at the end rather than
 * being dropped, which is what happens when the last sheet is single-sided.
 */
export function interleaveHalvesOrder(pageCount: number, backsReversed = false): number[] {
  const total = Math.floor(pageCount);
  if (!Number.isFinite(total) || total <= 1) return identityOrder(total);

  const half = Math.ceil(total / 2);
  const fronts = identityOrder(total).slice(0, half);
  const backs = identityOrder(total).slice(half);
  if (backsReversed) backs.reverse();

  const out: number[] = [];
  for (let i = 0; i < fronts.length; i++) {
    out.push(fronts[i]);
    if (i < backs.length) out.push(backs[i]);
  }
  return out;
}

/**
 * Rotates the page list so that `startPage` comes first and the pages before it wrap around to
 * the end. Useful when a scan starts mid-document, or when a cover sheet ended up in the middle.
 */
export function rotateOrder(pageCount: number, startPage: number): number[] {
  const pages = identityOrder(pageCount);
  if (pages.length === 0) return pages;
  const at = Math.floor(startPage) - 1;
  if (!Number.isFinite(at) || at <= 0 || at >= pages.length) return pages;
  return [...pages.slice(at), ...pages.slice(0, at)];
}

/**
 * Moves one entry of an order list to another position, shifting the rest along. Both arguments
 * are positions in the list (0-based), not page numbers — this is the operation behind dragging
 * a thumbnail from one slot to another.
 */
export function movePage(order: number[], from: number, to: number): number[] {
  if (from === to) return [...order];
  if (from < 0 || from >= order.length) return [...order];

  const out = [...order];
  const [page] = out.splice(from, 1);
  const target = Math.max(0, Math.min(out.length, to));
  out.splice(target, 0, page);
  return out;
}

/** Swaps two entries of an order list by position. */
export function swapPages(order: number[], a: number, b: number): number[] {
  const out = [...order];
  if (a < 0 || b < 0 || a >= out.length || b >= out.length) return out;
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

/**
 * Compacts an order list back into the text syntax the order box uses. Runs of consecutive
 * pages collapse in both directions, so [1, 2, 3, 9, 8, 7] becomes "1-3, 9-7".
 */
export function formatOrder(order: number[]): string {
  const pages = order.filter((p) => Number.isFinite(p) && p >= 1);
  if (pages.length === 0) return "";

  const parts: string[] = [];
  let start = pages[0];
  let previous = pages[0];
  let step = 0; // 0 = single page so far, +1 = ascending run, -1 = descending run

  const flush = () => {
    parts.push(step === 0 ? `${start}` : `${start}-${previous}`);
  };

  for (let i = 1; i < pages.length; i++) {
    const page = pages[i];
    const delta = page - previous;

    if ((step === 0 && (delta === 1 || delta === -1)) || (step !== 0 && delta === step)) {
      step = delta;
      previous = page;
      continue;
    }

    flush();
    start = page;
    previous = page;
    step = 0;
  }
  flush();

  return parts.join(", ");
}

/**
 * Reads an order written by hand: "3, 1, 2" or "4-6, 1-3" or "12-1" for a full reverse. Unlike
 * a page-range parser, order matters and duplicates are kept — repeating a page number copies
 * that page into the output twice, which is how you insert a separator sheet more than once.
 *
 * Pages the spec never names are reported in `omitted` rather than silently appended: leaving a
 * page out is a legitimate way to drop it, but the caller should be able to warn about it.
 */
export function parseOrder(spec: string, pageCount: number): OrderParse {
  const empty: OrderParse = { ok: false, order: [], omitted: [], duplicated: [] };

  if (!Number.isFinite(pageCount) || pageCount <= 0) {
    return { ...empty, error: "the PDF has no pages" };
  }

  const trimmed = spec.trim();
  if (!trimmed) return { ...empty, error: "enter a page order, e.g. 3, 1, 2" };

  const order: number[] = [];

  // "2 - 4" is one range: glue the hyphen to its numbers before splitting on spaces/commas
  const glued = trimmed.replace(/\s*([-–])\s*/g, "$1");

  for (const rawPart of glued.split(/[,\s]+/)) {
    const part = rawPart.trim();
    if (!part) continue;

    const range = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      const from = Number.parseInt(range[1], 10);
      const to = Number.parseInt(range[2], 10);
      for (const page of [from, to]) {
        if (page < 1 || page > pageCount) {
          return { ...empty, error: `page ${page} doesn't exist — this PDF has ${pageCount}` };
        }
      }
      const step = to >= from ? 1 : -1;
      for (let p = from; step > 0 ? p <= to : p >= to; p += step) order.push(p);
      continue;
    }

    if (/^\d+$/.test(part)) {
      const page = Number.parseInt(part, 10);
      if (page < 1 || page > pageCount) {
        return { ...empty, error: `page ${page} doesn't exist — this PDF has ${pageCount}` };
      }
      order.push(page);
      continue;
    }

    return { ...empty, error: `"${part}" is not a page number or range` };
  }

  if (order.length === 0) return { ...empty, error: "enter a page order, e.g. 3, 1, 2" };

  return { ok: true, ...describeOrder(order, pageCount) };
}

/** Reports which source pages an order list leaves out and which it repeats. */
export function describeOrder(
  order: number[],
  pageCount: number,
): { order: number[]; omitted: number[]; duplicated: number[] } {
  const counts = new Map<number, number>();
  for (const page of order) counts.set(page, (counts.get(page) ?? 0) + 1);

  const omitted: number[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (!counts.has(p)) omitted.push(p);
  }

  const duplicated = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([page]) => page)
    .sort((a, b) => a - b);

  return { order: [...order], omitted, duplicated };
}

/** True when the list is 1, 2, 3, … n with nothing moved, added, or dropped. */
export function isIdentityOrder(order: number[], pageCount: number): boolean {
  if (order.length !== pageCount) return false;
  return order.every((page, i) => page === i + 1);
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
 * Writes a new PDF with the pages in the requested order. Every page keeps its content,
 * dimensions, and rotation; document-level extras such as bookmarks and form fields are not
 * carried over, because their page references no longer point where they used to.
 */
export async function reorderPdfPages(
  data: Uint8Array,
  options: ReorderOptions,
  inflate: PdfInflate,
): Promise<PdfReorderResult> {
  if (!data || data.length === 0) return { ...EMPTY_RESULT, error: "add a PDF first" };

  let parsed: { doc: PdfDocument | null; error?: string };
  try {
    parsed = await parseDocument(data, inflate);
  } catch {
    parsed = { doc: null, error: "could not read this PDF" };
  }
  if (!parsed.doc) return { ...EMPTY_RESULT, error: parsed.error ?? "could not read this PDF" };

  const doc = parsed.doc;
  const pageCount = doc.pages.length;
  const order = (options.order ?? []).filter(
    (page) => Number.isInteger(page) && page >= 1 && page <= pageCount,
  );

  if (order.length === 0) {
    return { ...EMPTY_RESULT, originalPages: pageCount, error: "no pages left in the order" };
  }

  let bytes: Uint8Array;
  try {
    bytes = buildPdf(
      doc,
      order.map((page) => ({ index: page - 1 })),
    );
  } catch {
    return {
      ...EMPTY_RESULT,
      originalPages: pageCount,
      error: "reordering failed — the file may be malformed",
    };
  }

  return {
    ok: true,
    bytes,
    name: `${sanitizeBaseName(options.baseName)}-reordered.pdf`,
    originalPages: pageCount,
    outputPages: order.length,
    unchanged: isIdentityOrder(order, pageCount),
    sizeBytes: bytes.length,
  };
}
