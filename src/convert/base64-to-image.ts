export interface DecodedBase64Image {
  /** Whether the input decoded to something that looks like an image. */
  ok: boolean;
  /** Human-readable problem description, empty when ok. */
  error: string;
  /** MIME type, detected from the decoded bytes and falling back to the data URI prefix. */
  mime: string;
  /** File extension without a dot, e.g. "png". */
  extension: string;
  /** Clean Base64 payload with whitespace and any data URI prefix stripped. */
  base64: string;
  /** Full data URI, safe to assign to an <img> src. */
  dataUri: string;
  /** Decoded size in bytes. */
  bytes: number;
  /** Decoded size formatted for display, e.g. "48.2 KB". */
  size: string;
  /** True when the input already carried a data: prefix. */
  hadPrefix: boolean;
}

const EMPTY: DecodedBase64Image = {
  ok: false,
  error: "",
  mime: "",
  extension: "",
  base64: "",
  dataUri: "",
  bytes: 0,
  size: "0 B",
  hadPrefix: false,
};

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Reverse lookup table for Base64 characters, built once. */
const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  // URL-safe Base64 swaps + and / for - and _.
  table["-".charCodeAt(0)] = 62;
  table["_".charCodeAt(0)] = 63;
  return table;
})();

/**
 * Strip a data URI prefix, whitespace, and stray quotes from pasted Base64.
 * Returns the payload plus the MIME type the prefix claimed (empty if none).
 */
export function stripDataUriPrefix(input: string): {
  base64: string;
  declaredMime: string;
  hadPrefix: boolean;
} {
  let value = input.trim().replace(/^["']|["']$/g, "");

  // Tolerate a pasted CSS url(...) or HTML src="..." wrapper.
  const wrapped = /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(value);
  if (wrapped?.[1]) value = wrapped[1].trim();

  const prefix = /^data:([^;,]*)((?:;[^;,]*)*),/i.exec(value);
  if (prefix) {
    const payload = value.slice(prefix[0].length);
    return {
      base64: payload.replace(/\s+/g, ""),
      declaredMime: (prefix[1] || "").toLowerCase(),
      hadPrefix: true,
    };
  }

  return { base64: value.replace(/\s+/g, ""), declaredMime: "", hadPrefix: false };
}

/** Decode Base64 (standard or URL-safe) into raw bytes. Returns null on invalid input. */
export function decodeBase64(base64: string): Uint8Array | null {
  const clean = base64.replace(/=+$/, "");
  if (clean.length === 0) return null;

  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? B64_LOOKUP[code] : -1;
    if (value < 0) return null;

    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
    }
  }

  return out.subarray(0, outIndex);
}

/** Decoded byte length of a Base64 string without actually decoding it. */
export function base64Bytes(base64: string): number {
  const clean = base64.replace(/[^A-Za-z0-9+/\-_=]/g, "");
  if (clean.length === 0) return 0;
  const padding = /=+$/.exec(clean)?.[0].length ?? 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * Identify an image format from its magic bytes.
 * Returns an empty string when the bytes do not match a known image container.
 */
export function detectImageMime(bytes: Uint8Array): string {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp";
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }

  // ISO base media formats declare their brand in the ftyp box at offset 4.
  if (asciiAt(bytes, 4, 4) === "ftyp") {
    const brand = asciiAt(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand.startsWith("hei") || brand.startsWith("mif")) return "image/heic";
  }

  // SVG and other XML-ish payloads have no magic number, so sniff the text head.
  // A UTF-8 BOM is the three bytes EF BB BF (bytes are read one per char, so it is
  // never U+FEFF here); skip them before reading the text head.
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const head = asciiAt(bytes, bom, 300).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return "image/svg+xml";
  }

  return "";
}

/** Preferred file extension for an image MIME type. */
export function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    case "image/heic":
      return "heic";
    case "image/bmp":
      return "bmp";
    case "image/x-icon":
      return "ico";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

/** Human-readable byte size, e.g. 2048 → "2.0 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Turn a pasted Base64 string or data URI into an image-ready result.
 * Never throws — malformed input comes back with ok: false and a readable error.
 */
export function decodeBase64Image(input: string): DecodedBase64Image {
  if (!input.trim()) return { ...EMPTY };

  const { base64, declaredMime, hadPrefix } = stripDataUriPrefix(input);
  if (!base64) {
    return { ...EMPTY, error: "That data URI has no Base64 payload after the comma.", hadPrefix };
  }

  if (/[^A-Za-z0-9+/\-_=]/.test(base64)) {
    return {
      ...EMPTY,
      error: "The text contains characters that are not valid Base64. Check for stray markup.",
      hadPrefix,
    };
  }

  const bytes = decodeBase64(base64);
  if (!bytes || bytes.length === 0) {
    return { ...EMPTY, error: "Could not decode that Base64 string.", hadPrefix };
  }

  const sniffed = detectImageMime(bytes);
  const mime = sniffed || (declaredMime.startsWith("image/") ? declaredMime : "");

  if (!mime) {
    return {
      ...EMPTY,
      error:
        "The string decoded fine, but it is not a PNG, JPG, GIF, WebP, AVIF, BMP, ICO, or SVG image.",
      bytes: bytes.length,
      size: formatBytes(bytes.length),
      hadPrefix,
    };
  }

  return {
    ok: true,
    error: "",
    mime,
    extension: extensionForMime(mime),
    base64,
    dataUri: `data:${mime};base64,${base64}`,
    bytes: bytes.length,
    size: formatBytes(bytes.length),
    hadPrefix,
  };
}

/** Filename suggested for the download, e.g. "decoded-image.png". */
export function suggestFilename(extension: string): string {
  return `decoded-image.${extension || "bin"}`;
}
