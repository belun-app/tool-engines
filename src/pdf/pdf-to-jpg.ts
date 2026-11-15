/**
 * Interprets a PDF page's content stream as a display list for drawing the page on a canvas.
 *
 * Reads a page's content stream and turns it into a flat display list — filled and stroked
 * paths, clips, positioned glyph runs, and decoded images — with every coordinate already
 * multiplied through the current transformation matrix. The mount replays that list onto a
 * canvas and encodes the result as JPEG or PNG.
 *
 * Splitting it this way keeps the renderer pure: matrix maths, colour conversion, sample
 * unpacking, and font metrics all live here, while the two things only a browser can do —
 * decoding a JPEG and drawing a glyph — are handled by the caller. Embedded font programs are
 * not rasterised; glyphs are drawn with a matching system font and positioned individually from
 * the font's own width table, so line breaks and column edges land where the PDF put them.
 */

import {
  type PVal,
  type PageEntry,
  type PdfDocument,
  type PdfInflate,
  buildZip,
  decodeStream,
  dictOf,
  formatFileSize,
  intOf,
  nameOf,
  pageRotation,
  parseDocument,
} from "./_pdf-lib.js";

export type { PdfInflate, PdfDocument, ZipEntry } from "./_pdf-lib.js";
export { formatFileSize, buildZip } from "./_pdf-lib.js";

type PDict = Extract<PVal, { k: "dict" }>;
type PStream = Extract<PVal, { k: "stream" }>;

export type Matrix = [number, number, number, number, number, number];

/* ------------------------------------------------------------------ *
 * Display list
 * ------------------------------------------------------------------ */

export type PathCmd =
  | { c: "m"; p: [number, number] }
  | { c: "l"; p: [number, number] }
  | { c: "b"; p: [number, number, number, number, number, number] }
  | { c: "h" };

export interface GlyphRun {
  /** Unicode text of a single glyph. */
  c: string;
  /** Offset along the baseline, in the run's text space. */
  x: number;
}

export type ImageSource =
  | { kind: "jpeg"; bytes: Uint8Array; alpha: AlphaChannel | null }
  | { kind: "rgba"; width: number; height: number; data: Uint8Array }
  | { kind: "stencil"; width: number; height: number; bits: Uint8Array; color: string };

export interface AlphaChannel {
  width: number;
  height: number;
  data: Uint8Array;
}

export type RenderOp =
  | { t: "save" }
  | { t: "restore" }
  | { t: "clip"; path: PathCmd[]; evenOdd: boolean }
  | { t: "fill"; path: PathCmd[]; color: string; alpha: number; evenOdd: boolean }
  | {
      t: "stroke";
      path: PathCmd[];
      color: string;
      alpha: number;
      width: number;
      cap: number;
      join: number;
      dash: number[];
      dashPhase: number;
    }
  | {
      t: "text";
      m: Matrix;
      size: number;
      hScale: number;
      rise: number;
      family: string;
      weight: string;
      style: string;
      fill: string | null;
      stroke: string | null;
      alpha: number;
      glyphs: GlyphRun[];
    }
  | { t: "image"; m: Matrix; alpha: number; image: ImageSource };

export interface RenderedPage {
  index: number;
  /** MediaBox as [x0, y0, x1, y1], normalised so x0 < x1 and y0 < y1. */
  viewBox: [number, number, number, number];
  rotate: number;
  ops: RenderOp[];
  /** True when the page produced no drawing operations at all. */
  blank: boolean;
}

export interface Viewport {
  width: number;
  height: number;
  transform: Matrix;
}

export interface PdfOpenResult {
  ok: boolean;
  error?: string;
  doc: PdfDocument | null;
  pageCount: number;
}

/* ------------------------------------------------------------------ *
 * Matrix helpers
 * ------------------------------------------------------------------ */

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Average scale factor of a matrix, used to convert user-space line widths to device space. */
function matrixScale(m: Matrix): number {
  const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
  return det > 0 ? Math.sqrt(det) : Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]), 1e-6);
}

/**
 * Canvas size and base transform for a page at a given scale, accounting for /Rotate.
 * Mirrors the viewport maths every PDF viewer uses: rotate about the page centre, then
 * flip the y axis so PDF's bottom-left origin lands on canvas's top-left one.
 */
export function pageViewport(page: RenderedPage, scale: number): Viewport {
  const [x0, y0, x1, y1] = page.viewBox;
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;

  let a: number;
  let b: number;
  let c: number;
  let d: number;
  if (page.rotate === 90) {
    a = 0;
    b = 1;
    c = 1;
    d = 0;
  } else if (page.rotate === 180) {
    a = -1;
    b = 0;
    c = 0;
    d = 1;
  } else if (page.rotate === 270) {
    a = 0;
    b = -1;
    c = -1;
    d = 0;
  } else {
    a = 1;
    b = 0;
    c = 0;
    d = -1;
  }

  const swapped = a === 0;
  const width = Math.abs(swapped ? y1 - y0 : x1 - x0) * scale;
  const height = Math.abs(swapped ? x1 - x0 : y1 - y0) * scale;
  const offsetX = swapped ? Math.abs(centerY - y0) * scale : Math.abs(centerX - x0) * scale;
  const offsetY = swapped ? Math.abs(centerX - x0) * scale : Math.abs(centerY - y0) * scale;

  return {
    width,
    height,
    transform: [
      a * scale,
      b * scale,
      c * scale,
      d * scale,
      offsetX - a * scale * centerX - c * scale * centerY,
      offsetY - b * scale * centerX - d * scale * centerY,
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Content stream lexer
 * ------------------------------------------------------------------ */

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: Uint8Array }
  | { t: "name"; v: string }
  | { t: "arr"; v: Tok[] }
  | { t: "dict"; v: Map<string, Tok> }
  | { t: "op"; v: string }
  | { t: "other" };

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isWsByte(c: number): boolean {
  return WS.has(c);
}

function isDelimByte(c: number): boolean {
  return DELIM.has(c);
}

function isDigitByte(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function hexVal(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x37;
  if (c >= 0x61 && c <= 0x66) return c - 0x57;
  return -1;
}

class ContentLexer {
  pos = 0;

  constructor(readonly buf: Uint8Array) {}

  skipWs(): void {
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos];
      if (isWsByte(c)) {
        this.pos++;
      } else if (c === 0x25) {
        while (
          this.pos < this.buf.length &&
          this.buf[this.pos] !== 0x0a &&
          this.buf[this.pos] !== 0x0d
        )
          this.pos++;
      } else {
        return;
      }
    }
  }

  literalString(): Uint8Array {
    const out: number[] = [];
    let depth = 0;
    this.pos++; // "("
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos++];
      if (c === 0x5c) {
        const e = this.buf[this.pos++];
        if (e === 0x6e) out.push(0x0a);
        else if (e === 0x72) out.push(0x0d);
        else if (e === 0x74) out.push(0x09);
        else if (e === 0x62) out.push(0x08);
        else if (e === 0x66) out.push(0x0c);
        else if (e >= 0x30 && e <= 0x37) {
          let code = e - 0x30;
          for (let k = 0; k < 2; k++) {
            const d = this.buf[this.pos];
            if (d === undefined || d < 0x30 || d > 0x37) break;
            code = code * 8 + (d - 0x30);
            this.pos++;
          }
          out.push(code & 0xff);
        } else if (e === 0x0a) {
          /* line continuation */
        } else if (e === 0x0d) {
          if (this.buf[this.pos] === 0x0a) this.pos++;
        } else if (e !== undefined) {
          out.push(e);
        }
        continue;
      }
      if (c === 0x28) {
        depth++;
        out.push(c);
        continue;
      }
      if (c === 0x29) {
        if (depth === 0) break;
        depth--;
        out.push(c);
        continue;
      }
      out.push(c);
    }
    return Uint8Array.from(out);
  }

  hexString(): Uint8Array {
    const out: number[] = [];
    this.pos++; // "<"
    let hi = -1;
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos++];
      if (c === 0x3e) break;
      const v = hexVal(c);
      if (v < 0) continue;
      if (hi < 0) hi = v;
      else {
        out.push((hi << 4) | v);
        hi = -1;
      }
    }
    if (hi >= 0) out.push(hi << 4);
    return Uint8Array.from(out);
  }

  name(): string {
    this.pos++; // "/"
    let s = "";
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos];
      if (isWsByte(c) || isDelimByte(c)) break;
      this.pos++;
      if (c === 0x23) {
        const a = hexVal(this.buf[this.pos]);
        const b = hexVal(this.buf[this.pos + 1]);
        if (a >= 0 && b >= 0) {
          s += String.fromCharCode((a << 4) | b);
          this.pos += 2;
          continue;
        }
      }
      s += String.fromCharCode(c);
    }
    return s;
  }

  /** Reads one token, or null at end of stream. */
  next(): Tok | null {
    this.skipWs();
    if (this.pos >= this.buf.length) return null;
    const c = this.buf[this.pos];

    if (c === 0x28) return { t: "str", v: this.literalString() };
    if (c === 0x3c) {
      if (this.buf[this.pos + 1] === 0x3c) return { t: "dict", v: this.dict() };
      return { t: "str", v: this.hexString() };
    }
    if (c === 0x2f) return { t: "name", v: this.name() };
    if (c === 0x5b) return { t: "arr", v: this.array() };
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.pos++;
      return { t: "other" };
    }
    if (c === 0x2b || c === 0x2d || c === 0x2e || isDigitByte(c)) {
      const start = this.pos;
      this.pos++;
      while (this.pos < this.buf.length) {
        const d = this.buf[this.pos];
        if (!isDigitByte(d) && d !== 0x2e && d !== 0x2d && d !== 0x2b && d !== 0x65 && d !== 0x45)
          break;
        this.pos++;
      }
      const parsed = Number.parseFloat(latin1(this.buf, start, this.pos));
      return { t: "num", v: Number.isFinite(parsed) ? parsed : 0 };
    }

    const start = this.pos;
    while (this.pos < this.buf.length) {
      const d = this.buf[this.pos];
      if (isWsByte(d) || isDelimByte(d)) break;
      this.pos++;
    }
    if (this.pos === start) {
      this.pos++;
      return { t: "other" };
    }
    return { t: "op", v: latin1(this.buf, start, this.pos) };
  }

  array(): Tok[] {
    this.pos++; // "["
    const items: Tok[] = [];
    while (this.pos < this.buf.length) {
      this.skipWs();
      if (this.buf[this.pos] === 0x5d) {
        this.pos++;
        break;
      }
      const tok = this.next();
      if (tok === null) break;
      items.push(tok);
    }
    return items;
  }

  dict(): Map<string, Tok> {
    this.pos += 2; // "<<"
    const map = new Map<string, Tok>();
    while (this.pos < this.buf.length) {
      this.skipWs();
      if (this.buf[this.pos] === 0x3e && this.buf[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      if (this.buf[this.pos] !== 0x2f) {
        const skip = this.next();
        if (skip === null) break;
        continue;
      }
      const key = this.name();
      const value = this.next();
      if (value === null) break;
      map.set(key, value);
    }
    return map;
  }
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

type CsKind = "gray" | "rgb" | "cmyk" | "indexed" | "pattern" | "other";

interface ColorSpaceInfo {
  kind: CsKind;
  components: number;
  /** Indexed palettes only: RGB triplets, one per index. */
  palette?: Uint8Array;
  /** Indexed palettes only: colour space of the palette entries. */
  baseComponents?: number;
}

const CS_GRAY: ColorSpaceInfo = { kind: "gray", components: 1 };
const CS_RGB: ColorSpaceInfo = { kind: "rgb", components: 3 };
const CS_CMYK: ColorSpaceInfo = { kind: "cmyk", components: 4 };

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  return [
    clamp255(255 * (1 - Math.min(1, c + k))),
    clamp255(255 * (1 - Math.min(1, m + k))),
    clamp255(255 * (1 - Math.min(1, y + k))),
  ];
}

function rgbCss(r: number, g: number, b: number): string {
  return `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})`;
}

function colorFromComponents(cs: ColorSpaceInfo, comps: number[]): string {
  if (cs.kind === "indexed" && cs.palette) {
    const base = cs.baseComponents ?? 3;
    const index = Math.max(0, Math.round(comps[0] ?? 0));
    const at = index * base;
    if (base === 3) return rgbCss(cs.palette[at], cs.palette[at + 1], cs.palette[at + 2]);
    if (base === 1) return rgbCss(cs.palette[at], cs.palette[at], cs.palette[at]);
    const [r, g, b] = cmykToRgb(
      cs.palette[at] / 255,
      cs.palette[at + 1] / 255,
      cs.palette[at + 2] / 255,
      cs.palette[at + 3] / 255,
    );
    return rgbCss(r, g, b);
  }
  if (comps.length >= 4 && cs.kind === "cmyk") {
    const [r, g, b] = cmykToRgb(comps[0], comps[1], comps[2], comps[3]);
    return rgbCss(r, g, b);
  }
  if (comps.length >= 3) return rgbCss(comps[0] * 255, comps[1] * 255, comps[2] * 255);
  if (comps.length === 1) {
    // Separation and DeviceN inks run 0 (no ink) to 1 (full ink); grey runs the other way.
    const v = cs.kind === "other" ? 1 - comps[0] : comps[0];
    return rgbCss(v * 255, v * 255, v * 255);
  }
  return "rgb(0,0,0)";
}

/* ------------------------------------------------------------------ *
 * Font metrics and mapping
 * ------------------------------------------------------------------ */

// Widths (1/1000 em) for ASCII 32–126 in Helvetica and Times-Roman, the two metric families
// almost every non-embedded font falls back to. Without these, unembedded text drifts badly.
// From the Adobe Core 14 AFM files (see THIRD_PARTY_NOTICES.md).
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const TIMES_WIDTHS = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611,
  556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722,
  722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500,
  278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
];

/** Courier and other monospaced faces: every glyph is 600/1000 em. */
const COURIER_WIDTHS: number[] = new Array(95).fill(600);

interface FontInfo {
  family: string;
  weight: string;
  style: string;
  twoByte: boolean;
  toUnicode: Map<number, string> | null;
  differences: Map<number, string> | null;
  widths: Map<number, number>;
  defaultWidth: number;
  fallbackWidths: number[];
  /** Icon and dingbat fonts render as gibberish with a substitute face, so we skip them. */
  skip: boolean;
}

const DEFAULT_FONT: FontInfo = {
  family: "Helvetica, Arial, sans-serif",
  weight: "normal",
  style: "normal",
  twoByte: false,
  toUnicode: null,
  differences: null,
  widths: new Map(),
  defaultWidth: 500,
  fallbackWidths: HELVETICA_WIDTHS,
  skip: false,
};

function classifyFont(baseFont: string, flags: number, italicAngle: number) {
  const name = baseFont.replace(/^[A-Z]{6}\+/, "");
  const lower = name.toLowerCase();
  const serifFlag = (flags & 2) !== 0;
  const fixedFlag = (flags & 1) !== 0;

  let family = "Helvetica, Arial, sans-serif";
  let fallbackWidths = HELVETICA_WIDTHS;
  if (fixedFlag || /courier|mono|consol/.test(lower)) {
    family = '"Courier New", Courier, monospace';
    fallbackWidths = COURIER_WIDTHS;
  } else if (/times|serif|georgia|garamond|book|roman|minion|cambria/.test(lower) || serifFlag) {
    family = '"Times New Roman", Times, serif';
    fallbackWidths = TIMES_WIDTHS;
  }

  const weight =
    /bold|black|heavy|semibold|demi/.test(lower) || (flags & 0x40000) !== 0 ? "bold" : "normal";
  const style = /italic|oblique/.test(lower) || italicAngle !== 0 ? "italic" : "normal";
  const skip = /symbol|dingbat|wingding|webding|fontawesome|glyphicon|icomoon/.test(lower);

  return { family, weight, style, fallbackWidths, skip };
}

// WinAnsiEncoding (CP1252): 0x20–0x7E and 0xA0–0xFF are identity; only 0x80–0x9F needs a table.
const CP1252_HIGH: Record<number, number> = {
  128: 0x20ac,
  130: 0x201a,
  131: 0x0192,
  132: 0x201e,
  133: 0x2026,
  134: 0x2020,
  135: 0x2021,
  136: 0x02c6,
  137: 0x2030,
  138: 0x0160,
  139: 0x2039,
  140: 0x0152,
  142: 0x017d,
  145: 0x2018,
  146: 0x2019,
  147: 0x201c,
  148: 0x201d,
  149: 0x2022,
  150: 0x2013,
  151: 0x2014,
  152: 0x02dc,
  153: 0x2122,
  154: 0x0161,
  155: 0x203a,
  156: 0x0153,
  158: 0x017e,
  159: 0x0178,
};

function winAnsiChar(code: number): string {
  if (code === 0) return "";
  if (code >= 0x20 && code <= 0x7e) return String.fromCharCode(code);
  if (code >= 0x80 && code <= 0x9f) {
    const u = CP1252_HIGH[code];
    return u ? String.fromCharCode(u) : "";
  }
  if (code >= 0xa0 && code <= 0xff) return String.fromCharCode(code);
  return "";
}

/** The handful of glyph names worth resolving without shipping the full Adobe glyph list. */
const GLYPH_NAMES: Record<string, string> = {
  space: " ",
  quotesingle: "'",
  quotedbl: '"',
  quoteleft: "‘",
  quoteright: "’",
  quotedblleft: "“",
  quotedblright: "”",
  endash: "–",
  emdash: "—",
  bullet: "•",
  ellipsis: "…",
  fi: "ﬁ",
  fl: "ﬂ",
  hyphen: "-",
  periodcentered: "·",
  degree: "°",
  minus: "−",
  trademark: "™",
  copyright: "©",
  registered: "®",
  euro: "€",
  dagger: "†",
};

function glyphNameToChar(name: string): string | null {
  if (GLYPH_NAMES[name]) return GLYPH_NAMES[name];
  if (name.length === 1) return name;
  const uni = name.match(/^uni([0-9A-Fa-f]{4})$/);
  if (uni) return String.fromCharCode(Number.parseInt(uni[1], 16));
  const u = name.match(/^u([0-9A-Fa-f]{4,6})$/);
  if (u) return String.fromCodePoint(Number.parseInt(u[1], 16));
  return null;
}

function parseHexCode(hex: string): number {
  return Number.parseInt(hex, 16);
}

function utf16beToString(hex: string): string {
  let s = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    s += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  }
  if (s === "" && hex.length >= 2)
    s = String.fromCharCode(Number.parseInt(hex.slice(0, 4).padEnd(4, "0"), 16));
  return s;
}

function parseToUnicode(text: string): { map: Map<number, string>; twoByte: boolean } {
  const map = new Map<number, string>();
  let twoByte = false;

  const csr = text.match(/begincodespacerange([\s\S]*?)endcodespacerange/);
  if (csr) {
    const m = csr[1].match(/<([0-9A-Fa-f]+)>/);
    if (m && m[1].length >= 4) twoByte = true;
  }

  const hex = /<([0-9A-Fa-f]+)>/g;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const nums = [...block[1].matchAll(hex)].map((x) => x[1]);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (nums[i].length >= 4) twoByte = true;
      map.set(parseHexCode(nums[i]), utf16beToString(nums[i + 1]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const re = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    let e: RegExpExecArray | null = re.exec(block[1]);
    while (e !== null) {
      const lo = parseHexCode(e[1]);
      const hi = parseHexCode(e[2]);
      if (e[1].length >= 4) twoByte = true;
      if (e[3] !== undefined) {
        const base = e[3];
        for (let code = lo, k = 0; code <= hi && k < 65536; code++, k++) {
          const val = (parseHexCode(base) + k).toString(16).padStart(base.length, "0");
          map.set(code, utf16beToString(val));
        }
      } else if (e[4] !== undefined) {
        const items = [...e[4].matchAll(hex)].map((x) => x[1]);
        for (let k = 0; k < items.length && lo + k <= hi; k++)
          map.set(lo + k, utf16beToString(items[k]));
      }
      e = re.exec(block[1]);
    }
  }
  return { map, twoByte };
}

/* ------------------------------------------------------------------ *
 * Stream filters the shared core does not cover
 * ------------------------------------------------------------------ */

function filterNames(d: PDict): string[] {
  const f = d.v.get("Filter");
  if (!f) return [];
  if (f.k === "name") return [f.v];
  if (f.k === "arr")
    return f.v.filter((x): x is Extract<PVal, { k: "name" }> => x.k === "name").map((x) => x.v);
  return [];
}

function decodeAscii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let tuple = 0;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 0x7e) break; // "~>"
    if (isWsByte(c)) continue;
    if (c === 0x7a && count === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 0x21 || c > 0x75) continue;
    tuple = tuple * 85 + (c - 0x21);
    count++;
    if (count === 5) {
      out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }
  if (count > 0) {
    for (let i = count; i < 5; i++) tuple = tuple * 85 + 84;
    const bytes = [
      (tuple >>> 24) & 0xff,
      (tuple >>> 16) & 0xff,
      (tuple >>> 8) & 0xff,
      tuple & 0xff,
    ];
    for (let i = 0; i < count - 1; i++) out.push(bytes[i]);
  }
  return Uint8Array.from(out);
}

function decodeAsciiHex(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let hi = -1;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 0x3e) break;
    const v = hexVal(c);
    if (v < 0) continue;
    if (hi < 0) hi = v;
    else {
      out.push((hi << 4) | v);
      hi = -1;
    }
  }
  if (hi >= 0) out.push(hi << 4);
  return Uint8Array.from(out);
}

function decodeRunLength(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const len = data[i++];
    if (len === 128) break;
    if (len < 128) {
      for (let k = 0; k <= len && i < data.length; k++) out.push(data[i++]);
    } else {
      const b = data[i++];
      for (let k = 0; k < 257 - len; k++) out.push(b);
    }
  }
  return Uint8Array.from(out);
}

/** LZW as used by PDF (variable code width, early change by default). */
function decodeLzw(data: Uint8Array, earlyChange: number): Uint8Array {
  const out: number[] = [];
  const dict: number[][] = [];
  const reset = () => {
    dict.length = 0;
    for (let i = 0; i < 256; i++) dict.push([i]);
    dict.push([]); // 256 clear
    dict.push([]); // 257 eod
  };
  reset();

  let codeWidth = 9;
  let prev: number[] | null = null;
  let bitBuf = 0;
  let bitCount = 0;

  for (let i = 0; i <= data.length; i++) {
    if (i < data.length) {
      bitBuf = (bitBuf << 8) | data[i];
      bitCount += 8;
    } else if (bitCount < codeWidth) {
      break;
    }
    while (bitCount >= codeWidth) {
      const code = (bitBuf >> (bitCount - codeWidth)) & ((1 << codeWidth) - 1);
      bitCount -= codeWidth;

      if (code === 256) {
        reset();
        codeWidth = 9;
        prev = null;
        continue;
      }
      if (code === 257) return Uint8Array.from(out);

      let entry: number[];
      if (code < dict.length && dict[code].length > 0) entry = dict[code];
      else if (code < 256) entry = [code];
      else if (prev) entry = [...prev, prev[0]];
      else return Uint8Array.from(out);

      for (const b of entry) out.push(b);
      if (prev) dict.push([...prev, entry[0]]);
      prev = entry;

      const limit = dict.length + earlyChange;
      if (limit >= 512 && codeWidth === 9) codeWidth = 10;
      else if (limit >= 1024 && codeWidth === 10) codeWidth = 11;
      else if (limit >= 2048 && codeWidth === 11) codeWidth = 12;
    }
  }
  return Uint8Array.from(out);
}

function applyPredictor(
  data: Uint8Array,
  predictor: number,
  colors: number,
  bpc: number,
  columns: number,
): Uint8Array | null {
  if (predictor < 2) return data;
  // /Colors and /Columns come straight from the file: positive integers only, and a row is
  // never allocated before it is known to fit the data, or a hostile /Columns would make
  // this allocate gigabytes for a few bytes of input.
  if (!Number.isInteger(colors) || colors < 1 || colors > 32) return null;
  if (bpc !== 1 && bpc !== 2 && bpc !== 4 && bpc !== 8 && bpc !== 16) return null;
  if (!Number.isInteger(columns) || columns < 1) return null;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);

  if (predictor === 2) {
    if (bpc !== 8) return data;
    const out = new Uint8Array(data);
    const rows = Math.floor(out.length / rowLen);
    for (let r = 0; r < rows; r++) {
      const base = r * rowLen;
      for (let i = bpp; i < rowLen; i++)
        out[base + i] = (out[base + i] + out[base + i - bpp]) & 0xff;
    }
    return out;
  }

  const rows = Math.floor(data.length / (rowLen + 1));
  if (rows === 0) return new Uint8Array(0);
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const tag = data[r * (rowLen + 1)];
    const src = data.subarray(r * (rowLen + 1) + 1, r * (rowLen + 1) + 1 + rowLen);
    const row = new Uint8Array(rowLen);
    for (let i = 0; i < rowLen; i++) {
      const raw = src[i];
      const left = i >= bpp ? row[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      let value: number;
      if (tag === 1) value = raw + left;
      else if (tag === 2) value = raw + up;
      else if (tag === 3) value = raw + ((left + up) >> 1);
      else if (tag === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else value = raw;
      row[i] = value & 0xff;
    }
    out.set(row, r * rowLen);
    prev = row;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Renderer
 * ------------------------------------------------------------------ */

interface GState {
  ctm: Matrix;
  fill: string;
  stroke: string;
  fillCs: ColorSpaceInfo;
  strokeCs: ColorSpaceInfo;
  fillAlpha: number;
  strokeAlpha: number;
  lineWidth: number;
  lineCap: number;
  lineJoin: number;
  dash: number[];
  dashPhase: number;
  font: FontInfo | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
  renderMode: number;
}

function cloneState(s: GState): GState {
  return { ...s, dash: [...s.dash] };
}

const MAX_OPS = 300000;

class PageRenderer {
  ops: RenderOp[] = [];
  private objects: Map<number, PVal>;
  private inflate: PdfInflate;
  private fontCache = new Map<string, FontInfo>();
  private truncated = false;

  constructor(doc: PdfDocument, inflate: PdfInflate) {
    this.objects = doc.objects;
    this.inflate = inflate;
  }

  private resolve(v: PVal | undefined): PVal | undefined {
    let cur = v;
    for (let i = 0; i < 32 && cur?.k === "ref"; i++) cur = this.objects.get(cur.n);
    return cur;
  }

  private numOf(d: PDict | null, key: string, fallback: number): number {
    const v = this.resolve(d?.v.get(key));
    return v?.k === "num" ? v.v : fallback;
  }

  private emit(op: RenderOp): void {
    if (this.ops.length >= MAX_OPS) {
      this.truncated = true;
      return;
    }
    this.ops.push(op);
  }

  /* ---------------- colour spaces ---------------- */

  private async colorSpace(
    value: PVal | undefined,
    resources: PDict | null,
  ): Promise<ColorSpaceInfo> {
    const v = this.resolve(value);
    if (!v) return CS_GRAY;

    if (v.k === "name") {
      const name = v.v;
      if (name === "DeviceGray" || name === "G" || name === "CalGray") return CS_GRAY;
      if (name === "DeviceRGB" || name === "RGB" || name === "CalRGB") return CS_RGB;
      if (name === "DeviceCMYK" || name === "CMYK") return CS_CMYK;
      if (name === "Pattern") return { kind: "pattern", components: 1 };
      const table = dictOf(this.resolve(resources?.v.get("ColorSpace")));
      const named = table?.v.get(name);
      if (named) return this.colorSpace(named, null);
      return CS_GRAY;
    }

    if (v.k === "arr" && v.v.length > 0) {
      const head = this.resolve(v.v[0]);
      const family = head?.k === "name" ? head.v : "";

      if (family === "ICCBased") {
        const stream = this.resolve(v.v[1]);
        const n = stream?.k === "stream" ? (intOf(stream.d, "N") ?? 3) : 3;
        if (n === 1) return CS_GRAY;
        if (n === 4) return CS_CMYK;
        return CS_RGB;
      }
      if (family === "CalRGB" || family === "Lab") return CS_RGB;
      if (family === "CalGray") return CS_GRAY;
      if (family === "Pattern") return { kind: "pattern", components: 1 };
      if (family === "Separation" || family === "DeviceN") {
        const names = this.resolve(v.v[1]);
        const count = family === "DeviceN" && names?.k === "arr" ? names.v.length : 1;
        return { kind: "other", components: count };
      }
      if (family === "Indexed" || family === "I") {
        const base = await this.colorSpace(v.v[1], resources);
        const lookup = this.resolve(v.v[3]);
        let raw: Uint8Array | null = null;
        if (lookup?.k === "str") raw = lookup.v;
        else if (lookup?.k === "stream") raw = await decodeStream(lookup, this.inflate);
        const baseComponents = base.kind === "cmyk" ? 4 : base.kind === "gray" ? 1 : 3;
        return {
          kind: "indexed",
          components: 1,
          palette: raw ?? new Uint8Array(0),
          baseComponents,
        };
      }
      return this.colorSpace(v.v[0], resources);
    }

    return CS_GRAY;
  }

  /* ---------------- fonts ---------------- */

  private async loadFont(key: string, fontRef: PVal | undefined): Promise<FontInfo> {
    const cached = this.fontCache.get(key);
    if (cached) return cached;

    const font = dictOf(this.resolve(fontRef));
    if (!font) {
      this.fontCache.set(key, DEFAULT_FONT);
      return DEFAULT_FONT;
    }

    const subtype = nameOf(font, "Subtype");
    const isType0 = subtype === "Type0";
    const descendant = isType0
      ? dictOf(
          this.resolve(
            (this.resolve(font.v.get("DescendantFonts")) as PVal | undefined)?.k === "arr"
              ? (this.resolve(font.v.get("DescendantFonts")) as Extract<PVal, { k: "arr" }>).v[0]
              : undefined,
          ),
        )
      : null;
    const metricsSource = descendant ?? font;

    const descriptor = dictOf(this.resolve(metricsSource.v.get("FontDescriptor")));
    const flags = intOf(descriptor, "Flags") ?? 0;
    const italicAngle = this.numOf(descriptor, "ItalicAngle", 0);
    const baseName = nameOf(font, "BaseFont") ?? nameOf(metricsSource, "BaseFont") ?? "Helvetica";
    const classified = classifyFont(baseName, flags, italicAngle);

    let toUnicode: Map<number, string> | null = null;
    let twoByte = isType0;
    const tu = this.resolve(font.v.get("ToUnicode"));
    if (tu?.k === "stream") {
      const data = await decodeStream(tu, this.inflate);
      if (data) {
        try {
          const parsed = parseToUnicode(latin1(data, 0, data.length));
          if (parsed.map.size > 0) {
            toUnicode = parsed.map;
            twoByte = twoByte || parsed.twoByte;
          }
        } catch {
          /* malformed CMap — fall back to the encoding */
        }
      }
    }

    // /Differences remaps individual codes to glyph names for simple fonts.
    let differences: Map<number, string> | null = null;
    const encoding = this.resolve(font.v.get("Encoding"));
    const encDict = dictOf(encoding);
    const diffArr = this.resolve(encDict?.v.get("Differences"));
    if (diffArr?.k === "arr") {
      differences = new Map();
      let code = 0;
      for (const item of diffArr.v) {
        const el = this.resolve(item);
        if (el?.k === "num") code = Math.round(el.v);
        else if (el?.k === "name") differences.set(code++, el.v);
      }
    }

    const widths = new Map<number, number>();
    let defaultWidth = this.numOf(descriptor, "MissingWidth", 0);

    if (isType0 && descendant) {
      defaultWidth = this.numOf(descendant, "DW", 1000);
      const w = this.resolve(descendant.v.get("W"));
      if (w?.k === "arr") {
        const items = w.v.map((x) => this.resolve(x));
        let i = 0;
        while (i < items.length) {
          const first = items[i];
          if (first?.k !== "num") break;
          const next = items[i + 1];
          if (next?.k === "arr") {
            let code = Math.round(first.v);
            for (const entry of next.v) {
              const e = this.resolve(entry);
              if (e?.k === "num") widths.set(code, e.v);
              code++;
            }
            i += 2;
          } else if (next?.k === "num") {
            const third = items[i + 2];
            if (third?.k !== "num") break;
            const lo = Math.round(first.v);
            const hi = Math.round(next.v);
            for (let code = lo; code <= hi && code - lo < 65536; code++) widths.set(code, third.v);
            i += 3;
          } else break;
        }
      }
    } else {
      const firstChar = intOf(font, "FirstChar") ?? 0;
      const w = this.resolve(font.v.get("Widths"));
      if (w?.k === "arr") {
        w.v.forEach((item, i) => {
          const e = this.resolve(item);
          if (e?.k === "num") widths.set(firstChar + i, e.v);
        });
      }
    }

    const info: FontInfo = {
      family: classified.family,
      weight: classified.weight,
      style: classified.style,
      twoByte,
      toUnicode,
      differences,
      widths,
      defaultWidth: defaultWidth || (isType0 ? 1000 : 0),
      fallbackWidths: classified.fallbackWidths,
      skip: classified.skip || subtype === "Type3",
    };
    this.fontCache.set(key, info);
    return info;
  }

  private charFor(font: FontInfo, code: number): string {
    if (font.toUnicode) {
      const mapped = font.toUnicode.get(code);
      if (mapped !== undefined) return mapped;
    }
    if (font.differences) {
      const name = font.differences.get(code);
      if (name) {
        const ch = glyphNameToChar(name);
        if (ch !== null) return ch;
      }
    }
    if (font.twoByte) return "";
    return winAnsiChar(code);
  }

  private widthFor(font: FontInfo, code: number, ch: string): number {
    const explicit = font.widths.get(code);
    if (explicit !== undefined) return explicit;
    if (font.defaultWidth > 0) return font.defaultWidth;
    const point = ch.charCodeAt(0);
    if (point >= 32 && point <= 126) return font.fallbackWidths[point - 32];
    return font.fallbackWidths === COURIER_WIDTHS ? 600 : 500;
  }

  /* ---------------- images ---------------- */

  private async imageBytes(stream: PStream): Promise<{ data: Uint8Array; jpeg: boolean } | null> {
    const filters = filterNames(stream.d);
    if (filters.length === 0) return { data: stream.raw, jpeg: false };

    const last = filters[filters.length - 1];
    if (last === "JPXDecode" || last === "JBIG2Decode" || last === "CCITTFaxDecode") return null;
    if (last === "DCTDecode" || last === "DCT") {
      // A DCT image is handed to the browser untouched; only a leading ASCII armour matters.
      let data = stream.raw;
      for (const f of filters.slice(0, -1)) {
        if (f === "ASCII85Decode" || f === "A85") data = decodeAscii85(data);
        else if (f === "ASCIIHexDecode" || f === "AHx") data = decodeAsciiHex(data);
        else return null;
      }
      return { data, jpeg: true };
    }

    let data = stream.raw;
    for (const f of filters) {
      if (f === "FlateDecode" || f === "Fl") {
        try {
          data = await this.inflate(data);
        } catch {
          return null;
        }
      } else if (f === "LZWDecode" || f === "LZW") {
        const parms = dictOf(this.resolve(stream.d.v.get("DecodeParms") ?? stream.d.v.get("DP")));
        data = decodeLzw(data, intOf(parms, "EarlyChange") ?? 1);
      } else if (f === "ASCII85Decode" || f === "A85") data = decodeAscii85(data);
      else if (f === "ASCIIHexDecode" || f === "AHx") data = decodeAsciiHex(data);
      else if (f === "RunLengthDecode" || f === "RL") data = decodeRunLength(data);
      else return null;
    }

    const parmsVal = this.resolve(stream.d.v.get("DecodeParms") ?? stream.d.v.get("DP"));
    const parms = dictOf(
      parmsVal?.k === "arr" ? this.resolve(parmsVal.v[parmsVal.v.length - 1]) : parmsVal,
    );
    const predictor = intOf(parms, "Predictor") ?? 1;
    if (predictor > 1) {
      const predicted = applyPredictor(
        data,
        predictor,
        intOf(parms, "Colors") ?? 1,
        intOf(parms, "BitsPerComponent") ?? 8,
        intOf(parms, "Columns") ?? 1,
      );
      if (!predicted) return null;
      data = predicted;
    }
    return { data, jpeg: false };
  }

  /** Reads one sample of `bpc` bits from a packed, row-aligned buffer. */
  private static sample(data: Uint8Array, rowStart: number, index: number, bpc: number): number {
    if (bpc === 8) return data[rowStart + index] ?? 0;
    if (bpc === 16) return data[rowStart + index * 2] ?? 0;
    const bitPos = index * bpc;
    const byte = data[rowStart + (bitPos >> 3)] ?? 0;
    const shift = 8 - bpc - (bitPos & 7);
    return (byte >> shift) & ((1 << bpc) - 1);
  }

  private async alphaFrom(stream: PStream): Promise<AlphaChannel | null> {
    const width = intOf(stream.d, "Width") ?? 0;
    const height = intOf(stream.d, "Height") ?? 0;
    if (width <= 0 || height <= 0) return null;
    const decoded = await this.imageBytes(stream);
    if (!decoded || decoded.jpeg) return null;

    const bpc = intOf(stream.d, "BitsPerComponent") ?? 8;
    const max = (1 << Math.min(bpc, 8)) - 1;
    const rowBytes = Math.ceil((width * bpc) / 8);
    const out = new Uint8Array(width * height);
    const decode = this.resolve(stream.d.v.get("Decode"));
    const inverted = decode?.k === "arr" && decode.v[0]?.k === "num" && decode.v[0].v === 1;

    for (let y = 0; y < height; y++) {
      const rowStart = y * rowBytes;
      for (let x = 0; x < width; x++) {
        const raw = PageRenderer.sample(decoded.data, rowStart, x, bpc);
        const v = bpc === 16 ? raw : Math.round((raw / max) * 255);
        out[y * width + x] = inverted ? 255 - v : v;
      }
    }
    return { width, height, data: out };
  }

  private async decodeImage(
    stream: PStream,
    resources: PDict | null,
    fillColor: string,
  ): Promise<ImageSource | null> {
    const width = intOf(stream.d, "Width") ?? 0;
    const height = intOf(stream.d, "Height") ?? 0;
    if (width <= 0 || height <= 0 || width * height > 50_000_000) return null;

    const isMask = this.resolve(stream.d.v.get("ImageMask"));
    if (isMask?.k === "bool" && isMask.v) {
      const decoded = await this.imageBytes(stream);
      if (!decoded || decoded.jpeg) return null;
      const rowBytes = Math.ceil(width / 8);
      const bits = new Uint8Array(width * height);
      const decode = this.resolve(stream.d.v.get("Decode"));
      const invert = decode?.k === "arr" && decode.v[0]?.k === "num" && decode.v[0].v === 1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const bit = PageRenderer.sample(decoded.data, y * rowBytes, x, 1);
          // Sample 0 paints by default; /Decode [1 0] flips that.
          bits[y * width + x] = (invert ? bit === 1 : bit === 0) ? 1 : 0;
        }
      }
      return { kind: "stencil", width, height, bits, color: fillColor };
    }

    const decoded = await this.imageBytes(stream);
    if (!decoded) return null;

    let alpha: AlphaChannel | null = null;
    const smask = this.resolve(stream.d.v.get("SMask"));
    if (smask?.k === "stream") alpha = await this.alphaFrom(smask);
    if (!alpha) {
      const mask = this.resolve(stream.d.v.get("Mask"));
      if (mask?.k === "stream") {
        const stencil = await this.alphaFrom(mask);
        // A stencil mask marks the pixels to hide, so its sense is the opposite of an SMask.
        if (stencil) {
          for (let i = 0; i < stencil.data.length; i++) stencil.data[i] = 255 - stencil.data[i];
          alpha = stencil;
        }
      }
    }

    if (decoded.jpeg) return { kind: "jpeg", bytes: decoded.data, alpha };

    const cs = await this.colorSpace(
      stream.d.v.get("ColorSpace") ?? stream.d.v.get("CS"),
      resources,
    );
    const bpc = intOf(stream.d, "BitsPerComponent") ?? 8;
    const comps = cs.kind === "indexed" ? 1 : cs.components;
    const rowBytes = Math.ceil((width * comps * bpc) / 8);
    if (decoded.data.length < rowBytes) return null;

    const max = (1 << Math.min(bpc, 8)) - 1;
    const out = new Uint8Array(width * height * 4);
    const decodeArr = this.resolve(stream.d.v.get("Decode"));
    const flip = decodeArr?.k === "arr" && decodeArr.v[0]?.k === "num" && decodeArr.v[0].v === 1;

    for (let y = 0; y < height; y++) {
      const rowStart = y * rowBytes;
      for (let x = 0; x < width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        if (cs.kind === "indexed" && cs.palette) {
          const idx = PageRenderer.sample(decoded.data, rowStart, x, bpc);
          const base = cs.baseComponents ?? 3;
          const at = idx * base;
          if (base === 1) {
            r = g = b = cs.palette[at] ?? 0;
          } else if (base === 4) {
            const [cr, cg, cb] = cmykToRgb(
              (cs.palette[at] ?? 0) / 255,
              (cs.palette[at + 1] ?? 0) / 255,
              (cs.palette[at + 2] ?? 0) / 255,
              (cs.palette[at + 3] ?? 0) / 255,
            );
            r = cr;
            g = cg;
            b = cb;
          } else {
            r = cs.palette[at] ?? 0;
            g = cs.palette[at + 1] ?? 0;
            b = cs.palette[at + 2] ?? 0;
          }
        } else if (comps === 1) {
          const raw = PageRenderer.sample(decoded.data, rowStart, x, bpc);
          const v = bpc === 16 ? raw : (raw / max) * 255;
          // Separation/DeviceN samples are ink amounts (1 = full ink, dark), the opposite of
          // grey — the same rule fillColor applies to fills in these spaces.
          const ink = cs.kind === "other";
          r = g = b = flip !== ink ? 255 - v : v;
        } else if (comps === 3) {
          const base = x * 3;
          r = (PageRenderer.sample(decoded.data, rowStart, base, bpc) / max) * 255;
          g = (PageRenderer.sample(decoded.data, rowStart, base + 1, bpc) / max) * 255;
          b = (PageRenderer.sample(decoded.data, rowStart, base + 2, bpc) / max) * 255;
        } else if (comps === 4) {
          const base = x * 4;
          const [cr, cg, cb] = cmykToRgb(
            PageRenderer.sample(decoded.data, rowStart, base, bpc) / max,
            PageRenderer.sample(decoded.data, rowStart, base + 1, bpc) / max,
            PageRenderer.sample(decoded.data, rowStart, base + 2, bpc) / max,
            PageRenderer.sample(decoded.data, rowStart, base + 3, bpc) / max,
          );
          r = cr;
          g = cg;
          b = cb;
        } else {
          const raw = PageRenderer.sample(decoded.data, rowStart, x * comps, bpc);
          r = g = b = 255 - (raw / max) * 255;
        }

        let a = 255;
        if (alpha) {
          const ax = Math.min(alpha.width - 1, Math.floor((x * alpha.width) / width));
          const ay = Math.min(alpha.height - 1, Math.floor((y * alpha.height) / height));
          a = alpha.data[ay * alpha.width + ax];
        }
        const at = (y * width + x) * 4;
        out[at] = clamp255(r);
        out[at + 1] = clamp255(g);
        out[at + 2] = clamp255(b);
        out[at + 3] = a;
      }
    }

    return { kind: "rgba", width, height, data: out };
  }

  /* ---------------- content stream execution ---------------- */

  async run(
    content: Uint8Array,
    resources: PDict | null,
    state: GState,
    depth: number,
  ): Promise<void> {
    if (depth > 12 || this.truncated) return;

    const lexer = new ContentLexer(content);
    const stack: Tok[] = [];
    const gsStack: GState[] = [];
    let gs = state;

    let path: PathCmd[] = [];
    let startX = 0;
    let startY = 0;
    let curX = 0;
    let curY = 0;
    let pendingClip: false | "nz" | "eo" = false;

    let tm: Matrix = IDENTITY;
    let tlm: Matrix = IDENTITY;

    const num = (i: number): number => {
      const tok = stack[i];
      return tok?.t === "num" ? tok.v : 0;
    };
    const numsFromEnd = (count: number): number[] => {
      const out: number[] = [];
      for (let i = count; i >= 1; i--) out.push(num(stack.length - i));
      return out;
    };

    const moveTo = (x: number, y: number) => {
      const p = apply(gs.ctm, x, y);
      path.push({ c: "m", p });
      startX = x;
      startY = y;
      curX = x;
      curY = y;
    };
    const lineTo = (x: number, y: number) => {
      path.push({ c: "l", p: apply(gs.ctm, x, y) });
      curX = x;
      curY = y;
    };
    const curveTo = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      const a = apply(gs.ctm, x1, y1);
      const b = apply(gs.ctm, x2, y2);
      const c = apply(gs.ctm, x3, y3);
      path.push({ c: "b", p: [a[0], a[1], b[0], b[1], c[0], c[1]] });
      curX = x3;
      curY = y3;
    };

    const endPath = () => {
      if (pendingClip !== false && path.length > 0) {
        this.emit({ t: "clip", path, evenOdd: pendingClip === "eo" });
      }
      pendingClip = false;
      path = [];
    };

    const paint = (fill: boolean, stroke: boolean, evenOdd: boolean, close: boolean) => {
      if (close && path.length > 0) path.push({ c: "h" });
      if (path.length > 0) {
        if (fill && gs.fillAlpha > 0.004) {
          this.emit({ t: "fill", path, color: gs.fill, alpha: gs.fillAlpha, evenOdd });
        }
        if (stroke && gs.strokeAlpha > 0.004) {
          const scale = matrixScale(gs.ctm);
          this.emit({
            t: "stroke",
            path,
            color: gs.stroke,
            alpha: gs.strokeAlpha,
            width: Math.max(gs.lineWidth * scale, 0.35),
            cap: gs.lineCap,
            join: gs.lineJoin,
            dash: gs.dash.map((d) => d * scale),
            dashPhase: gs.dashPhase * scale,
          });
        }
      }
      endPath();
    };

    const showText = (bytes: Uint8Array, adjustments: Array<{ at: number; by: number }> = []) => {
      const font = gs.font ?? DEFAULT_FONT;
      if (font.skip || gs.renderMode === 3 || gs.renderMode === 7) {
        // Invisible text (the OCR layer of a scanned page) still has to advance the matrix.
        tm = mul([1, 0, 0, 1, this.advanceOnly(bytes, gs, font, adjustments), 0], tm);
        return;
      }

      const runMatrix = mul(tm, gs.ctm);
      const glyphs: GlyphRun[] = [];
      const step = font.twoByte ? 2 : 1;
      let x = 0;
      let index = 0;
      let nextAdj = 0;

      for (let i = 0; i + step - 1 < bytes.length; i += step) {
        while (nextAdj < adjustments.length && adjustments[nextAdj].at <= index) {
          x += (-adjustments[nextAdj].by / 1000) * gs.fontSize * gs.hScale;
          nextAdj++;
        }
        const code = step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
        const ch = this.charFor(font, code);
        if (ch && ch !== " " && ch !== " ") glyphs.push({ c: ch, x });

        const w = this.widthFor(font, code, ch || " ") / 1000;
        const wordSpace = step === 1 && code === 32 ? gs.wordSpacing : 0;
        x += (w * gs.fontSize + gs.charSpacing + wordSpace) * gs.hScale;
        index++;
      }
      while (nextAdj < adjustments.length) {
        x += (-adjustments[nextAdj].by / 1000) * gs.fontSize * gs.hScale;
        nextAdj++;
      }

      if (glyphs.length > 0) {
        const strokeOnly = gs.renderMode === 1 || gs.renderMode === 5;
        this.emit({
          t: "text",
          m: runMatrix,
          size: gs.fontSize,
          hScale: gs.hScale,
          rise: gs.rise,
          family: font.family,
          weight: font.weight,
          style: font.style,
          fill: strokeOnly ? null : gs.fill,
          stroke:
            gs.renderMode === 1 || gs.renderMode === 2 || gs.renderMode === 5 ? gs.stroke : null,
          alpha: gs.fillAlpha,
          glyphs,
        });
      }
      tm = mul([1, 0, 0, 1, x, 0], tm);
    };

    while (this.ops.length < MAX_OPS) {
      const tok = lexer.next();
      if (tok === null) break;
      if (tok.t !== "op") {
        stack.push(tok);
        if (stack.length > 64) stack.shift();
        continue;
      }

      switch (tok.v) {
        case "q":
          gsStack.push(cloneState(gs));
          this.emit({ t: "save" });
          break;
        case "Q": {
          const restored = gsStack.pop();
          if (restored) gs = restored;
          this.emit({ t: "restore" });
          break;
        }
        case "cm": {
          const [a, b, c, d, e, f] = numsFromEnd(6);
          gs.ctm = mul([a, b, c, d, e, f], gs.ctm);
          break;
        }
        case "w":
          gs.lineWidth = num(stack.length - 1);
          break;
        case "J":
          gs.lineCap = num(stack.length - 1);
          break;
        case "j":
          gs.lineJoin = num(stack.length - 1);
          break;
        case "d": {
          const arr = stack[stack.length - 2];
          gs.dash =
            arr?.t === "arr"
              ? arr.v.filter((x): x is { t: "num"; v: number } => x.t === "num").map((x) => x.v)
              : [];
          if (gs.dash.every((x) => x === 0)) gs.dash = [];
          gs.dashPhase = num(stack.length - 1);
          break;
        }
        case "gs": {
          const nameTok = stack[stack.length - 1];
          if (nameTok?.t === "name") {
            const extg = dictOf(this.resolve(resources?.v.get("ExtGState")));
            const entry = dictOf(this.resolve(extg?.v.get(nameTok.v)));
            if (entry) {
              const ca = this.resolve(entry.v.get("ca"));
              if (ca?.k === "num") gs.fillAlpha = ca.v;
              const CA = this.resolve(entry.v.get("CA"));
              if (CA?.k === "num") gs.strokeAlpha = CA.v;
              const lw = this.resolve(entry.v.get("LW"));
              if (lw?.k === "num") gs.lineWidth = lw.v;
            }
          }
          break;
        }

        case "m":
          moveTo(num(stack.length - 2), num(stack.length - 1));
          break;
        case "l":
          lineTo(num(stack.length - 2), num(stack.length - 1));
          break;
        case "c": {
          const [x1, y1, x2, y2, x3, y3] = numsFromEnd(6);
          curveTo(x1, y1, x2, y2, x3, y3);
          break;
        }
        case "v": {
          const [x2, y2, x3, y3] = numsFromEnd(4);
          curveTo(curX, curY, x2, y2, x3, y3);
          break;
        }
        case "y": {
          const [x1, y1, x3, y3] = numsFromEnd(4);
          curveTo(x1, y1, x3, y3, x3, y3);
          break;
        }
        case "h":
          if (path.length > 0) {
            path.push({ c: "h" });
            curX = startX;
            curY = startY;
          }
          break;
        case "re": {
          const [x, y, w, h] = numsFromEnd(4);
          moveTo(x, y);
          lineTo(x + w, y);
          lineTo(x + w, y + h);
          lineTo(x, y + h);
          path.push({ c: "h" });
          curX = x;
          curY = y;
          break;
        }

        case "S":
          paint(false, true, false, false);
          break;
        case "s":
          paint(false, true, false, true);
          break;
        case "f":
        case "F":
          paint(true, false, false, false);
          break;
        case "f*":
          paint(true, false, true, false);
          break;
        case "B":
          paint(true, true, false, false);
          break;
        case "B*":
          paint(true, true, true, false);
          break;
        case "b":
          paint(true, true, false, true);
          break;
        case "b*":
          paint(true, true, true, true);
          break;
        case "n":
          endPath();
          break;
        case "W":
          pendingClip = "nz";
          break;
        case "W*":
          pendingClip = "eo";
          break;

        case "g":
          gs.fillCs = CS_GRAY;
          gs.fill = colorFromComponents(CS_GRAY, [num(stack.length - 1)]);
          break;
        case "G":
          gs.strokeCs = CS_GRAY;
          gs.stroke = colorFromComponents(CS_GRAY, [num(stack.length - 1)]);
          break;
        case "rg":
          gs.fillCs = CS_RGB;
          gs.fill = colorFromComponents(CS_RGB, numsFromEnd(3));
          break;
        case "RG":
          gs.strokeCs = CS_RGB;
          gs.stroke = colorFromComponents(CS_RGB, numsFromEnd(3));
          break;
        case "k":
          gs.fillCs = CS_CMYK;
          gs.fill = colorFromComponents(CS_CMYK, numsFromEnd(4));
          break;
        case "K":
          gs.strokeCs = CS_CMYK;
          gs.stroke = colorFromComponents(CS_CMYK, numsFromEnd(4));
          break;
        case "cs":
        case "CS": {
          const nameTok = stack[stack.length - 1];
          const cs =
            nameTok?.t === "name"
              ? await this.colorSpace({ k: "name", v: nameTok.v }, resources)
              : CS_GRAY;
          const initial = cs.kind === "cmyk" ? "rgb(0,0,0)" : "rgb(0,0,0)";
          if (tok.v === "cs") {
            gs.fillCs = cs;
            gs.fill = initial;
          } else {
            gs.strokeCs = cs;
            gs.stroke = initial;
          }
          break;
        }
        case "sc":
        case "scn":
        case "SC":
        case "SCN": {
          const isFill = tok.v === "sc" || tok.v === "scn";
          const cs = isFill ? gs.fillCs : gs.strokeCs;
          const comps: number[] = [];
          for (const item of stack) if (item.t === "num") comps.push(item.v);
          let color: string;
          if (comps.length === 0 || cs.kind === "pattern") {
            // Tiling and shading patterns are not rasterised; mid grey reads better than black.
            color = "rgb(128,128,128)";
          } else {
            color = colorFromComponents(cs, comps.slice(-Math.max(1, cs.components)));
          }
          if (isFill) gs.fill = color;
          else gs.stroke = color;
          break;
        }

        case "BT":
          tm = IDENTITY;
          tlm = IDENTITY;
          break;
        case "ET":
          break;
        case "Tf": {
          const nameTok = stack[stack.length - 2];
          gs.fontSize = num(stack.length - 1);
          if (nameTok?.t === "name") {
            const fontRes = dictOf(this.resolve(resources?.v.get("Font")));
            gs.font = await this.loadFont(
              `${nameTok.v}:${depth}:${fontRes ? "r" : "-"}`,
              fontRes?.v.get(nameTok.v),
            );
          }
          break;
        }
        case "Td": {
          const [tx, ty] = numsFromEnd(2);
          tlm = mul([1, 0, 0, 1, tx, ty], tlm);
          tm = tlm;
          break;
        }
        case "TD": {
          const [tx, ty] = numsFromEnd(2);
          gs.leading = -ty;
          tlm = mul([1, 0, 0, 1, tx, ty], tlm);
          tm = tlm;
          break;
        }
        case "Tm": {
          const [a, b, c, d, e, f] = numsFromEnd(6);
          tlm = [a, b, c, d, e, f];
          tm = tlm;
          break;
        }
        case "T*":
          tlm = mul([1, 0, 0, 1, 0, -gs.leading], tlm);
          tm = tlm;
          break;
        case "TL":
          gs.leading = num(stack.length - 1);
          break;
        case "Tc":
          gs.charSpacing = num(stack.length - 1);
          break;
        case "Tw":
          gs.wordSpacing = num(stack.length - 1);
          break;
        case "Tz":
          gs.hScale = num(stack.length - 1) / 100;
          break;
        case "Ts":
          gs.rise = num(stack.length - 1);
          break;
        case "Tr":
          gs.renderMode = Math.round(num(stack.length - 1));
          break;
        case "Tj": {
          const s = stack[stack.length - 1];
          if (s?.t === "str") showText(s.v);
          break;
        }
        case "'": {
          tlm = mul([1, 0, 0, 1, 0, -gs.leading], tlm);
          tm = tlm;
          const s = stack[stack.length - 1];
          if (s?.t === "str") showText(s.v);
          break;
        }
        case '"': {
          gs.wordSpacing = num(stack.length - 3);
          gs.charSpacing = num(stack.length - 2);
          tlm = mul([1, 0, 0, 1, 0, -gs.leading], tlm);
          tm = tlm;
          const s = stack[stack.length - 1];
          if (s?.t === "str") showText(s.v);
          break;
        }
        case "TJ": {
          const arr = stack[stack.length - 1];
          if (arr?.t === "arr") {
            // Flatten the array into one run: bytes concatenated, kerning recorded by index.
            const chunks: Uint8Array[] = [];
            const adjustments: Array<{ at: number; by: number }> = [];
            const step = (gs.font ?? DEFAULT_FONT).twoByte ? 2 : 1;
            let count = 0;
            for (const el of arr.v) {
              if (el.t === "str") {
                chunks.push(el.v);
                count += Math.floor(el.v.length / step);
              } else if (el.t === "num") {
                adjustments.push({ at: count, by: el.v });
              }
            }
            let total = 0;
            for (const c of chunks) total += c.length;
            const joined = new Uint8Array(total);
            let at = 0;
            for (const c of chunks) {
              joined.set(c, at);
              at += c.length;
            }
            showText(joined, adjustments);
          }
          break;
        }

        case "Do": {
          const nameTok = stack[stack.length - 1];
          if (nameTok?.t === "name") {
            const xobjects = dictOf(this.resolve(resources?.v.get("XObject")));
            const target = this.resolve(xobjects?.v.get(nameTok.v));
            if (target?.k === "stream") {
              const subtype = nameOf(target.d, "Subtype");
              if (subtype === "Image") {
                const image = await this.decodeImage(target, resources, gs.fill);
                if (image) this.emit({ t: "image", m: gs.ctm, alpha: gs.fillAlpha, image });
              } else if (subtype === "Form") {
                await this.runForm(target, resources, gs, depth);
              }
            }
          }
          break;
        }

        case "BI": {
          await this.inlineImage(lexer, resources, gs);
          break;
        }

        case "sh":
        case "BX":
        case "EX":
        case "MP":
        case "DP":
        case "BMC":
        case "BDC":
        case "EMC":
        case "d0":
        case "d1":
        case "ri":
        case "i":
        case "M":
          break;

        default:
          break;
      }

      stack.length = 0;
    }
  }

  /** Advance for text that is not drawn, so following runs still land in the right place. */
  private advanceOnly(
    bytes: Uint8Array,
    gs: GState,
    font: FontInfo,
    adjustments: Array<{ at: number; by: number }>,
  ): number {
    const step = font.twoByte ? 2 : 1;
    let x = 0;
    for (let i = 0; i + step - 1 < bytes.length; i += step) {
      const code = step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
      const w = this.widthFor(font, code, winAnsiChar(code) || " ") / 1000;
      const wordSpace = step === 1 && code === 32 ? gs.wordSpacing : 0;
      x += (w * gs.fontSize + gs.charSpacing + wordSpace) * gs.hScale;
    }
    for (const adj of adjustments) x += (-adj.by / 1000) * gs.fontSize * gs.hScale;
    return x;
  }

  private async runForm(
    form: PStream,
    parentResources: PDict | null,
    gs: GState,
    depth: number,
  ): Promise<void> {
    const content = await decodeStream(form, this.inflate);
    if (!content) return;

    const inner = cloneState(gs);
    const matrix = this.resolve(form.d.v.get("Matrix"));
    if (matrix?.k === "arr" && matrix.v.length === 6) {
      const m = matrix.v.map((x) => (x.k === "num" ? x.v : 0)) as Matrix;
      inner.ctm = mul(m, inner.ctm);
    }

    this.emit({ t: "save" });

    const bbox = this.resolve(form.d.v.get("BBox"));
    if (bbox?.k === "arr" && bbox.v.length === 4) {
      const [a, b, c, d] = bbox.v.map((x) => (x.k === "num" ? x.v : 0));
      const corners: Array<[number, number]> = [
        apply(inner.ctm, a, b),
        apply(inner.ctm, c, b),
        apply(inner.ctm, c, d),
        apply(inner.ctm, a, d),
      ];
      this.emit({
        t: "clip",
        path: [
          { c: "m", p: corners[0] },
          { c: "l", p: corners[1] },
          { c: "l", p: corners[2] },
          { c: "l", p: corners[3] },
          { c: "h" },
        ],
        evenOdd: false,
      });
    }

    const own = dictOf(this.resolve(form.d.v.get("Resources")));
    await this.run(content, own ?? parentResources, inner, depth + 1);
    this.emit({ t: "restore" });
  }

  /**
   * Parses a BI … ID … EI inline image. Getting the length right matters even when the image
   * cannot be drawn: guessing wrong leaves the lexer reading pixel bytes as operators.
   */
  private async inlineImage(
    lexer: ContentLexer,
    resources: PDict | null,
    gs: GState,
  ): Promise<void> {
    const dict = new Map<string, Tok>();
    while (lexer.pos < lexer.buf.length) {
      lexer.skipWs();
      if (lexer.buf[lexer.pos] === 0x2f) {
        const key = lexer.name();
        const value = lexer.next();
        if (value === null) return;
        dict.set(key, value);
        continue;
      }
      const tok = lexer.next();
      if (tok === null) return;
      if (tok.t === "op" && tok.v === "ID") break;
      if (tok.t === "op" && tok.v === "EI") return;
    }

    lexer.pos++; // single whitespace byte after ID
    const start = lexer.pos;

    // Scan for "EI" delimited by whitespace on both sides — the conventional terminator test.
    let end = -1;
    for (let i = start; i + 1 < lexer.buf.length; i++) {
      if (lexer.buf[i] !== 0x45 || lexer.buf[i + 1] !== 0x49) continue;
      const before = lexer.buf[i - 1];
      const after = lexer.buf[i + 2];
      if (!isWsByte(before)) continue;
      if (after !== undefined && !isWsByte(after) && !isDelimByte(after)) continue;
      end = i;
      break;
    }
    if (end < 0) {
      lexer.pos = lexer.buf.length;
      return;
    }
    const data = lexer.buf.subarray(start, end - 1 >= start ? end - 1 : start);
    lexer.pos = end + 2;

    const get = (...keys: string[]): Tok | undefined => {
      for (const k of keys) {
        const v = dict.get(k);
        if (v !== undefined) return v;
      }
      return undefined;
    };
    const numKey = (fallback: number, ...keys: string[]): number => {
      const v = get(...keys);
      return v?.t === "num" ? v.v : fallback;
    };

    const width = numKey(0, "Width", "W");
    const height = numKey(0, "Height", "H");
    if (width <= 0 || height <= 0) return;

    // Rebuild the inline dictionary as a regular stream dict and reuse the XObject path.
    const streamDict: PDict = { k: "dict", v: new Map<string, PVal>() };
    streamDict.v.set("Width", { k: "num", v: width });
    streamDict.v.set("Height", { k: "num", v: height });
    streamDict.v.set("BitsPerComponent", { k: "num", v: numKey(8, "BitsPerComponent", "BPC") });
    const mask = get("ImageMask", "IM");
    if (mask?.t === "op" && mask.v === "true")
      streamDict.v.set("ImageMask", { k: "bool", v: true });
    const filter = get("Filter", "F");
    if (filter?.t === "name") streamDict.v.set("Filter", { k: "name", v: filter.v });
    else if (filter?.t === "arr") {
      streamDict.v.set("Filter", {
        k: "arr",
        v: filter.v
          .filter((x): x is { t: "name"; v: string } => x.t === "name")
          .map((x) => ({ k: "name", v: x.v }) as PVal),
      });
    }
    const cs = get("ColorSpace", "CS");
    if (cs?.t === "name") {
      const expand: Record<string, string> = {
        G: "DeviceGray",
        RGB: "DeviceRGB",
        CMYK: "DeviceCMYK",
        I: "Indexed",
      };
      streamDict.v.set("ColorSpace", { k: "name", v: expand[cs.v] ?? cs.v });
    }

    const stream: PStream = { k: "stream", d: streamDict, raw: new Uint8Array(data) };
    const image = await this.decodeImage(stream, resources, gs.fill);
    if (image) this.emit({ t: "image", m: gs.ctm, alpha: gs.fillAlpha, image });
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/** Parses a PDF once; the returned document is passed back to `renderPage` for each page. */
export async function openPdf(data: Uint8Array, inflate: PdfInflate): Promise<PdfOpenResult> {
  if (!data || data.length === 0)
    return { ok: false, error: "empty file", doc: null, pageCount: 0 };
  try {
    const { doc, error } = await parseDocument(data, inflate);
    if (!doc)
      return { ok: false, error: error ?? "could not read this PDF", doc: null, pageCount: 0 };
    return { ok: true, doc, pageCount: doc.pages.length };
  } catch {
    return { ok: false, error: "could not read this PDF", doc: null, pageCount: 0 };
  }
}

function pageBox(entry: PageEntry, objects: Map<number, PVal>): [number, number, number, number] {
  const resolve = (v: PVal | undefined): PVal | undefined =>
    v?.k === "ref" ? objects.get(v.n) : v;
  const raw = resolve(entry.dict.v.get("MediaBox") ?? entry.inherited.get("MediaBox"));
  if (raw?.k === "arr" && raw.v.length === 4) {
    const nums = raw.v.map((x) => {
      const r = resolve(x);
      return r?.k === "num" ? r.v : 0;
    });
    const x0 = Math.min(nums[0], nums[2]);
    const y0 = Math.min(nums[1], nums[3]);
    const x1 = Math.max(nums[0], nums[2]);
    const y1 = Math.max(nums[1], nums[3]);
    if (x1 - x0 > 1 && y1 - y0 > 1) return [x0, y0, x1, y1];
  }
  return [0, 0, 612, 792];
}

async function contentBytes(
  entry: PageEntry,
  objects: Map<number, PVal>,
  inflate: PdfInflate,
): Promise<Uint8Array> {
  const resolve = (v: PVal | undefined): PVal | undefined =>
    v?.k === "ref" ? objects.get(v.n) : v;
  const streams: PStream[] = [];
  const value = resolve(entry.dict.v.get("Contents"));
  if (value?.k === "stream") streams.push(value);
  else if (value?.k === "arr") {
    for (const item of value.v) {
      const s = resolve(item);
      if (s?.k === "stream") streams.push(s);
    }
  }

  const parts: Uint8Array[] = [];
  let total = 0;
  for (const s of streams) {
    const decoded = await decodeStream(s, inflate);
    if (!decoded) continue;
    parts.push(decoded, Uint8Array.from([0x0a]));
    total += decoded.length + 1;
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    at += p.length;
  }
  return joined;
}

/** Builds the display list for one page. Index is 0-based. */
export async function renderPage(
  doc: PdfDocument,
  index: number,
  inflate: PdfInflate,
): Promise<RenderedPage | null> {
  const entry = doc.pages[index];
  if (!entry) return null;

  const viewBox = pageBox(entry, doc.objects);
  const rotate = pageRotation(entry);

  const renderer = new PageRenderer(doc, inflate);
  const resources =
    dictOf(
      entry.dict.v.get("Resources")?.k === "ref"
        ? doc.objects.get((entry.dict.v.get("Resources") as Extract<PVal, { k: "ref" }>).n)
        : entry.dict.v.get("Resources"),
    ) ??
    dictOf(
      entry.inherited.get("Resources")?.k === "ref"
        ? doc.objects.get((entry.inherited.get("Resources") as Extract<PVal, { k: "ref" }>).n)
        : entry.inherited.get("Resources"),
    );

  const initial: GState = {
    ctm: IDENTITY,
    fill: "rgb(0,0,0)",
    stroke: "rgb(0,0,0)",
    fillCs: CS_GRAY,
    strokeCs: CS_GRAY,
    fillAlpha: 1,
    strokeAlpha: 1,
    lineWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    dash: [],
    dashPhase: 0,
    font: null,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    renderMode: 0,
  };

  try {
    const content = await contentBytes(entry, doc.objects, inflate);
    if (content.length > 0) await renderer.run(content, resources, initial, 0);
  } catch {
    /* a broken page yields whatever was drawn before the failure */
  }

  return {
    index,
    viewBox,
    rotate,
    ops: renderer.ops,
    blank: renderer.ops.every((op) => op.t === "save" || op.t === "restore" || op.t === "clip"),
  };
}

/** Zero-padded page file name, e.g. `report-page-03.jpg`. */
export function pageFileName(
  base: string,
  index: number,
  total: number,
  extension: string,
): string {
  const digits = String(total).length;
  return `${base}-page-${String(index + 1).padStart(digits, "0")}.${extension}`;
}
