import { describe, expect, it } from "vitest";
import { getCleanFilename, stripMetadata } from "./exif-metadata-remover.js";

const enc = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** A JPEG marker segment: FF marker, 2-byte big-endian length (payload + 2), payload. */
function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}

/**
 * Hand-laid-out TIFF block (208 bytes):
 *   0   header, IFD0 at 8
 *   8   IFD0: Make -> 62, Orientation = 6, ExifIFD -> 68, GPS IFD -> 106
 *   62  "Canon\0"
 *   68  Exif IFD: DateTimeOriginal -> 86
 *   86  "2024:05:01 12:34:56\0"
 *   106 GPS IFD: LatRef "N", Lat -> 160, LonRef "W", Lon -> 184
 *   160 lat 50/1, 30/1, 3600/100  = 50 + 0.5 + 0.01   = 50.510000
 *   184 lon 0/1, 7/1, 30/1        = 0 + 0.116667 + 0.008333 = 0.125000
 */
function buildTiff(little: boolean, orientation = 6): Uint8Array {
  const buf = new Uint8Array(208);
  const v = new DataView(buf.buffer);
  const w16 = (o: number, x: number) => v.setUint16(o, x, little);
  const w32 = (o: number, x: number) => v.setUint32(o, x, little);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    w16(at, tag);
    w16(at + 2, type);
    w32(at + 4, count);
    if (type === 3) w16(at + 8, value);
    else w32(at + 8, value);
  };
  buf.set(enc(little ? "II" : "MM"), 0);
  w16(2, 42);
  w32(4, 8);
  w16(8, 4);
  entry(10, 0x010f, 2, 6, 62);
  entry(22, 0x0112, 3, 1, orientation);
  entry(34, 0x8769, 4, 1, 68);
  entry(46, 0x8825, 4, 1, 106);
  w32(58, 0);
  buf.set(enc("Canon\0"), 62);
  w16(68, 1);
  entry(70, 0x9003, 2, 20, 86);
  w32(82, 0);
  buf.set(enc("2024:05:01 12:34:56\0"), 86);
  w16(106, 4);
  entry(108, 0x0001, 2, 2, 0);
  buf.set(enc("N\0"), 116);
  entry(120, 0x0002, 5, 3, 160);
  entry(132, 0x0003, 2, 2, 0);
  buf.set(enc("W\0"), 140);
  entry(144, 0x0004, 5, 3, 184);
  w32(156, 0);
  const rationals = (at: number, pairs: number[]) => {
    pairs.forEach((x, i) => w32(at + i * 4, x));
  };
  rationals(160, [50, 1, 30, 1, 3600, 100]);
  rationals(184, [0, 1, 7, 1, 30, 1]);
  return buf;
}

const SOI = [0xff, 0xd8];
const APP0 = seg(0xe0, [...enc("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const DQT = seg(0xdb, [0, 1, 2, 3]);
const SOS_AND_DATA = [...seg(0xda, [1, 2, 3]), 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9];

function jpegWithEverything(tiff = buildTiff(true)): Uint8Array {
  return Uint8Array.from([
    ...SOI,
    ...APP0,
    ...seg(0xe1, [...enc("Exif\0\0"), ...tiff]),
    ...seg(0xe1, enc("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>")),
    ...seg(0xed, [...enc("Photoshop 3.0\0"), 1, 2]),
    ...seg(0xfe, enc("made with love")),
    ...DQT,
    ...SOS_AND_DATA,
  ]);
}

describe("stripMetadata — JPEG", () => {
  it("removes EXIF, XMP, IPTC and comments and reports what it saw", () => {
    const r = stripMetadata(jpegWithEverything(), { keepOrientation: false });
    expect(r.ok).toBe(true);
    expect(r.format).toBe("jpeg");
    expect(r.removed).toEqual(["exif", "xmp", "iptc", "comment"]);
    expect(r.hadGps).toBe(true);
    expect(r.fields).toEqual([
      { key: "make", value: "Canon" },
      { key: "dateTimeOriginal", value: "2024:05:01 12:34:56" },
      { key: "gps", value: "50.510000° N, 0.125000° W" },
    ]);
    // Only SOI, APP0, DQT and the untouched scan remain.
    expect([...(r.cleaned ?? [])]).toEqual([...SOI, ...APP0, ...DQT, ...SOS_AND_DATA]);
    expect(r.cleanedBytes).toBe(r.cleaned?.length);
    expect(r.originalBytes).toBe(jpegWithEverything().length);
  });

  it("parses big-endian (MM) EXIF the same way", () => {
    const r = stripMetadata(jpegWithEverything(buildTiff(false)), { keepOrientation: false });
    expect(r.fields.map((f) => f.value)).toEqual([
      "Canon",
      "2024:05:01 12:34:56",
      "50.510000° N, 0.125000° W",
    ]);
  });

  it("re-inserts a minimal 36-byte orientation EXIF by default", () => {
    const input = jpegWithEverything();
    const r = stripMetadata(input);
    const out = r.cleaned as Uint8Array;
    const at = SOI.length + APP0.length; // right after APP0
    // FF E1, length 0x0022 (34), "Exif\0\0", "II"
    expect([...out.subarray(at, at + 12)]).toEqual([
      0xff,
      0xe1,
      0x00,
      0x22,
      ...enc("Exif\0\0"),
      ...enc("II"),
    ]);
    // Orientation value (SHORT, little-endian) at TIFF offset 18.
    const tiff = at + 4 + 6;
    expect(out[tiff + 10] | (out[tiff + 11] << 8)).toBe(0x0112);
    expect(out[tiff + 18] | (out[tiff + 19] << 8)).toBe(6);
    expect(r.cleanedBytes).toBe(SOI.length + APP0.length + 36 + DQT.length + SOS_AND_DATA.length);
    // And the result itself is a valid input whose only metadata is that EXIF.
    expect(stripMetadata(out, { keepOrientation: false }).removed).toEqual(["exif"]);
  });

  it("does not re-insert orientation when it is already upright (1)", () => {
    const r = stripMetadata(jpegWithEverything(buildTiff(true, 1)));
    expect(r.cleanedBytes).toBe(SOI.length + APP0.length + DQT.length + SOS_AND_DATA.length);
  });

  it("keeps APP1/APP13 segments that are neither EXIF/XMP nor Photoshop IRB", () => {
    const other1 = seg(0xe1, enc("SomethingElse"));
    const other13 = seg(0xed, enc("Adobe_CM"));
    const input = Uint8Array.from([...SOI, ...other1, ...other13, ...SOS_AND_DATA]);
    const r = stripMetadata(input);
    expect(r.removed).toEqual([]);
    expect([...(r.cleaned ?? [])]).toEqual([...input]);
  });

  it("passes 0xFF fill bytes through", () => {
    const input = Uint8Array.from([...SOI, 0xff, ...DQT, ...SOS_AND_DATA]);
    expect([...(stripMetadata(input).cleaned ?? [])]).toEqual([...input]);
  });

  it("survives malformed EXIF by stripping it without fields", () => {
    const badTiff = Uint8Array.from([...enc("II"), 42, 0, 0xff, 0xff, 0, 0]); // IFD0 past the end
    const r = stripMetadata(
      Uint8Array.from([...SOI, ...seg(0xe1, [...enc("Exif\0\0"), ...badTiff]), ...SOS_AND_DATA]),
    );
    expect(r.ok).toBe(true);
    expect(r.removed).toEqual(["exif"]);
    expect(r.fields).toEqual([]);
    expect(r.hadGps).toBe(false);
  });

  it("flags truncated or garbled segment structure as corrupt", () => {
    // Segment claims 0x0100 bytes but the file ends.
    const truncated = Uint8Array.from([...SOI, 0xff, 0xe0, 0x01, 0x00, 1, 2, 3]);
    expect(stripMetadata(truncated)).toMatchObject({ ok: false, error: "corrupt", cleaned: null });
    // A non-0xFF byte where a marker should be.
    expect(stripMetadata(Uint8Array.from([...SOI, 0x00, 0x01, 0x02])).error).toBe("corrupt");
    // A length below 2 is impossible.
    expect(stripMetadata(Uint8Array.from([...SOI, 0xff, 0xe0, 0x00, 0x01])).error).toBe("corrupt");
  });
});

describe("stripMetadata — PNG", () => {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[]) => {
    const n = data.length;
    return [
      n >>> 24,
      (n >> 16) & 0xff,
      (n >> 8) & 0xff,
      n & 0xff,
      ...enc(type),
      ...data,
      0,
      0,
      0,
      0,
    ];
  };
  const IHDR = chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const IDAT = chunk("IDAT", [1, 2, 3, 4]);
  const IEND = chunk("IEND", []);

  it("drops text, time and eXIf chunks and anything after IEND", () => {
    const input = Uint8Array.from([
      ...SIG,
      ...IHDR,
      ...chunk("tEXt", enc("Author\0Me")),
      ...chunk("iTXt", enc("k\0\0\0\0\0v")),
      ...chunk("tIME", [7, 0xe8, 1, 1, 0, 0, 0]),
      ...chunk("eXIf", [...buildTiff(false)]),
      ...IDAT,
      ...IEND,
      9,
      9,
      9,
    ]);
    const r = stripMetadata(input);
    expect(r.ok).toBe(true);
    expect(r.format).toBe("png");
    expect(r.removed).toEqual(["text", "time", "exif"]);
    expect(r.hadGps).toBe(true);
    expect(r.fields[0]).toEqual({ key: "make", value: "Canon" });
    expect([...(r.cleaned ?? [])]).toEqual([...SIG, ...IHDR, ...IDAT, ...IEND]);
  });

  it("returns a clean PNG unchanged", () => {
    const input = Uint8Array.from([...SIG, ...IHDR, ...IDAT, ...IEND]);
    const r = stripMetadata(input);
    expect(r.removed).toEqual([]);
    expect(r.cleanedBytes).toBe(input.length);
  });

  it("flags a chunk running past the end as corrupt", () => {
    const input = Uint8Array.from([...SIG, 0, 0, 1, 0, ...enc("IDAT"), 1, 2]);
    expect(stripMetadata(input).error).toBe("corrupt");
  });
});

describe("stripMetadata — other inputs", () => {
  it("rejects empty input", () => {
    expect(stripMetadata(new Uint8Array())).toMatchObject({
      ok: false,
      error: "empty",
      originalBytes: 0,
    });
  });

  it("rejects unsupported formats (GIF, too-short JPEG signature)", () => {
    expect(stripMetadata(Uint8Array.from(enc("GIF89a....."))).error).toBe("unsupported");
    expect(stripMetadata(Uint8Array.from([0xff, 0xd8, 0xff])).error).toBe("unsupported");
  });
});

describe("getCleanFilename", () => {
  it("inserts -clean before the extension", () => {
    expect(getCleanFilename("IMG_0001.JPG")).toBe("IMG_0001-clean.JPG");
    expect(getCleanFilename("my.photo.png")).toBe("my.photo-clean.png");
  });

  it("handles names without a usable extension", () => {
    expect(getCleanFilename("photo")).toBe("photo-clean");
    expect(getCleanFilename(".hidden")).toBe(".hidden-clean");
    expect(getCleanFilename("")).toBe("image-clean");
  });
});
