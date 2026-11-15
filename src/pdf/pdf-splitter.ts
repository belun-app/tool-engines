/**
 * Client-side PDF splitter.
 *
 * Reads a single PDF and writes one or more new PDFs from chosen pages, entirely in the
 * browser. Three modes:
 *   - "extract": pull a set of pages ("1-3, 7") into a single new PDF.
 *   - "each":    one output PDF per page.
 *   - "every":   fixed-size chunks of N pages each.
 *
 * All parsing and writing is delegated to the shared PDF core, so page content, size, and
 * rotation are preserved byte-for-byte. Nothing is uploaded.
 */

import {
  type PdfDocument,
  type PdfInflate,
  buildPdf,
  buildZip,
  formatFileSize,
  parseDocument,
  parsePageRanges,
} from "./_pdf-lib.js";

export type { PdfInflate } from "./_pdf-lib.js";
export { formatFileSize, parsePageRanges, buildZip } from "./_pdf-lib.js";

export interface PdfInfo {
  ok: boolean;
  error?: string;
  pageCount: number;
}

export type SplitMode = "extract" | "each" | "every";

export interface SplitOptions {
  mode: SplitMode;
  /** "extract" mode: which pages to pull, e.g. "1-3, 7". */
  ranges?: string;
  /** "every" mode: pages per output file. */
  everyN?: number;
  /** Base file name (without extension) used to name the outputs. */
  baseName?: string;
}

export interface SplitOutputFile {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  sizeBytes: number;
}

export interface PdfSplitResult {
  ok: boolean;
  error?: string;
  files: SplitOutputFile[];
  totalPages: number;
}

function sanitizeBaseName(name: string | undefined): string {
  const stripped = (name ?? "").replace(/\.pdf$/i, "").trim();
  // letters of any script (Cyrillic file names stay readable), digits, _ - .
  const cleaned = stripped.replace(/[^\p{L}\p{M}\p{N}_\-.]+/gu, "_").replace(/_{2,}/g, "_");
  return cleaned || "document";
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

/** Turns the chosen mode into a list of page-number groups (each group becomes one file). */
function planGroups(
  doc: PdfDocument,
  options: SplitOptions,
): { ok: boolean; error?: string; groups: number[][] } {
  const pageCount = doc.pages.length;

  if (options.mode === "extract") {
    const parsed = parsePageRanges(options.ranges ?? "", pageCount);
    if (!parsed.ok) return { ok: false, error: parsed.error, groups: [] };
    return { ok: true, groups: [parsed.pages] };
  }

  if (options.mode === "each") {
    const groups: number[][] = [];
    for (let p = 1; p <= pageCount; p++) groups.push([p]);
    return { ok: true, groups };
  }

  // "every"
  const n = Math.floor(options.everyN ?? 0);
  if (!Number.isFinite(n) || n < 1) {
    return { ok: false, error: "enter how many pages per file (1 or more)", groups: [] };
  }
  const groups: number[][] = [];
  for (let start = 1; start <= pageCount; start += n) {
    const group: number[] = [];
    for (let p = start; p < start + n && p <= pageCount; p++) group.push(p);
    groups.push(group);
  }
  return { ok: true, groups };
}

function nameForGroup(
  base: string,
  mode: SplitMode,
  group: number[],
  index: number,
  total: number,
): string {
  if (mode === "each") return `${base}-page-${group[0]}.pdf`;
  if (mode === "extract") {
    const label = group.length === 1 ? `page-${group[0]}` : "pages";
    return `${base}-${label}.pdf`;
  }
  const pad = String(total).length;
  const first = group[0];
  const last = group[group.length - 1];
  const span = first === last ? `${first}` : `${first}-${last}`;
  return `${base}-part-${String(index + 1).padStart(pad, "0")}_${span}.pdf`;
}

/**
 * Splits a PDF according to the given options. Returns one output file per group. Pages keep
 * their original size, rotation, and content; bookmarks and form fields are not carried over.
 */
export async function splitPdf(
  data: Uint8Array,
  options: SplitOptions,
  inflate: PdfInflate,
): Promise<PdfSplitResult> {
  const empty: PdfSplitResult = { ok: false, files: [], totalPages: 0 };

  if (!data || data.length === 0) return { ...empty, error: "add a PDF first" };

  let parsed: { doc: PdfDocument | null; error?: string };
  try {
    parsed = await parseDocument(data, inflate);
  } catch {
    parsed = { doc: null, error: "could not read this PDF" };
  }
  if (!parsed.doc) return { ...empty, error: parsed.error ?? "could not read this PDF" };

  const doc = parsed.doc;
  const plan = planGroups(doc, options);
  if (!plan.ok) return { ...empty, error: plan.error };
  if (plan.groups.length === 0) return { ...empty, error: "nothing to split" };

  const base = sanitizeBaseName(options.baseName);
  const files: SplitOutputFile[] = [];
  let totalPages = 0;

  plan.groups.forEach((group, index) => {
    const selections = group.map((p) => ({ index: p - 1 }));
    const bytes = buildPdf(doc, selections);
    files.push({
      name: nameForGroup(base, options.mode, group, index, plan.groups.length),
      bytes,
      pageCount: group.length,
      sizeBytes: bytes.length,
    });
    totalPages += group.length;
  });

  return { ok: true, files, totalPages };
}

/** Bundles multiple output PDFs into a single ZIP for a one-click download. */
export function zipPdfFiles(files: SplitOutputFile[], zipName: string): Uint8Array {
  void zipName;
  return buildZip(files.map((f) => ({ name: f.name, data: f.bytes })));
}
