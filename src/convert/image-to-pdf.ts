/**
 * Client-side Image → PDF builder.
 *
 * The mount decodes each input image on a canvas and hands over baseline JPEG bytes plus pixel
 * dimensions; this engine lays every image onto its own page and serializes the document through
 * the shared PDF core (_pdf-lib). Pixel sizes convert to points at CSS 96 DPI, so a 1920×1080
 * screenshot becomes a 1440×810 pt page in "fit" mode. On fixed pages (A4 / Letter) the image is
 * scaled to fit inside the margins, keeping its aspect ratio, and centered.
 */

import { type PVal, serialize } from "../pdf/_pdf-lib.js";

export { formatFileSize } from "../pdf/_pdf-lib.js";

export type PageSizeId = "fit" | "a4" | "letter";
export type PageOrientation = "auto" | "portrait" | "landscape";

export interface ImagePage {
  /** Baseline JPEG bytes (the mount re-encodes PNG/WebP input to JPEG via canvas). */
  jpeg: Uint8Array;
  pxWidth: number;
  pxHeight: number;
}

export interface ImageToPdfOptions {
  pageSize: PageSizeId;
  /** Ignored in "fit" mode, where the image itself dictates the page shape. */
  orientation: PageOrientation;
  /** Page margin in points (72 pt = 1 inch). */
  marginPt: number;
}

export interface ImageToPdfResult {
  ok: boolean;
  error?: string;
  pdf: Uint8Array | null;
  pageCount: number;
}

const PX_TO_PT = 72 / 96;

const FIXED_SIZES: Record<Exclude<PageSizeId, "fit">, { w: number; h: number }> = {
  a4: { w: 595.28, h: 841.89 },
  letter: { w: 612, h: 792 },
};

const num = (v: number): PVal => ({ k: "num", v: Math.round(v * 100) / 100 });
const name = (v: string): PVal => ({ k: "name", v });
const ref = (n: number): PVal => ({ k: "ref", n });

function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** "photo.jpg" → "photo.pdf"; anything else, or several files → "images.pdf". */
export function outputFilename(names: string[]): string {
  if (Array.isArray(names) && names.length === 1 && typeof names[0] === "string") {
    const base = names[0].replace(/\.[^.]+$/, "").trim();
    if (base) return `${base}.pdf`;
  }
  return "images.pdf";
}

/**
 * Build a PDF with one page per image. Pure — no DOM; the caller supplies decoded JPEG
 * bytes. Empty input yields an error result rather than throwing.
 */
export function buildImagesPdf(images: ImagePage[], options: ImageToPdfOptions): ImageToPdfResult {
  const usable = (Array.isArray(images) ? images : []).filter(
    (im) =>
      im &&
      im.jpeg instanceof Uint8Array &&
      im.jpeg.length > 0 &&
      Number.isFinite(im.pxWidth) &&
      Number.isFinite(im.pxHeight) &&
      im.pxWidth > 0 &&
      im.pxHeight > 0,
  );

  if (usable.length === 0) {
    return { ok: false, error: "no images to convert", pdf: null, pageCount: 0 };
  }

  const margin = clamp(options?.marginPt ?? 0, 0, 144);
  const objects: Array<PVal | null> = [null, null]; // reserve the catalog and page-tree root
  const kids: PVal[] = [];

  for (const img of usable) {
    const iw = img.pxWidth * PX_TO_PT;
    const ih = img.pxHeight * PX_TO_PT;

    let pageW: number;
    let pageH: number;
    let drawW: number;
    let drawH: number;

    if (options?.pageSize === "a4" || options?.pageSize === "letter") {
      const base = FIXED_SIZES[options.pageSize];
      const landscape =
        options.orientation === "landscape" ||
        (options.orientation !== "portrait" && img.pxWidth > img.pxHeight);
      pageW = landscape ? base.h : base.w;
      pageH = landscape ? base.w : base.h;
      const availW = Math.max(1, pageW - margin * 2);
      const availH = Math.max(1, pageH - margin * 2);
      const scale = Math.min(availW / iw, availH / ih);
      drawW = iw * scale;
      drawH = ih * scale;
    } else {
      drawW = iw;
      drawH = ih;
      pageW = iw + margin * 2;
      pageH = ih + margin * 2;
    }

    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;

    const imgDict = new Map<string, PVal>([
      ["Type", name("XObject")],
      ["Subtype", name("Image")],
      ["Width", num(img.pxWidth)],
      ["Height", num(img.pxHeight)],
      ["ColorSpace", name("DeviceRGB")],
      ["BitsPerComponent", num(8)],
      ["Filter", name("DCTDecode")],
    ]);
    objects.push({ k: "stream", d: { k: "dict", v: imgDict }, raw: img.jpeg });
    const imgNum = objects.length;

    const content = `q ${fmt(drawW)} 0 0 ${fmt(drawH)} ${fmt(x)} ${fmt(y)} cm /Im0 Do Q`;
    objects.push({
      k: "stream",
      d: { k: "dict", v: new Map<string, PVal>() },
      raw: new TextEncoder().encode(content),
    });
    const contentNum = objects.length;

    const resources: PVal = {
      k: "dict",
      v: new Map<string, PVal>([
        ["XObject", { k: "dict", v: new Map<string, PVal>([["Im0", ref(imgNum)]]) }],
      ]),
    };
    objects.push({
      k: "dict",
      v: new Map<string, PVal>([
        ["Type", name("Page")],
        ["Parent", ref(2)],
        ["MediaBox", { k: "arr", v: [num(0), num(0), num(pageW), num(pageH)] }],
        ["Resources", resources],
        ["Contents", ref(contentNum)],
      ]),
    });
    kids.push(ref(objects.length));
  }

  objects[0] = {
    k: "dict",
    v: new Map<string, PVal>([
      ["Type", name("Catalog")],
      ["Pages", ref(2)],
    ]),
  };
  objects[1] = {
    k: "dict",
    v: new Map<string, PVal>([
      ["Type", name("Pages")],
      ["Kids", { k: "arr", v: kids }],
      ["Count", num(kids.length)],
    ]),
  };

  return { ok: true, pdf: serialize(objects), pageCount: kids.length };
}
