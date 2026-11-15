/**
 * Builds data URI, CSS and HTML snippets for a Base64-encoded image and computes the size
 * overhead of the encoding.
 */

export interface DataUriParts {
  /** MIME type, e.g. "image/png". */
  mime: string;
  /** The raw Base64 payload, without the "data:...;base64," prefix. */
  base64: string;
}

export interface ImageBase64Outputs {
  /** The full data URI: data:image/png;base64,AAAA… */
  dataUri: string;
  /** CSS background-image declaration. */
  css: string;
  /** HTML <img> tag. */
  html: string;
  /** Markdown image syntax. */
  markdown: string;
}

/** Split a data URI into its MIME type and Base64 payload. Returns null if malformed. */
export function parseDataUri(dataUri: string): DataUriParts | null {
  const match = /^data:([^;,]+)?(;charset=[^;,]+)?;base64,(.*)$/s.exec(dataUri.trim());
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const base64 = match[3] ?? "";
  return { mime, base64 };
}

/** Decoded byte length of a Base64 string, accounting for padding. */
export function base64Bytes(base64: string): number {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  if (clean.length === 0) return 0;
  const padding = clean.match(/=+$/)?.[0].length ?? 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** Number of Base64 characters produced when encoding `bytes` raw bytes. */
export function encodedLength(bytes: number): number {
  if (bytes <= 0) return 0;
  return Math.ceil(bytes / 3) * 4;
}

/** Percentage a Base64 string grows over the original binary (roughly +33%). */
export function sizeIncreasePercent(originalBytes: number, encodedChars: number): number {
  if (originalBytes <= 0) return 0;
  return Math.round(((encodedChars - originalBytes) / originalBytes) * 100);
}

/** Human-readable byte size, e.g. 2048 → "2 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Turn a data URI into ready-to-paste snippets for CSS, HTML, and Markdown.
 * `altText` and `filename` only affect the HTML/Markdown labels.
 */
export function buildOutputs(
  dataUri: string,
  altText = "",
  filename = "image",
): ImageBase64Outputs {
  const alt = altText.trim() || filename.replace(/\.[^.]+$/, "") || "image";
  return {
    dataUri,
    css: `background-image: url("${escapeCssString(dataUri)}");`,
    html: `<img src="${escapeHtmlAttr(dataUri)}" alt="${escapeHtmlAttr(alt)}" />`,
    markdown: `![${alt.replace(/[[\]]/g, "")}](${escapeMarkdownUrl(dataUri)})`,
  };
}

/** Escape a value for a double-quoted CSS string: backslash, quote and line breaks. */
function escapeCssString(value: string): string {
  return value.replace(/[\\"\n\r\f]/g, (c) =>
    c === "\\" || c === '"' ? `\\${c}` : `\\${c.charCodeAt(0).toString(16)} `,
  );
}

/** Percent-encode the characters that would end a Markdown link destination early. */
function escapeMarkdownUrl(value: string): string {
  return value.replace(
    /[\s()<>]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/** Escape the characters that would break out of an HTML attribute value. */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
