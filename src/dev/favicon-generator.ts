/**
 * Favicon generator core — pure byte/string assembly, no DOM.
 *
 * The browser UI layer does the actual pixel work: it draws the text or source image onto a
 * canvas at each target size and hands the resulting PNG bytes back here. This module owns the
 * parts that have nothing to do with pixels: which sizes a site needs, how to pack several PNGs
 * into a single .ico, how to zip the whole set, and the <head> markup plus web app manifest that
 * ties the files together.
 */

import { segmentGraphemes, sliceGraphemes } from "../_graphemes.js";

export interface FaviconSize {
  /** Pixel dimension (square). */
  size: number;
  /** Output filename in the zip. */
  filename: string;
}

/** The full set of PNG sizes a modern site is expected to ship. */
export const FAVICON_SIZES: FaviconSize[] = [
  { size: 16, filename: "favicon-16x16.png" },
  { size: 32, filename: "favicon-32x32.png" },
  { size: 48, filename: "favicon-48x48.png" },
  { size: 64, filename: "favicon-64x64.png" },
  { size: 96, filename: "favicon-96x96.png" },
  { size: 120, filename: "favicon-120x120.png" },
  { size: 128, filename: "favicon-128x128.png" },
  { size: 180, filename: "apple-touch-icon.png" },
  { size: 192, filename: "android-chrome-192x192.png" },
  { size: 256, filename: "favicon-256x256.png" },
  { size: 512, filename: "android-chrome-512x512.png" },
];

/** The sizes packed into the multi-resolution favicon.ico. */
export const ICO_SIZES = [16, 32, 48];

export interface FaviconBundle {
  /** Multi-size favicon.ico bytes (16/32/48). */
  ico: Uint8Array;
  /** The complete downloadable zip. */
  zip: Uint8Array;
  /** Ready-to-paste <head> markup. */
  html: string;
  /** site.webmanifest contents. */
  manifest: string;
  /** Filenames included in the zip, in order. */
  files: string[];
}

/**
 * Pulls up to two initials out of a label. "belun.app" -> "BE", "My Cool Site" -> "MC",
 * "42" -> "42", "🚀 Rocket" -> "🚀" (an emoji is drawn on its own, whole).
 */
export function getInitials(text: string): string {
  let cleaned = text.trim();
  if (!cleaned) return "";

  // A domain name is one name, not two words: "belun.app" -> "belun", "www.example.com" -> "example".
  if (/^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u.test(cleaned)) {
    cleaned = cleaned.replace(/^www\./i, "").replace(/\.[^.]+$/, "");
  }

  // An emoji (with its skin tone, ZWJ parts or flag pair) is drawn alone: "🚀 Rocket" -> "🚀".
  const first = segmentGraphemes(cleaned)[0];
  if (EMOJI.test(first)) return first;

  const words = cleaned.split(/[\s._\-/]+/).filter(Boolean);
  if (words.length === 0) return sliceGraphemes(cleaned, 2).toUpperCase();

  if (words.length === 1) {
    // A single short token is shown whole (up to two characters): "42", "OK", "Go".
    return sliceGraphemes(words[0], 2).toUpperCase();
  }

  // Graphemes, not UTF-16 units, so an accent or emoji is never cut in half.
  return (sliceGraphemes(words[0], 1) + sliceGraphemes(words[1], 1)).toUpperCase();
}

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** Picks black or white text for the best contrast against a hex background. */
export function pickTextColor(bgHex: string): "#ffffff" | "#111111" {
  const hex = bgHex.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.padEnd(6, "0").slice(0, 6);

  const r = Number.parseInt(full.slice(0, 2), 16) || 0;
  const g = Number.parseInt(full.slice(2, 4), 16) || 0;
  const b = Number.parseInt(full.slice(4, 6), 16) || 0;

  // Perceived luminance (ITU-R BT.601). Bright backgrounds get dark text.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
}

/**
 * Packs a set of PNGs into a single .ico. Modern icon files may embed PNG data directly
 * (supported since Windows Vista), so each entry is stored as-is with no re-encoding.
 */
export function buildIco(images: Array<{ size: number; png: Uint8Array }>): Uint8Array {
  const entries = images.filter((img) => img.png.length > 0).slice(0, 255);
  const count = entries.length;

  const headerSize = 6;
  const dirSize = 16 * count;
  let offset = headerSize + dirSize;

  const total = offset + entries.reduce((sum, e) => sum + e.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  // ICONDIR
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: 1 = icon
  view.setUint16(4, count, true); // image count

  entries.forEach((entry, i) => {
    const dirAt = headerSize + i * 16;
    // 0 in the width/height byte means 256px.
    out[dirAt] = entry.size >= 256 ? 0 : entry.size;
    out[dirAt + 1] = entry.size >= 256 ? 0 : entry.size;
    out[dirAt + 2] = 0; // palette count
    out[dirAt + 3] = 0; // reserved
    view.setUint16(dirAt + 4, 1, true); // color planes
    view.setUint16(dirAt + 6, 32, true); // bits per pixel
    view.setUint32(dirAt + 8, entry.png.length, true); // bytes in image
    view.setUint32(dirAt + 12, offset, true); // offset from start of file

    out.set(entry.png, offset);
    offset += entry.png.length;
  });

  return out;
}

/** The <head> snippet that wires up every generated file. */
export function buildFaviconHtml(): string {
  return [
    // sizes="32x32", not "any": with "any" on the .ico, Chrome picks it over an SVG icon.
    '<link rel="icon" href="/favicon.ico" sizes="32x32">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="120x120" href="/favicon-120x120.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
  ].join("\n");
}

/**
 * The name shown under an installed app icon: at most 12 characters, cut at a word
 * boundary ("belun.app tools" -> "belun.app"), never the favicon's initials.
 */
export function shortName(name: string): string {
  const safe = name.trim();
  if (segmentGraphemes(safe).length <= 12) return safe;
  let out = "";
  for (const word of safe.split(/\s+/)) {
    const next = out ? `${out} ${word}` : word;
    if (segmentGraphemes(next).length > 12) break;
    out = next;
  }
  return out || sliceGraphemes(safe, 12);
}

/** The icon files the manifest points at, and how each is drawn. */
export const MANIFEST_ICONS = [
  /** Drawn like the favicon (shape and transparent corners): Android's "any" icon. */
  { size: 192, src: "/android-chrome-192x192.png", purpose: "any" },
  /**
   * Full-bleed square with the content inside the central 80 % safe zone, so Android can
   * cut it into a circle or a squircle without clipping the logo.
   */
  { size: 512, src: "/android-chrome-512x512.png", purpose: "maskable" },
] as const;

/** Sizes drawn as an opaque full square: iOS paints transparent corners black. */
export const OPAQUE_SIZES = [180, 512];

/**
 * A minimal PWA manifest. "any" and "maskable" are separate icons — the combined
 * "any maskable" value makes Chrome use one picture for two jobs and Lighthouse flags it.
 */
export function buildWebManifest(name: string, color = "#ffffff"): string {
  const safe = name.trim() || "My Site";
  const manifest = {
    name: safe,
    short_name: shortName(safe),
    icons: MANIFEST_ICONS.map((icon) => ({
      src: icon.src,
      sizes: `${icon.size}x${icon.size}`,
      type: "image/png",
      purpose: icon.purpose,
    })),
    theme_color: color,
    background_color: color,
    display: "standalone",
  };
  return JSON.stringify(manifest, null, 2);
}

/* ------------------------------------------------------------------ *
 * ZIP writer (stored / uncompressed)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Packs entries into a valid ZIP with no compression (stored). */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) =>
    Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    for (const part of [
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0x21),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      entry.data,
    ]) {
      chunks.push(part);
    }

    central.push(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0x21),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    );

    offset += 30 + nameBytes.length + size;
  }

  let centralSize = 0;
  for (const part of central) centralSize += part.length;

  const end: Uint8Array[] = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  ];

  const all = [...chunks, ...central, ...end];
  let totalLen = 0;
  for (const part of all) totalLen += part.length;

  const result = new Uint8Array(totalLen);
  let at = 0;
  for (const part of all) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

/**
 * Assembles the full downloadable bundle from PNGs rendered by the browser. `pngs` maps each
 * size in FAVICON_SIZES to its encoded bytes; sizes missing from the map are skipped. The .ico
 * is built from whichever of 16/32/48 are present.
 */
export function buildFaviconBundle(
  pngs: Map<number, Uint8Array>,
  siteName: string,
  color = "#ffffff",
): FaviconBundle {
  const icoImages = ICO_SIZES.filter((s) => pngs.has(s)).map((s) => ({
    size: s,
    png: pngs.get(s) as Uint8Array,
  }));
  const ico = buildIco(icoImages);
  const html = buildFaviconHtml();
  const manifest = buildWebManifest(siteName, color);

  const entries: ZipEntry[] = [{ name: "favicon.ico", data: ico }];
  for (const { size, filename } of FAVICON_SIZES) {
    const data = pngs.get(size);
    if (data) entries.push({ name: filename, data });
  }
  entries.push({ name: "site.webmanifest", data: new TextEncoder().encode(manifest) });
  entries.push({ name: "favicon-html-snippet.txt", data: new TextEncoder().encode(html) });

  const zip = buildZip(entries);

  return { ico, zip, html, manifest, files: entries.map((e) => e.name) };
}
