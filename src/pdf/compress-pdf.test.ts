import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { dictOf, intOf, nameOf, parseDocument } from "./_pdf-lib.js";
import { type ImageRecoder, compressPdf, readCompressInfo } from "./compress-pdf.js";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

/**
 * Minimal JPEG-shaped bytes: SOI, an APP0 segment, then an SOF0 frame header whose
 * component count is `nf`, padded to `size` bytes. The engine only reads the SOF header;
 * the pixels are never decoded here (the recoder is a stub).
 */
function fakeJpeg(nf: number, size = 4000, marker = 0xc0): Uint8Array {
  const out = new Uint8Array(size);
  out.set([0xff, 0xd8]); // SOI
  out.set([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0], 2);
  // SOF: FF C0, length 8+3*nf, precision 8, height 16, width 16, Nf
  out.set([0xff, marker, 0x00, 8 + 3 * nf, 8, 0, 16, 0, 16, nf], 20);
  out.set([0xff, 0xd9], size - 2); // EOI
  return out;
}

interface Img {
  dict?: string;
  data: Uint8Array;
}

/** One page that draws every image; images are objects 5, 6, 7… */
function pdfWithImages(images: Img[], extra: Record<number, string> = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const names = images.map((_, i) => `/Im${i} ${5 + i} 0 R`).join(" ");
  const draw = images.map((_, i) => `q 10 0 0 10 0 0 cm /Im${i} Do Q`).join(" ");
  let head = "%PDF-1.4\n";
  head += "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  head += "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  head += `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /XObject << ${names} >> >> /Contents 4 0 R >>\nendobj\n`;
  head += `4 0 obj\n<< /Length ${draw.length} >>\nstream\n${draw}\nendstream\nendobj\n`;
  parts.push(latin1(head));
  images.forEach((img, i) => {
    const dict =
      img.dict ??
      "/Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode";
    parts.push(latin1(`${5 + i} 0 obj\n<< ${dict} /Length ${img.data.length} >>\nstream\n`));
    parts.push(img.data);
    parts.push(latin1("\nendstream\nendobj\n"));
  });
  for (const [n, body] of Object.entries(extra))
    parts.push(latin1(`${n} 0 obj\n${body}\nendobj\n`));
  parts.push(latin1("trailer\n<< /Root 1 0 R >>\n%%EOF\n"));
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

const smaller: ImageRecoder = async () => ({
  data: new Uint8Array(500).fill(7),
  width: 8,
  height: 4,
});

describe("readCompressInfo", () => {
  it("counts the JPEG images that can be re-encoded", async () => {
    const pdf = pdfWithImages([{ data: fakeJpeg(3) }, { data: fakeJpeg(1) }]);
    expect(await readCompressInfo(pdf, inflate)).toEqual({ ok: true, pageCount: 1, imageCount: 2 });
  });

  it("skips images that must not or need not be touched", async () => {
    const base =
      "/Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8";
    const pdf = pdfWithImages([
      { data: fakeJpeg(3, 1000), dict: `${base} /Filter /DCTDecode` }, // under 3 KB
      { data: fakeJpeg(4), dict: `${base} /Filter /DCTDecode` }, // CMYK
      { data: fakeJpeg(3), dict: `${base} /Filter /DCTDecode /SMask 20 0 R` }, // has a soft mask
      { data: fakeJpeg(3), dict: `${base} /Filter /DCTDecode /Decode [1 0 1 0 1 0]` },
      { data: fakeJpeg(3), dict: `${base} /Filter /FlateDecode` }, // not a JPEG
      { data: fakeJpeg(3), dict: `${base} /Filter [/ASCIIHexDecode /DCTDecode]` }, // chained
      {
        data: fakeJpeg(1),
        dict: "/Type /XObject /Subtype /Image /ImageMask true /Filter /DCTDecode",
      },
      { data: new Uint8Array(4000), dict: `${base} /Filter /DCTDecode` }, // not a JPEG at all
      { data: fakeJpeg(3, 4000, 0xc2), dict: `${base} /Filter /DCT` }, // progressive SOF2, /DCT alias: OK
    ]);
    expect((await readCompressInfo(pdf, inflate)).imageCount).toBe(1);
  });

  it("never re-encodes an image used as another image's mask", async () => {
    const base =
      "/Type /XObject /Subtype /Image /Width 16 /Height 16 /BitsPerComponent 8 /Filter /DCTDecode";
    const pdf = pdfWithImages([
      { data: fakeJpeg(3), dict: `${base} /ColorSpace /DeviceRGB /SMask 6 0 R` },
      { data: fakeJpeg(1), dict: `${base} /ColorSpace /DeviceGray` },
    ]);
    expect((await readCompressInfo(pdf, inflate)).imageCount).toBe(0);
  });

  it("rejects empty and non-PDF input", async () => {
    expect(await readCompressInfo(new Uint8Array(), inflate)).toEqual({
      ok: false,
      error: "empty file",
      pageCount: 0,
      imageCount: 0,
    });
    expect((await readCompressInfo(latin1("hello"), inflate)).error).toBe("not a PDF file");
  });
});

describe("compressPdf", () => {
  it("swaps in a smaller re-encode and rewrites the image dictionary", async () => {
    const pdf = pdfWithImages([
      {
        data: fakeJpeg(1),
        dict: "/Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /DecodeParms << /ColorTransform 0 >>",
      },
    ]);
    const r = await compressPdf(pdf, { quality: 0.5, maxDimension: 0 }, inflate, smaller);
    expect(r.ok).toBe(true);
    expect(r.imagesRecompressed).toBe(1);
    expect(r.imagesTotal).toBe(1);
    expect(r.originalSize).toBe(pdf.length);
    expect(r.compressedSize).toBe(r.bytes.length);
    expect(r.savedBytes).toBe(pdf.length - r.bytes.length);
    expect(r.savedPercent).toBe(Math.round((r.savedBytes / pdf.length) * 100));
    expect(r.compressedSize).toBeLessThan(r.originalSize);

    const { doc } = await parseDocument(r.bytes, inflate);
    const image = [...(doc?.objects.values() ?? [])].find(
      (v) => v.k === "stream" && nameOf(v.d, "Subtype") === "Image",
    );
    expect(image?.k).toBe("stream");
    if (image?.k !== "stream") return;
    expect(image.raw).toHaveLength(500);
    expect(intOf(image.d, "Width")).toBe(8);
    expect(intOf(image.d, "Height")).toBe(4);
    expect(intOf(image.d, "BitsPerComponent")).toBe(8);
    expect(nameOf(image.d, "ColorSpace")).toBe("DeviceRGB");
    expect(nameOf(image.d, "Filter")).toBe("DCTDecode");
    expect(image.d.v.has("DecodeParms")).toBe(false);
    // The page still points at it.
    const xo = dictOf(dictOf(doc?.pages[0].dict.v.get("Resources"))?.v.get("XObject"));
    expect(xo?.v.get("Im0")?.k).toBe("ref");
  });

  it("clamps quality to 0.1..1 and maxDimension to >= 0 before calling the recoder", async () => {
    const recode = vi.fn<ImageRecoder>(async () => null);
    const pdf = pdfWithImages([{ data: fakeJpeg(3) }]);
    await compressPdf(pdf, { quality: 0, maxDimension: -50 }, inflate, recode);
    await compressPdf(pdf, { quality: 7, maxDimension: Number.NaN }, inflate, recode);
    await compressPdf(pdf, { quality: 0.6, maxDimension: 1600 }, inflate, recode);
    expect(recode.mock.calls.map((c) => c[1])).toEqual([
      { quality: 0.1, maxDimension: 0 },
      { quality: 1, maxDimension: 0 },
      { quality: 0.6, maxDimension: 1600 },
    ]);
    expect(recode.mock.calls[0][0]).toHaveLength(4000);
  });

  it("keeps the original image when the recoder fails, returns null, empty or bigger data", async () => {
    const recoders: ImageRecoder[] = [
      async () => {
        throw new Error("decode failed");
      },
      async () => null,
      async () => ({ data: new Uint8Array(0), width: 1, height: 1 }),
      async () => ({ data: new Uint8Array(5000), width: 1, height: 1 }),
    ];
    for (const recode of recoders) {
      const r = await compressPdf(
        pdfWithImages([{ data: fakeJpeg(3) }]),
        { quality: 0.5, maxDimension: 0 },
        inflate,
        recode,
      );
      expect(r.ok).toBe(true);
      expect(r.imagesRecompressed).toBe(0);
      expect(r.imagesTotal).toBe(1);
    }
  });

  it("never returns a file larger than the input", async () => {
    // Nothing to compress: the rebuilt file is not allowed to grow past the original.
    const pdf = pdfWithImages([{ data: fakeJpeg(3) }]);
    const r = await compressPdf(pdf, { quality: 0.5, maxDimension: 0 }, inflate, async () => null);
    expect(r.compressedSize).toBeLessThanOrEqual(pdf.length);
    expect(r.savedBytes).toBeGreaterThanOrEqual(0);
    if (r.bytes === pdf) expect(r.savedBytes).toBe(0);
  });

  it("re-encodes a shared image once", async () => {
    const recode = vi.fn<ImageRecoder>(smaller);
    const pdf = pdfWithImages([{ data: fakeJpeg(3) }]);
    // Point a second XObject name at the same object.
    const twice = latin1(
      Buffer.from(pdf).toString("latin1").replace("/Im0 5 0 R", "/Im0 5 0 R /Im9 5 0 R"),
    );
    const r = await compressPdf(twice, { quality: 0.5, maxDimension: 0 }, inflate, recode);
    expect(recode).toHaveBeenCalledTimes(1);
    expect(r.imagesRecompressed).toBe(1);
  });

  it("returns errors for empty and unreadable input", async () => {
    const e = await compressPdf(
      new Uint8Array(),
      { quality: 0.5, maxDimension: 0 },
      inflate,
      smaller,
    );
    expect(e.error).toBe("add a PDF first");
    expect(e.bytes).toHaveLength(0);
    const enc = latin1("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<< /Encrypt 2 0 R >>\n");
    expect(
      (await compressPdf(enc, { quality: 0.5, maxDimension: 0 }, inflate, smaller)).error,
    ).toMatch(/password/);
  });
});
