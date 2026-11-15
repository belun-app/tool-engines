export type StrippableFormat = "jpeg" | "png";

export interface MetadataField {
  /** Machine key: "make" | "model" | "software" | "dateTime" | "dateTimeOriginal" | "gps". */
  key: string;
  value: string;
}

export interface StripResult {
  ok: boolean;
  /** Machine-readable reason when not ok: "empty" | "unsupported" | "corrupt". */
  error: string;
  format: StrippableFormat | null;
  /** File with metadata removed; null when not ok. Image data is untouched (lossless). */
  cleaned: Uint8Array | null;
  originalBytes: number;
  cleanedBytes: number;
  /** Machine keys of removed blocks: "exif" | "xmp" | "iptc" | "comment" | "text" | "time". */
  removed: string[];
  hadGps: boolean;
  /** Notable metadata parsed from EXIF before removal, for display. */
  fields: MetadataField[];
}

interface ExifInfo {
  fields: MetadataField[];
  hadGps: boolean;
  orientation: number;
}

function failure(error: string, originalBytes: number): StripResult {
  return {
    ok: false,
    error,
    format: null,
    cleaned: null,
    originalBytes,
    cleanedBytes: 0,
    removed: [],
    hadGps: false,
    fields: [],
  };
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/** Parse a TIFF/EXIF block and pull out the fields worth showing to the user. */
function parseExif(tiff: Uint8Array): ExifInfo {
  const info: ExifInfo = { fields: [], hadGps: false, orientation: 1 };
  try {
    if (tiff.length < 8) return info;
    const order = ascii(tiff, 0, 2);
    if (order !== "II" && order !== "MM") return info;
    const little = order === "II";
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    if (view.getUint16(2, little) !== 42) return info;

    const u16 = (offset: number) => view.getUint16(offset, little);
    const u32 = (offset: number) => view.getUint32(offset, little);

    const readAscii = (valueOffset: number, count: number): string => {
      const start = count <= 4 ? valueOffset : u32(valueOffset);
      if (start + count > tiff.length) return "";
      return ascii(tiff, start, count).replace(/\0+$/, "").trim();
    };

    const readRationals = (valueOffset: number, count: number): number[] => {
      const start = u32(valueOffset);
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        const at = start + i * 8;
        if (at + 8 > tiff.length) return values;
        const den = u32(at + 4);
        values.push(den === 0 ? 0 : u32(at) / den);
      }
      return values;
    };

    interface Entry {
      type: number;
      count: number;
      /** Offset of the 4-byte value/offset field itself. */
      valueOffset: number;
    }

    const readIfd = (ifdOffset: number): Map<number, Entry> => {
      const entries = new Map<number, Entry>();
      if (ifdOffset + 2 > tiff.length) return entries;
      const count = u16(ifdOffset);
      for (let i = 0; i < count; i++) {
        const at = ifdOffset + 2 + i * 12;
        if (at + 12 > tiff.length) break;
        entries.set(u16(at), { type: u16(at + 2), count: u32(at + 4), valueOffset: at + 8 });
      }
      return entries;
    };

    const ifd0 = readIfd(u32(4));

    const pushAscii = (tag: number, key: string, from: Map<number, Entry>) => {
      const entry = from.get(tag);
      if (!entry || entry.type !== 2) return;
      const value = readAscii(entry.valueOffset, entry.count);
      if (value) info.fields.push({ key, value });
    };

    pushAscii(0x010f, "make", ifd0);
    pushAscii(0x0110, "model", ifd0);
    pushAscii(0x0131, "software", ifd0);
    pushAscii(0x0132, "dateTime", ifd0);

    const orientationEntry = ifd0.get(0x0112);
    if (orientationEntry && orientationEntry.type === 3) {
      info.orientation = u16(orientationEntry.valueOffset);
    }

    const exifPointer = ifd0.get(0x8769);
    if (exifPointer) {
      const exifIfd = readIfd(u32(exifPointer.valueOffset));
      pushAscii(0x9003, "dateTimeOriginal", exifIfd);
    }

    const gpsPointer = ifd0.get(0x8825);
    if (gpsPointer) {
      const gpsIfd = readIfd(u32(gpsPointer.valueOffset));
      if (gpsIfd.size > 0) info.hadGps = true;
      const latRef = gpsIfd.get(0x0001);
      const lat = gpsIfd.get(0x0002);
      const lonRef = gpsIfd.get(0x0003);
      const lon = gpsIfd.get(0x0004);
      if (latRef && lat && lonRef && lon) {
        const latParts = readRationals(lat.valueOffset, Math.min(lat.count, 3));
        const lonParts = readRationals(lon.valueOffset, Math.min(lon.count, 3));
        if (latParts.length === 3 && lonParts.length === 3) {
          const toDegrees = (p: number[]) => p[0] + p[1] / 60 + p[2] / 3600;
          const latDeg = toDegrees(latParts).toFixed(6);
          const lonDeg = toDegrees(lonParts).toFixed(6);
          const latHemisphere = readAscii(latRef.valueOffset, latRef.count) || "N";
          const lonHemisphere = readAscii(lonRef.valueOffset, lonRef.count) || "E";
          info.fields.push({
            key: "gps",
            value: `${latDeg}° ${latHemisphere}, ${lonDeg}° ${lonHemisphere}`,
          });
        }
      }
    }
  } catch {
    // Malformed EXIF: keep whatever was parsed before the failure.
  }
  return info;
}

/** Minimal APP1 EXIF segment carrying only the orientation tag. */
function buildOrientationSegment(orientation: number): Uint8Array {
  const payload = new Uint8Array(32);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const view = new DataView(payload.buffer, 6);
  payload.set([0x49, 0x49], 6); // "II" little-endian
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true); // IFD0 offset
  view.setUint16(8, 1, true); // one entry
  view.setUint16(10, 0x0112, true); // Orientation
  view.setUint16(12, 3, true); // SHORT
  view.setUint32(14, 1, true);
  view.setUint16(18, orientation, true);
  view.setUint32(22, 0, true); // no next IFD

  const segment = new Uint8Array(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = (payload.length + 2) >> 8;
  segment[3] = (payload.length + 2) & 0xff;
  segment.set(payload, 4);
  return segment;
}

function assemble(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function stripJpeg(bytes: Uint8Array, keepOrientation: boolean): StripResult {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  const removed = new Set<string>();
  let exifInfo: ExifInfo = { fields: [], hadGps: false, orientation: 1 };
  let offset = 2;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return failure("corrupt", bytes.length);
    const marker = bytes[offset + 1];

    // Fill bytes: 0xFF padding is allowed between segments.
    if (marker === 0xff) {
      parts.push(bytes.subarray(offset, offset + 1));
      offset += 1;
      continue;
    }

    // SOS: entropy-coded image data follows — copy the rest verbatim.
    if (marker === 0xda) {
      parts.push(bytes.subarray(offset));
      break;
    }
    if (offset + 4 > bytes.length) return failure("corrupt", bytes.length);
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return failure("corrupt", bytes.length);
    const segment = bytes.subarray(offset, offset + 2 + length);
    const payload = bytes.subarray(offset + 4, offset + 2 + length);

    let drop = false;
    if (marker === 0xe1) {
      const head = ascii(payload, 0, 29);
      if (head.startsWith("Exif\0\0")) {
        exifInfo = parseExif(payload.subarray(6));
        removed.add("exif");
        drop = true;
      } else if (head.startsWith("http://ns.adobe.com/x")) {
        // XMP and extended-XMP packets.
        removed.add("xmp");
        drop = true;
      }
    } else if (marker === 0xed) {
      if (ascii(payload, 0, 13) === "Photoshop 3.0") {
        removed.add("iptc");
        drop = true;
      }
    } else if (marker === 0xfe) {
      removed.add("comment");
      drop = true;
    }

    if (!drop) parts.push(segment);
    offset += 2 + length;
  }

  if (keepOrientation && exifInfo.orientation > 1) {
    // Re-insert a 36-byte EXIF holding only the orientation flag so photos
    // shot in portrait still display upright after the strip.
    const insertAfter = 1;
    parts.splice(insertAfter + 1, 0, buildOrientationSegment(exifInfo.orientation));
  }

  const cleaned = assemble(parts);
  return {
    ok: true,
    error: "",
    format: "jpeg",
    cleaned,
    originalBytes: bytes.length,
    cleanedBytes: cleaned.length,
    removed: [...removed],
    hadGps: exifInfo.hadGps,
    fields: exifInfo.fields,
  };
}

const PNG_STRIP_CHUNKS: Record<string, string> = {
  tEXt: "text",
  zTXt: "text",
  iTXt: "text",
  eXIf: "exif",
  tIME: "time",
};

function stripPng(bytes: Uint8Array): StripResult {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed = new Set<string>();
  let exifInfo: ExifInfo = { fields: [], hadGps: false, orientation: 1 };
  let offset = 8;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return failure("corrupt", bytes.length);
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const length = view.getUint32(0);
    const type = ascii(bytes, offset + 4, 4);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) return failure("corrupt", bytes.length);

    const strippedAs = PNG_STRIP_CHUNKS[type];
    if (strippedAs) {
      removed.add(strippedAs);
      if (type === "eXIf") {
        exifInfo = parseExif(bytes.subarray(offset + 8, offset + 8 + length));
      }
    } else {
      parts.push(bytes.subarray(offset, chunkEnd));
    }

    offset = chunkEnd;
    if (type === "IEND") break;
  }

  const cleaned = assemble(parts);
  return {
    ok: true,
    error: "",
    format: "png",
    cleaned,
    originalBytes: bytes.length,
    cleanedBytes: cleaned.length,
    removed: [...removed],
    hadGps: exifInfo.hadGps,
    fields: exifInfo.fields,
  };
}

/**
 * Remove metadata (EXIF, GPS, XMP, IPTC, comments, PNG text chunks) from a JPEG
 * or PNG file without re-encoding the image data.
 */
export function stripMetadata(
  bytes: Uint8Array,
  options?: { keepOrientation?: boolean },
): StripResult {
  if (bytes.length === 0) return failure("empty", 0);

  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return stripJpeg(bytes, options?.keepOrientation ?? true);
  }
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length > 8 && pngSignature.every((b, i) => bytes[i] === b)) {
    return stripPng(bytes);
  }
  return failure("unsupported", bytes.length);
}

export function getCleanFilename(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  if (dot <= 0) return `${originalName || "image"}-clean`;
  return `${originalName.slice(0, dot)}-clean${originalName.slice(dot)}`;
}
