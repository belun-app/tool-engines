/**
 * Client-side PDF compressor.
 *
 * The bulk of the weight in most oversized PDFs is embedded photographs, so this tool finds the
 * JPEG (DCTDecode) image XObjects, re-encodes them at a lower quality — and optionally at a
 * smaller pixel size — then rebuilds the document around the lighter images. Everything that is
 * not a re-compressible photo (text, vector graphics, fonts, line-art) is copied through
 * untouched, so pages keep their layout and stay selectable.
 *
 * The re-encode itself needs a real image decoder, so it is injected as a callback backed by the
 * browser's canvas — the same split the other PDF engines use for Flate inflation. Parsing and
 * writing are delegated to the shared PDF core; nothing is uploaded.
 */

import {
  type PVal,
  type PageSelection,
  type PdfDocument,
  type PdfInflate,
  buildPdf,
  formatFileSize,
  parseDocument,
} from "./_pdf-lib.js";

export type { PdfInflate } from "./_pdf-lib.js";
export { formatFileSize } from "./_pdf-lib.js";

type PDict = Extract<PVal, { k: "dict" }>;
type PStream = Extract<PVal, { k: "stream" }>;

/** A single re-encoded image, returned by the injected canvas recoder. */
export interface RecodedImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Decodes a JPEG, optionally shrinks it so the longest side is at most `maxDimension` pixels
 * (0 means keep the original resolution), and re-encodes it as a baseline RGB JPEG at the given
 * quality. Returns null when the image cannot be decoded. Implemented in the mount with canvas.
 */
export type ImageRecoder = (
  jpeg: Uint8Array,
  opts: { quality: number; maxDimension: number },
) => Promise<RecodedImage | null>;

export interface CompressOptions {
  /** JPEG quality, 0–1. Lower is smaller. */
  quality: number;
  /** Longest-side pixel cap for downsampling; 0 keeps the original resolution. */
  maxDimension: number;
}

export interface PdfCompressInfo {
  ok: boolean;
  error?: string;
  pageCount: number;
  /** How many embedded JPEG images can be re-compressed. */
  imageCount: number;
}

export interface CompressResult {
  ok: boolean;
  error?: string;
  bytes: Uint8Array;
  originalSize: number;
  compressedSize: number;
  /** Bytes saved, never negative — the original is returned if compression would grow the file. */
  savedBytes: number;
  savedPercent: number;
  imagesRecompressed: number;
  imagesTotal: number;
}

/* ------------------------------------------------------------------ *
 * Dictionary helpers
 * ------------------------------------------------------------------ */

function nameOf(d: PDict | null, key: string): string | null {
  const v = d?.v.get(key);
  return v && v.k === "name" ? v.v : null;
}

function filterNames(d: PDict): string[] {
  const f = d.v.get("Filter");
  if (!f) return [];
  if (f.k === "name") return [f.v];
  if (f.k === "arr")
    return f.v.filter((x): x is Extract<PVal, { k: "name" }> => x.k === "name").map((x) => x.v);
  return [];
}

/**
 * Reads the component count from a JPEG's Start-Of-Frame marker. 1 = grayscale, 3 = YCbCr —
 * both of which `createImageBitmap` handles reliably. 4 = CMYK/YCCK, which some browsers render
 * inverted, so callers skip those. Returns null when the bytes are not a parseable JPEG.
 */
function jpegComponents(data: Uint8Array): number | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < data.length) {
    if (data[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = data[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // Standalone markers carry no length field.
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      i += 2;
      continue;
    }
    const len = (data[i + 2] << 8) | data[i + 3];
    if (len < 2) return null;
    // SOF0..SOF15 hold the frame header; skip DHT (C4), JPG (C8), and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const nfIndex = i + 9; // FF marker len(2) precision(1) height(2) width(2) -> Nf
      return nfIndex < data.length ? data[nfIndex] : null;
    }
    i += 2 + len;
  }
  return null;
}

/**
 * Finds the embedded JPEG images worth re-compressing: single-filter DCTDecode XObjects that are
 * not masks, carry no soft mask or custom decode array, and are 1- or 3-component. Images that
 * are themselves used as another image's mask are skipped so we never re-encode an alpha channel.
 */
function collectJpegImages(doc: PdfDocument): PStream[] {
  const maskRefs = new Set<number>();
  for (const v of doc.objects.values()) {
    if (v.k !== "stream" || nameOf(v.d, "Subtype") !== "Image") continue;
    for (const key of ["SMask", "Mask"]) {
      const m = v.d.v.get(key);
      if (m?.k === "ref") maskRefs.add(m.n);
    }
  }

  const out: PStream[] = [];
  for (const [num, v] of doc.objects) {
    if (v.k !== "stream") continue;
    const d = v.d;
    if (nameOf(d, "Subtype") !== "Image") continue;

    const imageMask = d.v.get("ImageMask");
    if (imageMask?.k === "bool" && imageMask.v) continue;
    if (d.v.has("SMask") || d.v.has("Mask") || d.v.has("Decode")) continue;
    if (maskRefs.has(num)) continue;

    const filters = filterNames(d);
    if (filters.length !== 1 || (filters[0] !== "DCTDecode" && filters[0] !== "DCT")) continue;
    if (v.raw.length < 3072) continue; // tiny thumbnails aren't worth the re-encode

    const comps = jpegComponents(v.raw);
    if (comps !== 1 && comps !== 3) continue;

    out.push(v);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/** Reads a PDF and reports its page count and how many images can be compressed. */
export async function readCompressInfo(
  data: Uint8Array,
  inflate: PdfInflate,
): Promise<PdfCompressInfo> {
  if (!data || data.length === 0)
    return { ok: false, error: "empty file", pageCount: 0, imageCount: 0 };

  try {
    const { doc, error } = await parseDocument(data, inflate);
    if (!doc)
      return { ok: false, error: error ?? "could not read this PDF", pageCount: 0, imageCount: 0 };
    return { ok: true, pageCount: doc.pages.length, imageCount: collectJpegImages(doc).length };
  } catch {
    return { ok: false, error: "could not read this PDF", pageCount: 0, imageCount: 0 };
  }
}

/**
 * Compresses a PDF by re-encoding its embedded JPEG images and rewriting the document. The
 * returned file is never larger than the input — if the pass fails to shrink anything, the
 * original bytes come back unchanged. Bookmarks, the document outline, and interactive form
 * fields live at the catalog level and are not carried into the rebuilt file.
 */
export async function compressPdf(
  data: Uint8Array,
  options: CompressOptions,
  inflate: PdfInflate,
  recode: ImageRecoder,
): Promise<CompressResult> {
  const empty: CompressResult = {
    ok: false,
    bytes: new Uint8Array(0),
    originalSize: data?.length ?? 0,
    compressedSize: 0,
    savedBytes: 0,
    savedPercent: 0,
    imagesRecompressed: 0,
    imagesTotal: 0,
  };

  if (!data || data.length === 0) return { ...empty, error: "add a PDF first" };

  let parsed: { doc: PdfDocument | null; error?: string };
  try {
    parsed = await parseDocument(data, inflate);
  } catch {
    parsed = { doc: null, error: "could not read this PDF" };
  }
  if (!parsed.doc) return { ...empty, error: parsed.error ?? "could not read this PDF" };

  const doc = parsed.doc;
  const candidates = collectJpegImages(doc);

  const quality = Math.min(1, Math.max(0.1, options.quality));
  const maxDimension = Number.isFinite(options.maxDimension)
    ? Math.max(0, options.maxDimension)
    : 0;

  let imagesRecompressed = 0;
  for (const stream of candidates) {
    let recoded: RecodedImage | null = null;
    try {
      recoded = await recode(stream.raw, { quality, maxDimension });
    } catch {
      recoded = null;
    }
    // Only swap in the new image when it is actually smaller.
    if (!recoded || recoded.data.length === 0 || recoded.data.length >= stream.raw.length) continue;

    stream.raw = recoded.data;
    const d = stream.d.v;
    d.set("Width", { k: "num", v: recoded.width });
    d.set("Height", { k: "num", v: recoded.height });
    d.set("BitsPerComponent", { k: "num", v: 8 });
    d.set("ColorSpace", { k: "name", v: "DeviceRGB" });
    d.set("Filter", { k: "name", v: "DCTDecode" });
    d.delete("DecodeParms");
    d.delete("DP");
    imagesRecompressed++;
  }

  const selections: PageSelection[] = doc.pages.map((_, i) => ({ index: i }));
  let rebuilt: Uint8Array;
  try {
    rebuilt = buildPdf(doc, selections);
  } catch {
    return { ...empty, error: "compression failed — the file may be malformed" };
  }

  const finalBytes = rebuilt.length < data.length ? rebuilt : data;
  const compressedSize = finalBytes.length;
  const savedBytes = Math.max(0, data.length - compressedSize);
  const savedPercent = data.length > 0 ? Math.round((savedBytes / data.length) * 100) : 0;

  return {
    ok: true,
    bytes: finalBytes,
    originalSize: data.length,
    compressedSize,
    savedBytes,
    savedPercent,
    imagesRecompressed,
    imagesTotal: candidates.length,
  };
}
