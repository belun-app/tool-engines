/**
 * Client-side PDF page remover.
 *
 * Reads a single PDF and writes a new one with the chosen pages left out. The kept pages are
 * copied through the shared PDF core, so their content streams, size, and rotation survive
 * byte-for-byte — nothing is re-rendered or re-compressed. The inverse of the PDF Splitter's
 * extract mode: there you name the pages you want, here you name the ones you don't.
 *
 * Beyond a free-form range like "2, 5-7", the engine can turn a preset ("odd", "even") into a
 * page list, which is what makes removing the blank backs of a duplex scan a two-click job.
 *
 * Nothing is uploaded.
 */

import {
  type PdfDocument,
  type PdfInflate,
  buildPdf,
  formatFileSize,
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

/** Quick selections offered next to the free-form range box. */
export type PagePreset = "all" | "none" | "odd" | "even";

export interface DeletionPlan {
  ok: boolean;
  error?: string;
  /** 1-based page numbers that will be dropped. */
  deleted: number[];
  /** 1-based page numbers that will survive, in their original order. */
  kept: number[];
}

export interface DeleteOptions {
  /** Which pages to remove, e.g. "2, 5-7". Open-ended forms like "10-" are accepted. */
  pages: string;
  /** Base file name (without extension) used to name the output. */
  baseName?: string;
}

export interface PdfDeleteResult {
  ok: boolean;
  error?: string;
  bytes: Uint8Array;
  name: string;
  /** How many pages the source PDF had. */
  originalPages: number;
  deletedCount: number;
  keptCount: number;
  sizeBytes: number;
}

const EMPTY_RESULT: PdfDeleteResult = {
  ok: false,
  bytes: new Uint8Array(0),
  name: "",
  originalPages: 0,
  deletedCount: 0,
  keptCount: 0,
  sizeBytes: 0,
};

function sanitizeBaseName(name: string | undefined): string {
  const stripped = (name ?? "").replace(/\.pdf$/i, "").trim();
  // letters of any script (Cyrillic file names stay readable), digits, _ - .
  const cleaned = stripped.replace(/[^\p{L}\p{M}\p{N}_\-.]+/gu, "_").replace(/_{2,}/g, "_");
  return cleaned || "document";
}

/** Expands a preset into the 1-based page numbers it covers. */
export function presetPages(preset: PagePreset, pageCount: number): number[] {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return [];

  const pages: number[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (preset === "all") pages.push(p);
    else if (preset === "odd" && p % 2 === 1) pages.push(p);
    else if (preset === "even" && p % 2 === 0) pages.push(p);
  }
  return pages;
}

/**
 * Compacts a list of page numbers back into the range syntax the input box uses:
 * [1, 2, 3, 7, 9, 10] becomes "1-3, 7, 9-10". Duplicates and disorder are tolerated.
 */
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages.filter((p) => Number.isFinite(p) && p >= 1))].sort(
    (a, b) => a - b,
  );
  if (sorted.length === 0) return "";

  const parts: string[] = [];
  let runStart = sorted[0];
  let previous = sorted[0];

  const flush = () => {
    parts.push(runStart === previous ? `${runStart}` : `${runStart}-${previous}`);
  };

  for (let i = 1; i < sorted.length; i++) {
    const page = sorted[i];
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    flush();
    runStart = page;
    previous = page;
  }
  flush();

  return parts.join(", ");
}

/**
 * Works out which pages go and which stay, without touching the file. The UI calls this on
 * every keystroke to show a live "12 pages → 9 pages" preview and to catch the one mistake
 * that matters: asking for an empty document.
 */
export function planDeletion(spec: string, pageCount: number): DeletionPlan {
  if (!Number.isFinite(pageCount) || pageCount <= 0) {
    return { ok: false, error: "the PDF has no pages", deleted: [], kept: [] };
  }

  if (!spec.trim()) {
    return { ok: false, error: "enter which pages to remove", deleted: [], kept: [] };
  }

  const parsed = parsePageRanges(spec, pageCount);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, deleted: [], kept: [] };
  }

  const drop = new Set(parsed.pages);
  const kept: number[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (!drop.has(p)) kept.push(p);
  }

  if (kept.length === 0) {
    return {
      ok: false,
      error: "that removes every page — leave at least one in the document",
      deleted: parsed.pages,
      kept: [],
    };
  }

  return { ok: true, deleted: parsed.pages, kept };
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
 * Removes the requested pages and returns the rebuilt PDF. Surviving pages keep their content,
 * dimensions, and rotation; document-level extras such as bookmarks and form fields are not
 * carried over, because their targets can no longer be trusted to exist.
 */
export async function deletePdfPages(
  data: Uint8Array,
  options: DeleteOptions,
  inflate: PdfInflate,
): Promise<PdfDeleteResult> {
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
  const plan = planDeletion(options.pages ?? "", pageCount);
  if (!plan.ok) return { ...EMPTY_RESULT, originalPages: pageCount, error: plan.error };

  const bytes = buildPdf(
    doc,
    plan.kept.map((p) => ({ index: p - 1 })),
  );

  return {
    ok: true,
    bytes,
    name: `${sanitizeBaseName(options.baseName)}-pages-removed.pdf`,
    originalPages: pageCount,
    deletedCount: plan.deleted.length,
    keptCount: plan.kept.length,
    sizeBytes: bytes.length,
  };
}
