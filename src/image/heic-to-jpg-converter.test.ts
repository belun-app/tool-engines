import { describe, expect, it } from "vitest";
import {
  HEIC_FORMATS,
  MAX_CANVAS_PIXELS,
  extractEmbeddedJpeg,
  fitWithin,
  formatBytes,
  heicFormat,
  heicOutputName,
  isHeicFile,
  megapixels,
  parseHeic,
} from "./heic-to-jpg-converter.js";

// HEVC decoding (createImageBitmap) and canvas export are in the mount. The container
// parser is tested on a tiny synthetic HEIF file assembled box by box below.

const enc = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const box = (type: string, payload: number[]) => [
  ...u32(payload.length + 8),
  ...enc(type),
  ...payload,
];
const full = (type: string, version: number, flags: number, payload: number[]) =>
  box(type, [version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff, ...payload]);
const infe = (id: number, type: string, name = "", hidden = false) =>
  full("infe", 2, hidden ? 1 : 0, [...u16(id), ...u16(0), ...enc(type), ...enc(name), 0]);
const ispe = (w: number, h: number) => full("ispe", 0, 0, [...u32(w), ...u32(h)]);

/**
 * EXIF item: 4-byte TIFF offset (0), little-endian TIFF with an empty IFD0 whose
 * next-IFD pointer leads to IFD1 at 14, which holds a 160×120 thumbnail of 4 bytes
 * (FF D8 FF D9) at TIFF offset 68. Total 4 + 68 + 4 = 76 bytes.
 */
function exifItem(): number[] {
  const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const entry = (tag: number, value: number) => [
    ...le16(tag),
    ...le16(4),
    ...le32(1),
    ...le32(value),
  ];
  const tiff = [
    ...enc("II"),
    ...le16(42),
    ...le32(8),
    ...le16(0), // IFD0: no entries
    ...le32(14), // next IFD -> IFD1
    ...le16(4),
    ...entry(0x0100, 160),
    ...entry(0x0101, 120),
    ...entry(0x0201, 68),
    ...entry(0x0202, 4),
    ...le32(0),
    0xff,
    0xd8,
    0xff,
    0xd9,
  ];
  return [...u32(0), ...tiff];
}

const JPEG_ITEM = [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9];

interface BuildOptions {
  withJpegItem?: boolean;
}

/**
 * An iPhone-like HEIC: item 1 is a 1×2 grid (bytes in idat) of hidden hvc1 tiles 2 and 3,
 * item 4 is EXIF, 5 an XMP mime item, 6 an alpha plane, 7 an optional 640×480 JPEG.
 * The grid is rotated (irot 1 = 90° anti-clockwise = 270° clockwise) and mirrored.
 */
function buildHeic({ withJpegItem = true }: BuildOptions = {}): {
  bytes: Uint8Array;
  exifOffset: number;
  jpegOffset: number;
} {
  const exif = exifItem();
  const mdatPayload = [...exif, ...(withJpegItem ? JPEG_ITEM : [])];

  const meta = (mdatStart: number) => {
    const exifOffset = mdatStart;
    const jpegOffset = mdatStart + exif.length;
    const items = [1, 2, 3, 4, 5, 6, ...(withJpegItem ? [7] : [])];
    const loc: Record<number, [number, number, number]> = {
      1: [1, 0, 8], // construction 1 = idat
      2: [0, mdatStart, 1],
      3: [0, mdatStart, 1],
      4: [0, exifOffset, exif.length],
      5: [0, mdatStart, 1],
      6: [0, mdatStart, 1],
      7: [0, jpegOffset, JPEG_ITEM.length],
    };
    const iloc = full("iloc", 1, 0, [
      0x44, // offset_size 4, length_size 4
      0x00, // base_offset_size 0, index_size 0
      ...u16(items.length),
      ...items.flatMap((id) => [
        ...u16(id),
        ...u16(loc[id][0]),
        ...u16(0),
        ...u16(1),
        ...u32(loc[id][1]),
        ...u32(loc[id][2]),
      ]),
    ]);
    const iinf = full("iinf", 0, 0, [
      ...u16(items.length),
      ...infe(1, "grid"),
      ...infe(2, "hvc1", "", true),
      ...infe(3, "hvc1", "", true),
      ...infe(4, "Exif"),
      ...infe(5, "mime", "XMP"),
      ...infe(6, "hvc1"),
      ...(withJpegItem ? infe(7, "jpeg") : []),
    ]);
    const ipco = box("ipco", [
      ...ispe(4032, 3024), // 1
      ...ispe(512, 512), // 2
      ...box("irot", [1]), // 3
      ...full("pixi", 0, 0, [3, 8, 8, 8]), // 4
      ...full("auxC", 0, 0, [...enc("urn:mpeg:mpegB:cicp:systems:auxiliary:alpha"), 0]), // 5
      ...box("imir", [0]), // 6
      ...ispe(640, 480), // 7
    ]);
    const assoc: [number, number[]][] = [
      [1, [1, 3, 6]],
      [2, [2, 4]],
      [3, [2, 4]],
      [6, [2, 5]],
      ...(withJpegItem ? ([[7, [7 | 0x80]]] as [number, number[]][]) : []), // essential bit set
    ];
    const ipma = full("ipma", 0, 0, [
      ...u32(assoc.length),
      ...assoc.flatMap(([id, list]) => [...u16(id), list.length, ...list]),
    ]);
    const iref = full("iref", 0, 0, [
      ...box("dimg", [...u16(1), ...u16(2), ...u16(2), ...u16(3)]),
      ...box("thmb", [...u16(7), ...u16(1), ...u16(1)]),
    ]);
    // grid: version 0, flags 0, rows-1 = 0, columns-1 = 1, 16-bit width 1000 and height 500
    const idat = box("idat", [0, 0, 0, 1, ...u16(1000), ...u16(500)]);
    return full("meta", 0, 0, [
      ...full("pitm", 0, 0, u16(1)),
      ...iinf,
      ...iloc,
      ...box("iprp", [...ipco, ...ipma]),
      ...iref,
      ...idat,
    ]);
  };

  const ftyp = box("ftyp", [...enc("heic"), ...u32(0), ...enc("mif1"), ...enc("heic")]);
  const moov = box("moov", []);
  const headLength = ftyp.length + meta(0).length + moov.length;
  const mdatStart = headLength + 8;
  // mdat with size 0: "runs to the end of the file".
  const mdat = [...u32(0), ...enc("mdat"), ...mdatPayload];
  const bytes = Uint8Array.from([...ftyp, ...meta(mdatStart), ...moov, ...mdat]);
  return { bytes, exifOffset: mdatStart, jpegOffset: mdatStart + exif.length };
}

describe("parseHeic — synthetic iPhone-style file", () => {
  it("reads brand, grid, tiles, rotation, mirror, aux planes and metadata", () => {
    const { bytes } = buildHeic();
    const info = parseHeic(bytes);
    expect(info).not.toBeNull();
    expect(info).toMatchObject({
      brand: "heic",
      compatibleBrands: ["mif1", "heic"],
      isHeif: true,
      codec: "hevc",
      primaryItemId: 1,
      width: 1000, // assembled grid size from idat wins over ispe
      height: 500,
      rotation: 270,
      mirrored: true,
      tiled: true,
      tileRows: 1,
      tileColumns: 2,
      tileWidth: 512,
      tileHeight: 512,
      bitDepth: 8, // from the first tile's pixi
      imageCount: 2, // the grid and the JPEG; hidden tiles and the alpha plane do not count
      hasAlpha: true,
      hasDepth: false,
      hasExif: true,
      hasXmp: true,
      hasVideoTrack: true,
    });
    expect(info?.items.map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(info?.items[1]).toMatchObject({ type: "hvc1", hidden: true, width: 512 });
    expect(info?.items[0]).toMatchObject({ inIdat: true, mirrorAxis: 0 });
    expect(info?.items[6]).toMatchObject({ width: 640, height: 480 }); // essential bit masked
  });

  it("prefers the largest embedded JPEG (the 640×480 item over the EXIF thumbnail)", () => {
    const { bytes, jpegOffset } = buildHeic();
    const info = parseHeic(bytes);
    expect(info?.embeddedJpeg).toEqual({
      offset: jpegOffset,
      length: JPEG_ITEM.length,
      width: 640,
      height: 480,
      source: "item",
    });
    expect([...(extractEmbeddedJpeg(bytes, info as NonNullable<typeof info>) ?? [])]).toEqual(
      JPEG_ITEM,
    );
  });

  it("falls back to the EXIF IFD1 thumbnail", () => {
    const { bytes, exifOffset } = buildHeic({ withJpegItem: false });
    const info = parseHeic(bytes);
    expect(info?.embeddedJpeg).toEqual({
      offset: exifOffset + 4 + 68,
      length: 4,
      width: 160,
      height: 120,
      source: "exif",
    });
    expect(info?.imageCount).toBe(1);
  });
});

describe("parseHeic — other inputs", () => {
  it("returns null for non-ISO data and tiny inputs", () => {
    expect(parseHeic(new Uint8Array())).toBeNull();
    expect(
      parseHeic(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)])),
    ).toBeNull();
    // ftyp present but not first
    expect(
      parseHeic(Uint8Array.from([...box("free", [0, 0, 0, 0]), ...box("ftyp", enc("heic0000"))])),
    ).toBeNull();
  });

  it("reports an ISO file without meta as not HEIF", () => {
    const info = parseHeic(
      Uint8Array.from([...box("ftyp", [...enc("isom"), ...u32(0)]), ...box("moov", [])]),
    );
    expect(info).toMatchObject({ brand: "isom", isHeif: false, items: [], hasVideoTrack: true });
  });

  it("parses a single-frame AVIF and a 64-bit sized box", () => {
    const meta = full("meta", 0, 0, [
      ...full("pitm", 0, 0, u16(1)),
      ...full("iinf", 0, 0, [...u16(1), ...infe(1, "av01")]),
      ...box("iprp", [
        ...box("ipco", ispe(800, 600)),
        ...full("ipma", 0, 0, [...u32(1), ...u16(1), 1, 1]),
      ]),
    ]);
    // "free" box with size == 1 and a 64-bit largesize of 16 (header only)
    const large = [...u32(1), ...enc("free"), ...u32(0), ...u32(16)];
    const info = parseHeic(
      Uint8Array.from([...box("ftyp", [...enc("avif"), ...u32(0)]), ...large, ...meta]),
    );
    expect(info).toMatchObject({
      brand: "avif",
      isHeif: true,
      codec: "av1",
      tiled: false,
      width: 800,
      height: 600,
      imageCount: 1,
      embeddedJpeg: null,
    });
  });

  it("ignores insane ispe extents", () => {
    const meta = full("meta", 0, 0, [
      ...full("pitm", 0, 0, u16(1)),
      ...full("iinf", 0, 0, [...u16(1), ...infe(1, "hvc1")]),
      ...box("iprp", [
        ...box("ipco", ispe(70000, 0)),
        ...full("ipma", 0, 0, [...u32(1), ...u16(1), 1, 1]),
      ]),
    ]);
    const info = parseHeic(Uint8Array.from([...box("ftyp", [...enc("heic"), ...u32(0)]), ...meta]));
    expect([info?.width, info?.height]).toEqual([0, 0]);
  });

  it("never throws on a truncated file (truncated boxes are dropped)", () => {
    const { bytes } = buildHeic();
    for (let n = 16; n < bytes.length; n++) {
      expect(() => parseHeic(bytes.subarray(0, n))).not.toThrow();
    }
  });

  it("never throws on a malformed child box", () => {
    const meta = full("meta", 0, 0, full("pitm", 0, 0, []));
    const bytes = Uint8Array.from([...box("ftyp", [...enc("heic"), ...u32(0)]), ...meta]);
    expect(() => parseHeic(bytes)).not.toThrow();
  });
});

describe("helpers", () => {
  it("recognises HEIC by extension first, then by MIME", () => {
    expect(isHeicFile("IMG_0001.HEIC")).toBe(true);
    expect(isHeicFile("photo.hif")).toBe(true);
    expect(isHeicFile("blob", "image/heic")).toBe(true);
    expect(isHeicFile("blob", "IMAGE/HEIF")).toBe(true);
    expect(isHeicFile("blob", "image/heic-sequence")).toBe(true);
    expect(isHeicFile("photo.heic.jpg", "image/jpeg")).toBe(false);
    expect(isHeicFile("", "")).toBe(false);
  });

  it("names outputs", () => {
    expect(heicOutputName("IMG_4312.HEIC", "jpg")).toBe("IMG_4312.jpg");
    expect(heicOutputName("IMG_4312.HEIC", "png", "2")).toBe("IMG_4312-2.png");
    expect(heicOutputName("dir/sub\\a.heic", "jpg")).toBe("dir-sub-a.jpg");
    expect(heicOutputName("", "webp")).toBe("image.webp");
    expect(heicOutputName(".heic", "jpg")).toBe("image.jpg");
  });

  it("looks up formats with a JPEG fallback", () => {
    expect(heicFormat("png").mime).toBe("image/png");
    expect(heicFormat("bmp")).toBe(HEIC_FORMATS[0]);
  });

  it("formats bytes and megapixels", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
    // 4032·3024 = 12 192 768 -> 12.2 MP
    expect(megapixels(4032, 3024)).toBe(12.2);
    expect(megapixels(0, 100)).toBe(0);
  });

  it("fits within the side cap and passes small or empty sizes through", () => {
    expect(fitWithin(10000, 100)).toEqual({ width: 8192, height: 82, scaled: true });
    expect(fitWithin(4032, 3024)).toEqual({ width: 4032, height: 3024, scaled: false });
    expect(fitWithin(0, 5)).toEqual({ width: 0, height: 5, scaled: false });
  });

  it("scales a 48 MP frame down to about 16.7 MP", () => {
    // sqrt(16 777 216 / (8064·6048)) = 0.58651 -> 4729.65 × 3547.24; rounding gives
    // 4730 × 3547 (94 px over the budget), so both sides are floored: 4729 × 3547
    expect(fitWithin(8064, 6048)).toEqual({ width: 4729, height: 3547, scaled: true });
  });

  it("keeps the scaled area within MAX_CANVAS_PIXELS", () => {
    const { width, height } = fitWithin(8064, 6048);
    expect(width * height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
  });
});
