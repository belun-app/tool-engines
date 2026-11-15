import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pageBox, parseDocument } from "../pdf/_pdf-lib.js";
import { buildImagesPdf, formatFileSize, outputFilename } from "./image-to-pdf.js";

// The engine treats JPEG bytes as opaque payload, so a few fake bytes are enough.
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 0xff, 0xd9]);
const img = (pxWidth: number, pxHeight: number) => ({ jpeg: JPEG, pxWidth, pxHeight });
const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const text = (pdf: Uint8Array | null) => Buffer.from(pdf ?? []).toString("latin1");

async function boxes(pdf: Uint8Array | null) {
  const { doc } = await parseDocument(pdf as Uint8Array, inflate);
  if (!doc) throw new Error("unparseable");
  return doc.pages.map((p) => pageBox(doc, p));
}

describe("outputFilename", () => {
  it("renames a single file and falls back to images.pdf", () => {
    expect(outputFilename(["photo.jpg"])).toBe("photo.pdf");
    expect(outputFilename(["archive.tar.gz"])).toBe("archive.tar.pdf");
    expect(outputFilename(["a.png", "b.png"])).toBe("images.pdf");
    expect(outputFilename([])).toBe("images.pdf");
    expect(outputFilename([".png"])).toBe("images.pdf");
  });
});

describe("buildImagesPdf", () => {
  it("returns an error result for no usable images", () => {
    const opts = { pageSize: "fit" as const, orientation: "auto" as const, marginPt: 0 };
    expect(buildImagesPdf([], opts)).toEqual({
      ok: false,
      error: "no images to convert",
      pdf: null,
      pageCount: 0,
    });
    expect(
      buildImagesPdf(
        [{ jpeg: new Uint8Array(), pxWidth: 10, pxHeight: 10 }, img(0, 10), img(Number.NaN, 5)],
        opts,
      ).ok,
    ).toBe(false);
  });

  it("fits the page to the image at 96 DPI (1920x1080 px -> 1440x810 pt)", async () => {
    const r = buildImagesPdf([img(1920, 1080)], {
      pageSize: "fit",
      orientation: "auto",
      marginPt: 0,
    });
    expect(r.ok).toBe(true);
    expect(r.pageCount).toBe(1);
    expect(text(r.pdf).startsWith("%PDF-")).toBe(true);
    expect(await boxes(r.pdf)).toEqual([{ x0: 0, y0: 0, width: 1440, height: 810 }]);
    expect(text(r.pdf)).toContain("q 1440 0 0 810 0 0 cm /Im0 Do Q");
  });

  it("adds margins around a fitted page", async () => {
    const r = buildImagesPdf([img(96, 96)], { pageSize: "fit", orientation: "auto", marginPt: 10 });
    // 96 px = 72 pt, plus 10 pt on each side
    expect(await boxes(r.pdf)).toEqual([{ x0: 0, y0: 0, width: 92, height: 92 }]);
    expect(text(r.pdf)).toContain("q 72 0 0 72 10 10 cm");
  });

  it("scales and centres on A4, rotating to landscape for wide images in auto mode", async () => {
    const r = buildImagesPdf([img(800, 400), img(400, 800)], {
      pageSize: "a4",
      orientation: "auto",
      marginPt: 0,
    });
    expect(r.pageCount).toBe(2);
    expect(await boxes(r.pdf)).toEqual([
      { x0: 0, y0: 0, width: 841.89, height: 595.28 },
      { x0: 0, y0: 0, width: 595.28, height: 841.89 },
    ]);
    // Wide image on landscape A4: limited by width -> 841.89 x 420.945, centred vertically
    expect(text(r.pdf)).toContain("q 841.89 0 0 420.95 0 87.17 cm");
  });

  it("honours a forced orientation on Letter", async () => {
    const r = buildImagesPdf([img(800, 400)], {
      pageSize: "letter",
      orientation: "portrait",
      marginPt: 36,
    });
    expect(await boxes(r.pdf)).toEqual([{ x0: 0, y0: 0, width: 612, height: 792 }]);
    // avail 540 x 720; wide image limited by width: 540 x 270, x = 36, y = (792-270)/2 = 261
    expect(text(r.pdf)).toContain("q 540 0 0 270 36 261 cm");
  });

  it("clamps the margin to 0..144 pt", async () => {
    const r = buildImagesPdf([img(96, 96)], {
      pageSize: "fit",
      orientation: "auto",
      marginPt: 999,
    });
    expect(await boxes(r.pdf)).toEqual([{ x0: 0, y0: 0, width: 360, height: 360 }]);
    const neg = buildImagesPdf([img(96, 96)], {
      pageSize: "fit",
      orientation: "auto",
      marginPt: -5,
    });
    expect(await boxes(neg.pdf)).toEqual([{ x0: 0, y0: 0, width: 72, height: 72 }]);
  });

  it("re-exports formatFileSize", () => {
    expect(typeof formatFileSize(2048)).toBe("string");
  });
});
