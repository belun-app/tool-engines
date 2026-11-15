/**
 * HEIC / HEIF container reader.
 *
 * Browsers that can decode HEIC at all (Safari, and Chromium builds on systems that
 * expose an HEVC image decoder) hand the whole job to `createImageBitmap`. Everywhere
 * else the page still needs to say something useful about the file — real pixel size,
 * whether it is a tiled iPhone photo, whether there is a JPEG inside it that can be
 * pulled out without any HEVC decoder at all. That is what this module is for: it walks
 * the ISO base media file format boxes (ISO/IEC 14496-12) and the HEIF item structures
 * (ISO/IEC 23008-12) and reports what the container actually holds.
 *
 * No DOM, no decoding — the mount owns both.
 */

const utf8 = new TextDecoder();

interface Box {
  type: string;
  /** First byte of the box header. */
  start: number;
  /** One past the last byte of the box. */
  end: number;
  /** First byte after the header, i.e. where the payload starts. */
  payload: number;
}

function fourCC(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function readBoxes(bytes: Uint8Array, view: DataView, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = fourCC(bytes, p + 4);
    let payload = p + 8;
    if (size === 1) {
      if (p + 16 > end) break;
      // 64-bit size. Files this large never reach a browser tab, but the field is legal.
      size = view.getUint32(p + 8) * 2 ** 32 + view.getUint32(p + 12);
      payload = p + 16;
    } else if (size === 0) {
      // "Box runs to the end of the file" — only valid for the last top-level box.
      size = end - p;
    }
    // A box that claims more bytes than are left means a truncated or malformed file.
    // Dropping it is deliberate: parsing its remains yields plausible-looking garbage.
    if (size < payload - p || p + size > end) break;
    boxes.push({ type, start: p, end: p + size, payload });
    p += size;
  }
  return boxes;
}

const find = (boxes: Box[], type: string): Box | undefined => boxes.find((b) => b.type === type);

/** Reads a big-endian unsigned integer of 0, 1, 2, 4, or 8 bytes. */
function uint(view: DataView, at: number, size: number): number {
  switch (size) {
    case 0:
      return 0;
    case 1:
      return view.getUint8(at);
    case 2:
      return view.getUint16(at);
    case 4:
      return view.getUint32(at);
    case 8:
      return view.getUint32(at) * 2 ** 32 + view.getUint32(at + 4);
    default:
      return 0;
  }
}

/** Null-terminated UTF-8 string starting at `at`, bounded by `end`. */
function cString(bytes: Uint8Array, at: number, end: number): { text: string; next: number } {
  let p = at;
  while (p < end && bytes[p] !== 0) p++;
  return { text: utf8.decode(bytes.subarray(at, p)), next: Math.min(p + 1, end) };
}

export interface HeifItem {
  id: number;
  /** Four-character item type: "hvc1", "av01", "grid", "Exif", "jpeg", "mime", … */
  type: string;
  /** Item name from `infe`, usually empty on camera files. */
  name: string;
  /** Absolute file offset of the item's bytes, or an offset into `idat` when `inIdat`. */
  offset: number;
  length: number;
  /** HEIF construction method 1 — the bytes live in the `idat` box, not in `mdat`. */
  inIdat: boolean;
  /** Pixel size from `ispe`; 0 when the item has no spatial extent. */
  width: number;
  height: number;
  /** Clockwise degrees a viewer must apply, derived from `irot`. */
  rotation: number;
  /** -1 none, 0 mirrored across the vertical axis (left↔right), 1 across the horizontal. */
  mirrorAxis: -1 | 0 | 1;
  /** Bits per channel from `pixi`; 0 when absent. */
  bitDepth: number;
  /** Alpha / depth auxiliary planes are flagged by an `auxC` URN. */
  auxType: string;
  /** Hidden items are previews and auxiliary planes, not the picture itself. */
  hidden: boolean;
}

export interface EmbeddedJpeg {
  offset: number;
  length: number;
  width: number;
  height: number;
  /** "item" — a real `jpeg` item; "exif" — the thumbnail inside the EXIF IFD1. */
  source: "item" | "exif";
}

export interface HeicInfo {
  /** Major brand from `ftyp`: "heic", "heix", "mif1", "avif", … */
  brand: string;
  compatibleBrands: string[];
  /** True when the primary item is a still image this reader understood. */
  isHeif: boolean;
  codec: "hevc" | "av1" | "jpeg" | "unknown";
  primaryItemId: number;
  /** Display size in pixels, after the grid is assembled but before rotation. */
  width: number;
  height: number;
  /** Clockwise degrees a viewer must apply to the primary item. */
  rotation: number;
  mirrored: boolean;
  /** iPhone photos are stored as a grid of small HEVC tiles rather than one frame. */
  tiled: boolean;
  tileRows: number;
  tileColumns: number;
  /** Side of one tile in pixels, 0 when not tiled. */
  tileWidth: number;
  tileHeight: number;
  bitDepth: number;
  /** Coded picture items that are not previews or auxiliary planes. */
  imageCount: number;
  hasAlpha: boolean;
  hasDepth: boolean;
  hasExif: boolean;
  hasXmp: boolean;
  /** A `moov` box means the file also carries a video track. */
  hasVideoTrack: boolean;
  /** Best JPEG that can be pulled out with no HEVC decoder, if there is one. */
  embeddedJpeg: EmbeddedJpeg | null;
  items: HeifItem[];
}

/** Brands that mark a file as HEIF-structured still imagery. */
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "miaf",
  "mif2",
  "avif",
  "avis",
  "heif",
]);

const CODED_IMAGE_TYPES = new Set(["hvc1", "hev1", "av01", "jpeg", "j2ki", "vvc1"]);

/** Largest `ispe` extent treated as real; anything above it is a misparse. */
const MAX_SANE_SIDE = 65535;

const saneSide = (value: number) => (value > 0 && value <= MAX_SANE_SIDE ? value : 0);

const ALPHA_URN = "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha";
const DEPTH_URN = "urn:mpeg:mpegB:cicp:systems:auxiliary:depth";

interface Property {
  type: string;
  payload: number;
  end: number;
}

/**
 * Parses the HEIF container. Returns `null` for anything that is not an ISO base media
 * file — a JPEG renamed to `.heic`, a truncated download, a zip. Callers treat `null`
 * as "not a HEIC" and `isHeif: false` as "ISO container, but not still imagery".
 */
export function parseHeic(data: Uint8Array): HeicInfo | null {
  // A box can be well framed yet too short for the fields it should hold (a pitm with no
  // item_ID at the very end of the file); the DataView read then throws a RangeError.
  // Keep whatever was read up to that point instead of throwing at the caller.
  const partial: { info: HeicInfo | null } = { info: null };
  try {
    return parseHeicUnchecked(data, partial);
  } catch {
    return partial.info;
  }
}

function parseHeicUnchecked(data: Uint8Array, partial: { info: HeicInfo | null }): HeicInfo | null {
  if (data.length < 16) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const top = readBoxes(data, view, 0, data.length);
  const ftyp = find(top, "ftyp");
  // `ftyp` is mandatory and must come first; `styp` appears in segmented files.
  if (!ftyp || ftyp.start !== 0) return null;

  const brand = fourCC(data, ftyp.payload);
  const compatibleBrands: string[] = [];
  for (let p = ftyp.payload + 8; p + 4 <= ftyp.end; p += 4) {
    const cc = fourCC(data, p);
    if (/^[\x20-\x7e]{4}$/.test(cc)) compatibleBrands.push(cc);
  }

  const info: HeicInfo = {
    brand,
    compatibleBrands,
    isHeif: false,
    codec: "unknown",
    primaryItemId: 0,
    width: 0,
    height: 0,
    rotation: 0,
    mirrored: false,
    tiled: false,
    tileRows: 0,
    tileColumns: 0,
    tileWidth: 0,
    tileHeight: 0,
    bitDepth: 0,
    imageCount: 0,
    hasAlpha: false,
    hasDepth: false,
    hasExif: false,
    hasXmp: false,
    hasVideoTrack: Boolean(find(top, "moov")),
    embeddedJpeg: null,
    items: [],
  };
  partial.info = info;

  const meta = find(top, "meta");
  if (!meta) return info;
  // `meta` is a FullBox: four bytes of version and flags before the children.
  const metaBoxes = readBoxes(data, view, meta.payload + 4, meta.end);
  const idat = find(metaBoxes, "idat");

  // ---- pitm: which item is the picture -------------------------------------------
  const pitm = find(metaBoxes, "pitm");
  if (pitm) {
    const version = view.getUint8(pitm.payload);
    info.primaryItemId =
      version === 0 ? view.getUint16(pitm.payload + 4) : view.getUint32(pitm.payload + 4);
  }

  // ---- iinf / infe: the item table ------------------------------------------------
  const declared = new Map<number, { type: string; name: string; hidden: boolean }>();
  const iinf = find(metaBoxes, "iinf");
  if (iinf) {
    const version = view.getUint8(iinf.payload);
    let p = iinf.payload + 4;
    if (version === 0) {
      p += 2;
    } else {
      p += 4;
    }
    for (const infe of readBoxes(data, view, p, iinf.end)) {
      if (infe.type !== "infe") continue;
      const v = view.getUint8(infe.payload);
      const flags = uint(view, infe.payload + 1, 1) * 65536 + view.getUint16(infe.payload + 2);
      let q = infe.payload + 4;
      if (v < 2) continue; // Version 0/1 use `item_type`-less entries; no camera writes these.
      const id = v === 2 ? view.getUint16(q) : view.getUint32(q);
      q += v === 2 ? 2 : 4;
      q += 2; // item_protection_index
      const type = fourCC(data, q);
      q += 4;
      const { text: name } = cString(data, q, infe.end);
      // Flag bit 0 marks an item that must not be displayed on its own.
      declared.set(id, { type, name, hidden: (flags & 1) === 1 });
    }
  }

  // ---- iloc: where each item's bytes are ------------------------------------------
  const located = new Map<number, { offset: number; length: number; inIdat: boolean }>();
  const iloc = find(metaBoxes, "iloc");
  if (iloc) {
    const version = view.getUint8(iloc.payload);
    let p = iloc.payload + 4;
    const sizes = view.getUint8(p);
    const offsetSize = sizes >> 4;
    const lengthSize = sizes & 0x0f;
    const sizes2 = view.getUint8(p + 1);
    const baseOffsetSize = sizes2 >> 4;
    const indexSize = version === 1 || version === 2 ? sizes2 & 0x0f : 0;
    p += 2;
    const count = version < 2 ? view.getUint16(p) : view.getUint32(p);
    p += version < 2 ? 2 : 4;

    for (let i = 0; i < count && p < iloc.end; i++) {
      const id = version < 2 ? view.getUint16(p) : view.getUint32(p);
      p += version < 2 ? 2 : 4;
      let construction = 0;
      if (version === 1 || version === 2) {
        construction = view.getUint16(p) & 0x0f;
        p += 2;
      }
      p += 2; // data_reference_index — nonzero means the bytes live in another file.
      const baseOffset = uint(view, p, baseOffsetSize);
      p += baseOffsetSize;
      const extentCount = view.getUint16(p);
      p += 2;
      // Only the first extent is recorded: HEIF still items are contiguous in practice,
      // and a multi-extent item cannot be handed to the browser as one slice anyway.
      let offset = 0;
      let length = 0;
      for (let e = 0; e < extentCount; e++) {
        p += indexSize;
        const extOffset = uint(view, p, offsetSize);
        p += offsetSize;
        const extLength = uint(view, p, lengthSize);
        p += lengthSize;
        if (e === 0) {
          offset = baseOffset + extOffset;
          length = extLength;
        } else {
          length += extLength;
        }
      }
      located.set(id, { offset, length, inIdat: construction === 1 });
    }
  }

  // ---- iprp / ipco + ipma: properties per item ------------------------------------
  const properties: Property[] = [];
  const associations = new Map<number, number[]>();
  const iprp = find(metaBoxes, "iprp");
  if (iprp) {
    const iprpBoxes = readBoxes(data, view, iprp.payload, iprp.end);
    const ipco = find(iprpBoxes, "ipco");
    if (ipco) {
      for (const box of readBoxes(data, view, ipco.payload, ipco.end)) {
        properties.push({ type: box.type, payload: box.payload, end: box.end });
      }
    }
    for (const ipma of iprpBoxes) {
      if (ipma.type !== "ipma") continue;
      const version = view.getUint8(ipma.payload);
      const flags = view.getUint16(ipma.payload + 2);
      const wideIndex = (flags & 1) === 1;
      let p = ipma.payload + 4;
      const entries = view.getUint32(p);
      p += 4;
      for (let i = 0; i < entries && p < ipma.end; i++) {
        const id = version < 1 ? view.getUint16(p) : view.getUint32(p);
        p += version < 1 ? 2 : 4;
        const n = view.getUint8(p);
        p += 1;
        const list = associations.get(id) ?? [];
        for (let a = 0; a < n && p < ipma.end; a++) {
          if (wideIndex) {
            list.push(view.getUint16(p) & 0x7fff);
            p += 2;
          } else {
            list.push(view.getUint8(p) & 0x7f);
            p += 1;
          }
        }
        associations.set(id, list);
      }
    }
  }

  // ---- iref: grid membership and thumbnail links -----------------------------------
  const gridChildren = new Map<number, number[]>();
  const iref = find(metaBoxes, "iref");
  if (iref) {
    const version = view.getUint8(iref.payload);
    const wide = version !== 0;
    for (const ref of readBoxes(data, view, iref.payload + 4, iref.end)) {
      let p = ref.payload;
      const from = wide ? view.getUint32(p) : view.getUint16(p);
      p += wide ? 4 : 2;
      const count = view.getUint16(p);
      p += 2;
      const to: number[] = [];
      for (let i = 0; i < count && p < ref.end; i++) {
        to.push(wide ? view.getUint32(p) : view.getUint16(p));
        p += wide ? 4 : 2;
      }
      if (ref.type === "dimg") gridChildren.set(from, to);
    }
  }

  // ---- assemble the item list ------------------------------------------------------
  const ids = new Set<number>([...declared.keys(), ...located.keys()]);
  for (const id of [...ids].sort((a, b) => a - b)) {
    const decl = declared.get(id);
    const loc = located.get(id);
    const item: HeifItem = {
      id,
      type: decl?.type ?? "",
      name: decl?.name ?? "",
      offset: loc?.offset ?? 0,
      length: loc?.length ?? 0,
      inIdat: loc?.inIdat ?? false,
      width: 0,
      height: 0,
      rotation: 0,
      mirrorAxis: -1,
      bitDepth: 0,
      auxType: "",
      hidden: decl?.hidden ?? false,
    };

    for (const index of associations.get(id) ?? []) {
      const prop = properties[index - 1];
      if (!prop) continue;
      switch (prop.type) {
        case "ispe":
          if (prop.payload + 12 > prop.end) break;
          item.width = saneSide(view.getUint32(prop.payload + 4));
          item.height = saneSide(view.getUint32(prop.payload + 8));
          break;
        case "irot":
          // `irot` counts anti-clockwise quarter turns; viewers think in clockwise.
          if (prop.payload >= prop.end) break;
          item.rotation = (360 - (view.getUint8(prop.payload) & 0x03) * 90) % 360;
          break;
        case "imir":
          if (prop.payload >= prop.end) break;
          item.mirrorAxis = (view.getUint8(prop.payload) & 0x01) === 0 ? 0 : 1;
          break;
        case "pixi":
          if (prop.payload + 6 > prop.end) break;
          if (view.getUint8(prop.payload + 4) > 0) {
            item.bitDepth = view.getUint8(prop.payload + 5);
          }
          break;
        case "auxC":
          if (prop.payload + 4 >= prop.end) break;
          item.auxType = cString(data, prop.payload + 4, prop.end).text;
          break;
        default:
          break;
      }
    }

    if (item.auxType.startsWith(ALPHA_URN)) info.hasAlpha = true;
    if (item.auxType.startsWith(DEPTH_URN)) info.hasDepth = true;
    if (item.type === "Exif") info.hasExif = true;
    if (item.type === "mime" && item.name.toLowerCase().includes("xmp")) info.hasXmp = true;
    // A `grid` counts as one picture: its tiles are hidden items, not separate frames.
    const displayable = CODED_IMAGE_TYPES.has(item.type) || item.type === "grid";
    if (displayable && !item.hidden && !item.auxType) info.imageCount++;

    info.items.push(item);
  }

  // XMP is usually an unnamed `mime` item; fall back to the content type in the payload.
  if (!info.hasXmp) {
    info.hasXmp = info.items.some((i) => i.type === "mime");
  }

  const primary = info.items.find((i) => i.id === info.primaryItemId) ?? info.items[0];
  if (!primary) return info;

  info.isHeif = HEIF_BRANDS.has(brand) || compatibleBrands.some((b) => HEIF_BRANDS.has(b));
  info.rotation = primary.rotation;
  info.mirrored = primary.mirrorAxis >= 0;
  info.width = primary.width;
  info.height = primary.height;
  info.bitDepth = primary.bitDepth;

  if (primary.type === "grid") {
    info.tiled = true;
    const grid = readGrid(data, view, primary, idat);
    if (grid) {
      info.tileRows = grid.rows;
      info.tileColumns = grid.columns;
      if (saneSide(grid.width)) info.width = grid.width;
      if (saneSide(grid.height)) info.height = grid.height;
    }
    const tiles = gridChildren.get(primary.id) ?? [];
    const firstTile = info.items.find((i) => i.id === tiles[0]);
    if (firstTile) {
      info.tileWidth = firstTile.width;
      info.tileHeight = firstTile.height;
      if (!info.bitDepth) info.bitDepth = firstTile.bitDepth;
    }
    info.codec = codecOf(firstTile?.type ?? "");
  } else {
    info.codec = codecOf(primary.type);
  }

  info.embeddedJpeg = pickEmbeddedJpeg(data, view, info);
  return info;
}

function codecOf(itemType: string): HeicInfo["codec"] {
  if (itemType === "hvc1" || itemType === "hev1") return "hevc";
  if (itemType === "av01") return "av1";
  if (itemType === "jpeg") return "jpeg";
  return "unknown";
}

/**
 * The `grid` item's own bytes describe the mosaic: how many rows and columns of tiles,
 * and the size of the assembled picture. iPhone photos put these few bytes in `idat`.
 */
function readGrid(
  data: Uint8Array,
  view: DataView,
  item: HeifItem,
  idat: Box | undefined,
): { rows: number; columns: number; width: number; height: number } | null {
  const base = item.inIdat ? (idat ? idat.payload : -1) : 0;
  if (base < 0) return null;
  const at = base + item.offset;
  if (at + 8 > data.length) return null;
  const flags = view.getUint8(at + 1);
  const rows = view.getUint8(at + 2) + 1;
  const columns = view.getUint8(at + 3) + 1;
  const wide = (flags & 1) === 1;
  if (wide && at + 12 > data.length) return null;
  const width = wide ? view.getUint32(at + 4) : view.getUint16(at + 4);
  const height = wide ? view.getUint32(at + 8) : view.getUint16(at + 6);
  return { rows, columns, width, height };
}

const JPEG_SOI = 0xffd8;

/**
 * Finds a JPEG inside the container, largest first. Two places are worth looking:
 * a real `jpeg` item (some Android phones and most converters write a full-size one),
 * and the IFD1 thumbnail inside the EXIF block (Apple writes a small one). Neither
 * needs an HEVC decoder, which makes them the only usable fallback on a browser that
 * cannot open HEIC at all.
 */
function pickEmbeddedJpeg(data: Uint8Array, view: DataView, info: HeicInfo): EmbeddedJpeg | null {
  const candidates: EmbeddedJpeg[] = [];

  for (const item of info.items) {
    if (item.type !== "jpeg" || item.inIdat) continue;
    if (item.offset + 2 > data.length || item.length < 4) continue;
    if (view.getUint16(item.offset) !== JPEG_SOI) continue;
    candidates.push({
      offset: item.offset,
      length: Math.min(item.length, data.length - item.offset),
      width: item.width,
      height: item.height,
      source: "item",
    });
  }

  const exifItem = info.items.find((i) => i.type === "Exif" && !i.inIdat);
  if (exifItem) {
    const thumb = readExifThumbnail(data, view, exifItem.offset, exifItem.offset + exifItem.length);
    if (thumb) candidates.push(thumb);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.width * b.height - a.width * a.height || b.length - a.length);
  return candidates[0];
}

/**
 * Walks the TIFF structure of an HEIF `Exif` item down to IFD1 and returns the
 * JPEGInterchangeFormat thumbnail if there is one.
 */
function readExifThumbnail(
  data: Uint8Array,
  view: DataView,
  start: number,
  end: number,
): EmbeddedJpeg | null {
  if (start + 8 > end || end > data.length) return null;
  // The item begins with a 4-byte offset to the TIFF header, almost always zero.
  const tiff = start + 4 + view.getUint32(start);
  if (tiff + 8 > end) return null;

  const byteOrder = view.getUint16(tiff);
  const little = byteOrder === 0x4949;
  if (!little && byteOrder !== 0x4d4d) return null;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(tiff + 2) !== 0x002a) return null;

  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > end) return null;
  const entries0 = u16(ifd0);
  const nextPtr = ifd0 + 2 + entries0 * 12;
  if (nextPtr + 4 > end) return null;
  const nextOffset = u32(nextPtr);
  if (nextOffset === 0) return null;

  const ifd1 = tiff + nextOffset;
  if (ifd1 + 2 > end) return null;
  const entries1 = u16(ifd1);

  let offset = 0;
  let length = 0;
  let width = 0;
  let height = 0;
  for (let i = 0; i < entries1; i++) {
    const entry = ifd1 + 2 + i * 12;
    if (entry + 12 > end) break;
    const tag = u16(entry);
    const value = u32(entry + 8);
    if (tag === 0x0201) offset = tiff + value;
    else if (tag === 0x0202) length = value;
    else if (tag === 0x0100) width = value;
    else if (tag === 0x0101) height = value;
  }

  if (!offset || !length || offset + 2 > end) return null;
  if (view.getUint16(offset) !== JPEG_SOI) return null;
  return {
    offset,
    length: Math.min(length, data.length - offset),
    width,
    height,
    source: "exif",
  };
}

/** Slices out the embedded JPEG located by `parseHeic`. */
export function extractEmbeddedJpeg(data: Uint8Array, info: HeicInfo): Uint8Array | null {
  const jpeg = info.embeddedJpeg;
  if (!jpeg) return null;
  return data.subarray(jpeg.offset, jpeg.offset + jpeg.length);
}

/** File extensions the HEIF family travels under, lower-case, with the dot. */
export const HEIC_EXTENSIONS = [".heic", ".heif", ".heics", ".heifs", ".hif", ".avci"] as const;

/** Value for the `accept` attribute of the file input. */
export const HEIC_ACCEPT = ".heic,.heif,.hif,.avci,image/heic,image/heif,image/heic-sequence";

/**
 * Whether a picked file looks like HEIC. The MIME type is unreliable: Windows reports
 * an empty string for `.heic` unless the HEIF Image Extension is installed, and some
 * Android file pickers report `application/octet-stream`, so the extension decides.
 */
export function isHeicFile(name: string, mimeType = ""): boolean {
  const lower = name.toLowerCase();
  if (HEIC_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  const type = mimeType.toLowerCase();
  return type === "image/heic" || type === "image/heif" || type.startsWith("image/heic-sequence");
}

export type HeicOutputFormat = "jpeg" | "png" | "webp";

export interface HeicFormatOption {
  value: HeicOutputFormat;
  label: string;
  mime: string;
  ext: string;
  supportsQuality: boolean;
}

export const HEIC_FORMATS: HeicFormatOption[] = [
  { value: "jpeg", label: "JPG", mime: "image/jpeg", ext: "jpg", supportsQuality: true },
  { value: "png", label: "PNG", mime: "image/png", ext: "png", supportsQuality: false },
  { value: "webp", label: "WebP", mime: "image/webp", ext: "webp", supportsQuality: true },
];

export function heicFormat(value: string): HeicFormatOption {
  return HEIC_FORMATS.find((f) => f.value === value) ?? HEIC_FORMATS[0];
}

/** `IMG_4312.HEIC` + `jpg` → `IMG_4312.jpg`; `suffix` disambiguates name collisions. */
export function heicOutputName(originalName: string, ext: string, suffix = ""): string {
  const base = originalName.replace(/\.[^./\\]+$/, "").replace(/[/\\]/g, "-") || "image";
  return `${base}${suffix ? `-${suffix}` : ""}.${ext}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Megapixels to one decimal, the unit camera specs are quoted in. */
export function megapixels(width: number, height: number): number {
  return Math.round((width * height) / 100000) / 10;
}

/** Longest side a canvas is allowed to reach. */
export const MAX_CANVAS_SIDE = 8192;

/**
 * Total pixel budget for one canvas. Safari on iOS refuses to back a canvas larger than
 * about 16.7 million pixels and then quietly produces a blank bitmap instead of throwing,
 * which would turn a 48 MP ProRAW frame into a white JPG. Oversized frames are scaled
 * down before drawing instead.
 */
export const MAX_CANVAS_PIXELS = 16_777_216;

export function fitWithin(
  width: number,
  height: number,
  maxSide = MAX_CANVAS_SIDE,
  maxPixels = MAX_CANVAS_PIXELS,
): { width: number; height: number; scaled: boolean } {
  if (width <= 0 || height <= 0) return { width, height, scaled: false };
  const sideRatio = Math.min(1, maxSide / Math.max(width, height));
  const areaRatio = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const ratio = Math.min(sideRatio, areaRatio);
  if (ratio >= 1) return { width, height, scaled: false };
  let w = Math.max(1, Math.round(width * ratio));
  let h = Math.max(1, Math.round(height * ratio));
  // Rounding both sides up can overshoot the budget (8064×6048 -> 4730×3547 is 94 px over);
  // flooring both stays within it, since (width·ratio)·(height·ratio) <= maxPixels.
  if (w * h > maxPixels || Math.max(w, h) > maxSide) {
    w = Math.max(1, Math.floor(width * ratio));
    h = Math.max(1, Math.floor(height * ratio));
  }
  return { width: w, height: h, scaled: true };
}

export { buildZip, type ZipEntry } from "../_zip.js";
