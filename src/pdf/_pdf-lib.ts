/**
 * Shared client-side PDF read/write core.
 *
 * Parses a PDF into an object graph by scanning for "N G obj" headers (ignoring the
 * cross-reference table, which real-world files botch often enough that scanning is the only
 * reliable path), then rebuilds a fresh document from a chosen set of pages with renumbered
 * references and a classic cross-reference table. Content streams are copied byte-for-byte
 * with their original filters, so nothing is re-encoded and page quality is untouched.
 *
 * Inflation is injected rather than implemented: the caller passes a function backed by the
 * browser's DecompressionStream. It is only needed to read object streams (PDF 1.5+).
 *
 * This module is internal to the PDF engines (pdf-splitter, pdf-page-rotator, image-to-pdf)
 * and is not part of the package's public exports.
 */

export type PdfInflate = (data: Uint8Array) => Promise<Uint8Array>;

/* ------------------------------------------------------------------ *
 * Object model
 * ------------------------------------------------------------------ */

type PNum = { k: "num"; v: number };
type PBool = { k: "bool"; v: boolean };
type PNull = { k: "null" };
type PName = { k: "name"; v: string };
type PStr = { k: "str"; v: Uint8Array };
type PRef = { k: "ref"; n: number };
type PArr = { k: "arr"; v: PVal[] };
type PDict = { k: "dict"; v: Map<string, PVal> };
type PStream = { k: "stream"; d: PDict; raw: Uint8Array };
export type PVal = PNum | PBool | PNull | PName | PStr | PRef | PArr | PDict | PStream;

const NULL_VAL: PNull = { k: "null" };

/** Attributes a page inherits from its ancestors in the page tree. */
const INHERITABLE = ["Resources", "MediaBox", "CropBox", "Rotate"];

const LETTER_MEDIABOX: PArr = {
  k: "arr",
  v: [
    { k: "num", v: 0 },
    { k: "num", v: 0 },
    { k: "num", v: 612 },
    { k: "num", v: 792 },
  ],
};

/* ------------------------------------------------------------------ *
 * Byte helpers
 * ------------------------------------------------------------------ */

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isWs(c: number): boolean {
  return WS.has(c);
}

function isDelim(c: number): boolean {
  return DELIM.has(c);
}

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function encodeLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function indexOfSeq(buf: Uint8Array, needle: string, from: number): number {
  const pat = encodeLatin1(needle);
  const last = buf.length - pat.length;
  for (let i = Math.max(0, from); i <= last; i++) {
    let hit = true;
    for (let j = 0; j < pat.length; j++) {
      if (buf[i + j] !== pat[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

function matchesAt(buf: Uint8Array, pos: number, s: string): boolean {
  if (pos + s.length > buf.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (buf[pos + i] !== s.charCodeAt(i)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Parser
 * ------------------------------------------------------------------ */

class PdfParser {
  buf: Uint8Array;
  pos: number;

  constructor(buf: Uint8Array, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  skipWs(): void {
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos];
      if (isWs(c)) {
        this.pos++;
      } else if (c === 0x25) {
        while (this.pos < this.buf.length) {
          const d = this.buf[this.pos];
          if (d === 0x0a || d === 0x0d) break;
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  readToken(): string {
    this.skipWs();
    const start = this.pos;
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos];
      if (isWs(c) || isDelim(c)) break;
      this.pos++;
    }
    return latin1(this.buf, start, this.pos);
  }

  readInteger(): number | null {
    const save = this.pos;
    const tok = this.readToken();
    if (!/^[+-]?\d+$/.test(tok)) {
      this.pos = save;
      return null;
    }
    return Number.parseInt(tok, 10);
  }

  parseName(): PName {
    this.pos++; // "/"
    let s = "";
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos];
      if (isWs(c) || isDelim(c)) break;
      if (c === 0x23 && this.pos + 2 < this.buf.length) {
        const hex = latin1(this.buf, this.pos + 1, this.pos + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          s += String.fromCharCode(Number.parseInt(hex, 16));
          this.pos += 3;
          continue;
        }
      }
      s += String.fromCharCode(c);
      this.pos++;
    }
    return { k: "name", v: s };
  }

  parseLiteralString(): PStr {
    this.pos++; // "("
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos++];
      if (c === 0x5c) {
        const e = this.buf[this.pos++];
        if (e === 0x6e) out.push(0x0a);
        else if (e === 0x72) out.push(0x0d);
        else if (e === 0x74) out.push(0x09);
        else if (e === 0x62) out.push(0x08);
        else if (e === 0x66) out.push(0x0c);
        else if (e === 0x0a) {
          /* line continuation */
        } else if (e === 0x0d) {
          if (this.buf[this.pos] === 0x0a) this.pos++;
        } else if (e >= 0x30 && e <= 0x37) {
          let oct = e - 0x30;
          for (let i = 0; i < 2; i++) {
            const d = this.buf[this.pos];
            if (d >= 0x30 && d <= 0x37) {
              oct = oct * 8 + (d - 0x30);
              this.pos++;
            } else break;
          }
          out.push(oct & 0xff);
        } else {
          out.push(e);
        }
        continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29) {
        depth--;
        if (depth === 0) break;
      }
      out.push(c);
    }
    return { k: "str", v: Uint8Array.from(out) };
  }

  parseHexString(): PStr {
    this.pos++; // "<"
    const digits: string[] = [];
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos++];
      if (c === 0x3e) break;
      const ch = String.fromCharCode(c);
      if (/[0-9a-fA-F]/.test(ch)) digits.push(ch);
    }
    if (digits.length % 2 === 1) digits.push("0");
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = Number.parseInt(digits[i * 2] + digits[i * 2 + 1], 16);
    }
    return { k: "str", v: out };
  }

  parseArray(depth: number): PArr {
    this.pos++; // "["
    const items: PVal[] = [];
    while (this.pos < this.buf.length) {
      this.skipWs();
      if (this.buf[this.pos] === 0x5d) {
        this.pos++;
        break;
      }
      const before = this.pos;
      items.push(this.parseValue(depth + 1));
      if (this.pos === before) {
        this.pos++; // never stall
      }
    }
    return { k: "arr", v: items };
  }

  parseDict(depth: number): PDict {
    this.pos += 2; // "<<"
    const map = new Map<string, PVal>();
    while (this.pos < this.buf.length) {
      this.skipWs();
      if (matchesAt(this.buf, this.pos, ">>")) {
        this.pos += 2;
        break;
      }
      if (this.buf[this.pos] !== 0x2f) {
        // Junk where a key should be — skip a byte and keep going.
        this.pos++;
        continue;
      }
      const key = this.parseName().v;
      const value = this.parseValue(depth + 1);
      map.set(key, value);
    }
    return { k: "dict", v: map };
  }

  parseValue(depth = 0): PVal {
    if (depth > 96) return NULL_VAL;
    this.skipWs();
    if (this.pos >= this.buf.length) return NULL_VAL;

    const c = this.buf[this.pos];
    if (c === 0x2f) return this.parseName();
    if (c === 0x28) return this.parseLiteralString();
    if (c === 0x5b) return this.parseArray(depth);
    if (c === 0x3c) {
      if (this.buf[this.pos + 1] === 0x3c) return this.parseDict(depth);
      return this.parseHexString();
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.pos++;
      return NULL_VAL;
    }

    const save = this.pos;
    const tok = this.readToken();
    if (tok === "") {
      this.pos = save + 1;
      return NULL_VAL;
    }
    if (tok === "true") return { k: "bool", v: true };
    if (tok === "false") return { k: "bool", v: false };
    if (tok === "null") return NULL_VAL;

    if (/^[+-]?\d+$/.test(tok)) {
      // Could be "N G R" — try the reference form before settling for a plain number.
      const afterInt = this.pos;
      const gen = this.readInteger();
      if (gen !== null) {
        const beforeR = this.pos;
        const r = this.readToken();
        if (r === "R") return { k: "ref", n: Number.parseInt(tok, 10) };
        this.pos = beforeR;
      }
      this.pos = afterInt;
      return { k: "num", v: Number.parseInt(tok, 10) };
    }

    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      const n = Number.parseFloat(tok);
      return { k: "num", v: Number.isFinite(n) ? n : 0 };
    }

    return NULL_VAL;
  }

  /** Parses the body of an indirect object, i.e. everything after the "obj" keyword. */
  parseIndirectBody(): PVal {
    const value = this.parseValue();
    if (value.k !== "dict") return value;

    this.skipWs();
    if (!matchesAt(this.buf, this.pos, "stream")) return value;
    this.pos += 6;

    if (this.buf[this.pos] === 0x0d) this.pos++;
    if (this.buf[this.pos] === 0x0a) this.pos++;

    const start = this.pos;
    let end = -1;

    const len = value.v.get("Length");
    if (len && len.k === "num" && len.v >= 0 && start + len.v <= this.buf.length) {
      let probe = start + len.v;
      while (probe < this.buf.length && isWs(this.buf[probe])) probe++;
      if (matchesAt(this.buf, probe, "endstream")) end = start + len.v;
    }

    if (end < 0) {
      const marker = indexOfSeq(this.buf, "endstream", start);
      if (marker < 0) {
        this.pos = this.buf.length;
        return { k: "stream", d: value, raw: this.buf.slice(start) };
      }
      end = marker;
      // The EOL before "endstream" belongs to the file, not the stream data.
      if (end > start && this.buf[end - 1] === 0x0a) end--;
      if (end > start && this.buf[end - 1] === 0x0d) end--;
    }

    const raw = this.buf.slice(start, end);
    const after = indexOfSeq(this.buf, "endstream", end);
    this.pos = after < 0 ? this.buf.length : after + 9;
    return { k: "stream", d: value, raw };
  }
}

/* ------------------------------------------------------------------ *
 * Dictionary access helpers
 * ------------------------------------------------------------------ */

export function dictOf(v: PVal | undefined): PDict | null {
  if (!v) return null;
  if (v.k === "dict") return v;
  if (v.k === "stream") return v.d;
  return null;
}

export function nameOf(d: PDict | null, key: string): string | null {
  const v = d?.v.get(key);
  return v && v.k === "name" ? v.v : null;
}

export function intOf(d: PDict | null, key: string): number | null {
  const v = d?.v.get(key);
  return v && v.k === "num" ? v.v : null;
}

/* ------------------------------------------------------------------ *
 * Stream decoding (object streams only)
 * ------------------------------------------------------------------ */

/**
 * Row length in bytes for a PNG or TIFF predictor, or null when the /DecodeParms values are
 * unusable: /Colors and /Columns must be positive integers and /BitsPerComponent one of 1, 2,
 * 4, 8 or 16. A file can put any number in /Columns; nothing is allocated from these values
 * until they pass this check and fit the decoded data.
 */
function predictorRowLength(colors: number, bpc: number, columns: number): number | null {
  if (!Number.isInteger(colors) || colors < 1 || colors > 32) return null;
  if (bpc !== 1 && bpc !== 2 && bpc !== 4 && bpc !== 8 && bpc !== 16) return null;
  if (!Number.isInteger(columns) || columns < 1) return null;
  return Math.ceil((colors * bpc * columns) / 8);
}

function applyPngPredictor(
  data: Uint8Array,
  colors: number,
  bpc: number,
  columns: number,
): Uint8Array | null {
  const rowLen = predictorRowLength(colors, bpc, columns);
  if (rowLen === null) return null;
  const rows = Math.floor(data.length / (rowLen + 1));
  if (rows === 0) return new Uint8Array(0);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
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
      if (tag === 0) value = raw;
      else if (tag === 1) value = raw + left;
      else if (tag === 2) value = raw + up;
      else if (tag === 3) value = raw + ((left + up) >> 1);
      else if (tag === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = raw + pred;
      } else value = raw;

      row[i] = value & 0xff;
    }

    out.set(row, r * rowLen);
    prev = row;
  }

  return out;
}

export async function decodeStream(
  stream: PStream,
  inflate: PdfInflate,
): Promise<Uint8Array | null> {
  const filterVal = stream.d.v.get("Filter");
  const filters: string[] = [];
  if (filterVal?.k === "name") filters.push(filterVal.v);
  else if (filterVal?.k === "arr") {
    for (const f of filterVal.v) if (f.k === "name") filters.push(f.v);
  }

  if (filters.length === 0) return stream.raw;
  if (filters.length !== 1) return null;
  const filter = filters[0];
  if (filter !== "FlateDecode" && filter !== "Fl") return null;

  let data: Uint8Array;
  try {
    data = await inflate(stream.raw);
  } catch {
    return null;
  }

  const parmsVal = stream.d.v.get("DecodeParms") ?? stream.d.v.get("DP");
  const parms = dictOf(parmsVal?.k === "arr" ? parmsVal.v[0] : parmsVal);
  const predictor = intOf(parms, "Predictor") ?? 1;
  if (predictor >= 10) {
    const colors = intOf(parms, "Colors") ?? 1;
    const bpc = intOf(parms, "BitsPerComponent") ?? 8;
    const columns = intOf(parms, "Columns") ?? 1;
    return applyPngPredictor(data, colors, bpc, columns);
  }

  return data;
}

/* ------------------------------------------------------------------ *
 * Document parsing
 * ------------------------------------------------------------------ */

export interface PageEntry {
  num: number;
  dict: PDict;
  inherited: Map<string, PVal>;
}

export interface PdfDocument {
  objects: Map<number, PVal>;
  pages: PageEntry[];
}

/**
 * Collects every indirect object by scanning for "N G obj" headers rather than trusting the
 * cross-reference table. Real-world PDFs have broken xrefs often enough that every serious
 * reader ships this fallback; here it is the only path, which also means xref streams,
 * linearised files, and incremental updates all parse without special handling.
 */
function scanObjects(buf: Uint8Array): Map<number, PVal> {
  const objects = new Map<number, PVal>();
  let i = 0;

  while (i < buf.length - 3) {
    if (buf[i] !== 0x6f || buf[i + 1] !== 0x62 || buf[i + 2] !== 0x6a) {
      i++;
      continue;
    }
    const after = buf[i + 3];
    if (after !== undefined && !isWs(after) && !isDelim(after)) {
      i++;
      continue;
    }

    // Walk backwards over "<num> <gen> " to confirm this is an object header.
    let j = i - 1;
    while (j >= 0 && isWs(buf[j])) j--;
    const genEnd = j;
    while (j >= 0 && isDigit(buf[j])) j--;
    const genStart = j + 1;
    if (genEnd < genStart) {
      i++;
      continue;
    }
    while (j >= 0 && isWs(buf[j])) j--;
    const numEnd = j;
    while (j >= 0 && isDigit(buf[j])) j--;
    const numStart = j + 1;
    if (numEnd < numStart) {
      i++;
      continue;
    }
    if (numStart > 0 && !isWs(buf[numStart - 1]) && !isDelim(buf[numStart - 1])) {
      i++;
      continue;
    }

    const num = Number.parseInt(latin1(buf, numStart, numEnd + 1), 10);
    if (!Number.isFinite(num)) {
      i++;
      continue;
    }

    const parser = new PdfParser(buf, i + 3);
    let value: PVal;
    try {
      value = parser.parseIndirectBody();
    } catch {
      i += 3;
      continue;
    }

    // A later definition of the same object number wins, which is exactly how incremental
    // updates are supposed to resolve.
    objects.set(num, value);

    // Jumping past the parsed object (stream bytes included) keeps byte sequences that merely
    // look like "12 0 obj" inside compressed data from being picked up as objects.
    i = parser.pos > i + 3 ? parser.pos : i + 3;
  }

  return objects;
}

async function expandObjectStreams(objects: Map<number, PVal>, inflate: PdfInflate): Promise<void> {
  const direct = new Set(objects.keys());
  const snapshot = [...objects.values()];

  for (const value of snapshot) {
    if (value.k !== "stream") continue;
    if (nameOf(value.d, "Type") !== "ObjStm") continue;

    const data = await decodeStream(value, inflate);
    if (!data) continue;

    const count = intOf(value.d, "N") ?? 0;
    const first = intOf(value.d, "First") ?? 0;
    if (count <= 0 || first <= 0 || first > data.length) continue;

    const header = new PdfParser(data);
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
      const objNum = header.readInteger();
      const offset = header.readInteger();
      if (objNum === null || offset === null) break;
      pairs.push([objNum, offset]);
    }

    for (const [objNum, offset] of pairs) {
      if (direct.has(objNum)) continue; // a directly-defined object outranks the compressed one
      const start = first + offset;
      if (start < 0 || start >= data.length) continue;
      try {
        objects.set(objNum, new PdfParser(data, start).parseValue());
      } catch {
        /* a single unreadable entry should not sink the document */
      }
    }
  }
}

/** Pulls /Root and /Encrypt out of trailer dictionaries and cross-reference streams. */
function findTrailerKeys(
  buf: Uint8Array,
  objects: Map<number, PVal>,
): { root: number | null; encrypted: boolean } {
  let root: number | null = null;
  let encrypted = false;

  let at = indexOfSeq(buf, "trailer", 0);
  while (at >= 0) {
    const parser = new PdfParser(buf, at + 7);
    parser.skipWs();
    if (matchesAt(buf, parser.pos, "<<")) {
      const dict = parser.parseDict(0);
      const r = dict.v.get("Root");
      if (r?.k === "ref") root = r.n;
      if (dict.v.has("Encrypt")) encrypted = true;
    }
    at = indexOfSeq(buf, "trailer", at + 7);
  }

  for (const value of objects.values()) {
    if (value.k !== "stream") continue;
    if (nameOf(value.d, "Type") !== "XRef") continue;
    const r = value.d.v.get("Root");
    if (r?.k === "ref" && root === null) root = r.n;
    if (value.d.v.has("Encrypt")) encrypted = true;
  }

  if (root === null) {
    for (const [num, value] of objects) {
      if (nameOf(dictOf(value), "Type") === "Catalog") {
        root = num;
        break;
      }
    }
  }

  return { root, encrypted };
}

function collectPages(objects: Map<number, PVal>, root: number | null): PageEntry[] {
  const resolve = (v: PVal | undefined): PVal | undefined =>
    v?.k === "ref" ? objects.get(v.n) : v;

  const pages: PageEntry[] = [];
  const seenNodes = new Set<number>();
  const seenPages = new Set<number>();

  const walk = (ref: number, inherited: Map<string, PVal>, depth: number): void => {
    if (depth > 64 || seenNodes.has(ref)) return;
    const node = dictOf(objects.get(ref));
    if (!node) return;

    const inh = new Map(inherited);
    for (const key of INHERITABLE) {
      const v = node.v.get(key);
      if (v !== undefined) inh.set(key, v);
    }

    const type = nameOf(node, "Type");
    const kids = resolve(node.v.get("Kids"));

    if (type !== "Page" && kids?.k === "arr") {
      seenNodes.add(ref);
      for (const kid of kids.v) {
        if (kid.k === "ref") walk(kid.n, inh, depth + 1);
      }
      return;
    }

    if (seenPages.has(ref)) return;
    seenPages.add(ref);
    pages.push({ num: ref, dict: node, inherited: inh });
  };

  const catalog = root === null ? null : dictOf(objects.get(root));
  const pagesRef = catalog?.v.get("Pages");
  if (pagesRef?.k === "ref") walk(pagesRef.n, new Map(), 0);

  if (pages.length > 0) return pages;

  // No usable page tree — fall back to every /Type /Page object in object-number order.
  const loose = [...objects.entries()]
    .filter(([, v]) => nameOf(dictOf(v), "Type") === "Page")
    .sort((a, b) => a[0] - b[0]);

  for (const [num, value] of loose) {
    const dict = dictOf(value);
    if (dict) pages.push({ num, dict, inherited: new Map() });
  }

  return pages;
}

export async function parseDocument(
  data: Uint8Array,
  inflate: PdfInflate,
): Promise<{ doc: PdfDocument | null; error?: string }> {
  const headerAt = indexOfSeq(data.subarray(0, 2048), "%PDF-", 0);
  if (headerAt < 0) return { doc: null, error: "not a PDF file" };

  const objects = scanObjects(data);
  if (objects.size === 0)
    return { doc: null, error: "no PDF objects found — the file looks corrupt" };

  const { root, encrypted } = findTrailerKeys(data, objects);
  if (encrypted) {
    return {
      doc: null,
      error: "password-protected PDFs are not supported — remove the password first",
    };
  }

  await expandObjectStreams(objects, inflate);

  const pages = collectPages(objects, root);
  if (pages.length === 0) return { doc: null, error: "no pages found" };

  return { doc: { objects, pages } };
}

/* ------------------------------------------------------------------ *
 * Rotation helper
 * ------------------------------------------------------------------ */

/** Normalises any degree value to one of 0, 90, 180, 270. */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r;
}

/** The effective /Rotate for a page, resolving inheritance and normalising the value. */
export function pageRotation(page: PageEntry): number {
  const own = intOf(page.dict, "Rotate");
  if (own !== null) return normalizeAngle(own);
  const inh = page.inherited.get("Rotate");
  if (inh && inh.k === "num") return normalizeAngle(inh.v);
  return 0;
}

/* ------------------------------------------------------------------ *
 * Page geometry
 * ------------------------------------------------------------------ */

export interface PageBox {
  x0: number;
  y0: number;
  width: number;
  height: number;
}

/**
 * The page's /MediaBox expressed as an origin plus a size. Handles indirect boxes, boxes
 * inherited from a parent node, and corners written in the wrong order (which is legal —
 * the spec only says the array holds two opposite corners). Falls back to US Letter.
 */
export function pageBox(doc: PdfDocument, page: PageEntry): PageBox {
  const resolve = (v: PVal | undefined): PVal | undefined =>
    v?.k === "ref" ? doc.objects.get(v.n) : v;

  const letter: PageBox = { x0: 0, y0: 0, width: 612, height: 792 };
  const raw = resolve(page.dict.v.get("MediaBox") ?? page.inherited.get("MediaBox"));
  if (raw?.k !== "arr") return letter;

  const nums: number[] = [];
  for (const item of raw.v) {
    const n = resolve(item);
    if (n?.k === "num" && Number.isFinite(n.v)) nums.push(n.v);
  }
  if (nums.length !== 4) return letter;

  const width = Math.abs(nums[2] - nums[0]);
  const height = Math.abs(nums[3] - nums[1]);
  if (width < 1 || height < 1) return letter;

  return { x0: Math.min(nums[0], nums[2]), y0: Math.min(nums[1], nums[3]), width, height };
}

/* ------------------------------------------------------------------ *
 * Stamp geometry
 * ------------------------------------------------------------------ */

export interface PageViewSpace {
  /** View space → page space, as the six numbers of a PDF `cm` matrix. */
  matrix: number[];
  viewWidth: number;
  viewHeight: number;
}

/**
 * Maps the viewer's upright coordinate system back onto the page's own, so a mark placed at
 * "bottom centre" lands where a reader sees the bottom centre — even on a page whose /Rotate
 * says it should be displayed a quarter-turn over.
 */
export function viewTransform(rotation: number, box: PageBox): PageViewSpace {
  const { x0, y0, width: w, height: h } = box;
  switch (rotation) {
    case 90:
      return { matrix: [0, 1, -1, 0, w + x0, y0], viewWidth: h, viewHeight: w };
    case 180:
      return { matrix: [-1, 0, 0, -1, w + x0, h + y0], viewWidth: w, viewHeight: h };
    case 270:
      return { matrix: [0, -1, 1, 0, x0, h + y0], viewWidth: h, viewHeight: w };
    default:
      return { matrix: [1, 0, 0, 1, x0, y0], viewWidth: w, viewHeight: h };
  }
}

/* ------------------------------------------------------------------ *
 * Text metrics for the 14 built-in fonts
 * ------------------------------------------------------------------ */

const parseWidths = (spec: string): number[] => spec.trim().split(/\s+/).map(Number);

// Advance widths for code points 32–126, in 1/1000 em, taken from the Adobe core font metrics
// (Core 14 AFM files; see THIRD_PARTY_NOTICES.md).
const CORE_WIDTHS: Record<string, number[]> = {
  Helvetica: parseWidths(`
    278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278
    556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556
    1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778
    667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556
    333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556
    556 556 333 500 278 556 500 722 500 500 500 334 260 334 584`),
  "Helvetica-Bold": parseWidths(`
    278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278
    556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611
    975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778
    667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556
    333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611
    611 611 389 556 333 611 556 778 556 556 500 389 280 389 584`),
  "Times-Roman": parseWidths(`
    250 333 408 500 500 833 778 180 333 333 500 564 250 333 250 278
    500 500 500 500 500 500 500 500 500 500 278 278 564 564 564 444
    921 722 667 667 722 611 556 722 722 333 389 722 611 889 722 722
    556 722 667 556 611 722 722 944 722 722 611 333 278 333 469 500
    333 444 500 444 500 444 333 500 500 278 278 500 278 778 500 500
    500 500 333 389 278 500 500 722 500 500 444 480 200 480 541`),
  "Times-Bold": parseWidths(`
    250 333 555 500 500 1000 833 278 333 333 500 570 250 333 250 278
    500 500 500 500 500 500 500 500 500 500 333 333 570 570 570 500
    930 722 667 722 722 667 611 778 778 389 500 778 667 944 722 778
    611 778 722 556 667 722 722 1000 722 722 667 333 278 333 581 500
    333 500 556 444 556 444 333 500 556 278 333 556 278 833 556 500
    556 556 444 389 333 556 500 722 500 500 444 394 220 394 520`),
  "Times-Italic": parseWidths(`
    250 333 420 500 500 833 778 214 333 333 500 675 250 333 250 278
    500 500 500 500 500 500 500 500 500 500 333 333 675 675 675 500
    920 611 611 667 722 611 611 722 722 333 444 667 556 833 667 722
    611 722 611 500 556 722 611 833 611 556 556 389 278 389 422 500
    333 500 500 444 500 444 278 500 500 278 278 444 278 722 500 500
    500 500 389 389 278 500 444 667 444 444 389 400 275 400 541`),
  "Times-BoldItalic": parseWidths(`
    250 389 555 500 500 833 778 278 333 333 500 570 250 333 250 278
    500 500 500 500 500 500 500 500 500 500 333 333 570 570 570 500
    832 667 667 667 722 667 667 722 778 389 500 667 611 889 722 722
    611 722 667 556 611 722 667 889 667 611 611 333 278 333 570 500
    333 500 500 444 500 444 333 500 556 278 278 500 278 778 556 500
    500 500 389 389 278 556 444 667 500 444 389 348 220 348 570`),
  Courier: parseWidths(`
    600 600 600 600 600 600 600 600 600 600 600 600 600 600 600 600
    600 600 600 600 600 600 600 600 600 600 600 600 600 600 600 600
    600 600 600 600 600 600 600 600 600 600 600 600 600 600 600 600
    600 600 600 600 600 600 600 600 600 600 600 600 600 600 600 600
    600 600 600 600 600 600 600 600 600 600 600 600 600 600 600 600
    600 600 600 600 600 600 600 600 600 600 600 600 600 600 600`),
};

/** Slanted faces carry the same advance widths as their upright twin, and Courier is monospaced. */
const WIDTH_ALIASES: Record<string, string> = {
  "Helvetica-Oblique": "Helvetica",
  "Helvetica-BoldOblique": "Helvetica-Bold",
  "Courier-Bold": "Courier",
  "Courier-Oblique": "Courier",
  "Courier-BoldOblique": "Courier",
};

/**
 * Accented Latin-1 letters carry the same advance width as their plain counterpart in all four
 * text fonts, so folding them down is enough to measure a string like "Página 2 de 9" correctly.
 * `*` marks a character with no ASCII twin; those fall back to a middling width.
 */
const LATIN1_FOLD = "AAAAAAACEEEEIIIIDNOOOOO*OUUUUY*saaaaaaaceeeeiiiionooooo*ouuuuy*y";

/**
 * The typographic characters WinAnsiEncoding keeps in 0x80–0x9f (dashes, curly quotes,
 * ellipsis, euro, …): Unicode code point -> WinAnsi byte, with the advance widths from the
 * Adobe core-font metrics as [Helvetica, Times-Roman] (bold faces are close enough for placement).
 */
const WINANSI_HIGH: Record<number, [byte: number, helvetica: number, times: number]> = {
  8364: [0x80, 556, 500], // €
  8218: [0x82, 222, 333], // ‚
  402: [0x83, 556, 500], // ƒ
  8222: [0x84, 333, 444], // „
  8230: [0x85, 1000, 1000], // …
  8224: [0x86, 556, 500], // †
  8225: [0x87, 556, 500], // ‡
  710: [0x88, 333, 333], // ˆ
  8240: [0x89, 1000, 1000], // ‰
  352: [0x8a, 667, 556], // Š
  8249: [0x8b, 333, 333], // ‹
  338: [0x8c, 1000, 889], // Œ
  381: [0x8e, 611, 611], // Ž
  8216: [0x91, 222, 333], // ‘
  8217: [0x92, 222, 333], // ’
  8220: [0x93, 333, 444], // “
  8221: [0x94, 333, 444], // ”
  8226: [0x95, 350, 350], // •
  8211: [0x96, 556, 500], // –
  8212: [0x97, 1000, 1000], // —
  732: [0x98, 333, 333], // ˜
  8482: [0x99, 1000, 980], // ™
  353: [0x9a, 500, 389], // š
  8250: [0x9b, 333, 333], // ›
  339: [0x9c, 944, 722], // œ
  382: [0x9e, 500, 444], // ž
  376: [0x9f, 667, 722], // Ÿ
};

/** Advance width of one character in 1/1000 em. `baseFont` is a built-in name like Times-Bold. */
export function standardCharWidth(code: number, baseFont: string): number {
  const table = CORE_WIDTHS[WIDTH_ALIASES[baseFont] ?? baseFont] ?? CORE_WIDTHS.Helvetica;
  if (code >= 32 && code <= 126) return table[code - 32];
  const high = WINANSI_HIGH[code];
  if (high) {
    if (baseFont.startsWith("Courier")) return 600;
    return baseFont.startsWith("Times") ? high[2] : high[1];
  }
  if (code >= 0xc0 && code <= 0xff) {
    const folded = LATIN1_FOLD.charCodeAt(code - 0xc0);
    if (folded !== 42) return table[folded - 32];
  }
  return baseFont.startsWith("Courier") ? 600 : 500;
}

/** Width in points of a Latin-1 string set in a built-in font at the given type size. */
export function standardTextWidth(text: string, baseFont: string, size: number): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += standardCharWidth(text.charCodeAt(i), baseFont);
  return (sum * size) / 1000;
}

/**
 * Keeps what WinAnsiEncoding can actually draw and reports whether anything was thrown away.
 * Latin-1 plus the typographic characters of the 0x80–0x9f block (— – ‘ ’ “ ” … € ™ …),
 * which `winAnsiHex` maps to their WinAnsi bytes.
 */
export function sanitizeWinAnsi(text: string): { text: string; dropped: boolean } {
  let out = "";
  let dropped = false;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff) || WINANSI_HIGH[code]) {
      out += ch;
    } else if (code === 9) out += " ";
    else dropped = true;
  }
  return { text: out, dropped };
}

/** WinAnsi bytes of a string as the body of a PDF hex string, ready for `<...> Tj`. */
export function winAnsiHex(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const byte = WINANSI_HIGH[code]?.[0] ?? code & 0xff;
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Writer
 * ------------------------------------------------------------------ */

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private size = 0;

  get length(): number {
    return this.size;
  }

  bytes(data: Uint8Array): void {
    this.chunks.push(data);
    this.size += data.length;
  }

  text(s: string): void {
    this.bytes(encodeLatin1(s));
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

function encodeName(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 0x21 || c > 0x7e || isDelim(c) || c === 0x23) {
      out += `#${c.toString(16).padStart(2, "0")}`;
    } else {
      out += name[i];
    }
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function writeValue(w: ByteWriter, v: PVal): void {
  switch (v.k) {
    case "num":
      w.text(fmtNum(v.v));
      return;
    case "bool":
      w.text(v.v ? "true" : "false");
      return;
    case "null":
      w.text("null");
      return;
    case "name":
      w.text(`/${encodeName(v.v)}`);
      return;
    case "str":
      // Hex strings round-trip any byte sequence without escaping rules to get wrong.
      w.text(`<${toHex(v.v)}>`);
      return;
    case "ref":
      w.text(`${v.n} 0 R`);
      return;
    case "arr": {
      w.text("[");
      v.v.forEach((item, i) => {
        if (i > 0) w.text(" ");
        writeValue(w, item);
      });
      w.text("]");
      return;
    }
    case "dict": {
      w.text("<<");
      for (const [key, value] of v.v) {
        w.text(`/${encodeName(key)} `);
        writeValue(w, value);
        w.text(" ");
      }
      w.text(">>");
      return;
    }
    case "stream": {
      const dict = new Map(v.d.v);
      dict.set("Length", { k: "num", v: v.raw.length });
      writeValue(w, { k: "dict", v: dict });
      w.text("\nstream\n");
      w.bytes(v.raw);
      w.text("\nendstream");
      return;
    }
  }
}

/**
 * Writes a complete PDF file from an array of objects. Array order defines object numbers
 * (index 0 → object 1); object 1 must be the document catalog, which the trailer points at.
 */
export function serialize(objects: Array<PVal | null>): Uint8Array {
  const w = new ByteWriter();
  w.text("%PDF-1.7\n");
  w.bytes(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(w.length);
    w.text(`${i + 1} 0 obj\n`);
    writeValue(w, objects[i] ?? NULL_VAL);
    w.text("\nendobj\n");
  }

  const xrefAt = w.length;
  const size = objects.length + 1;
  w.text("xref\n");
  w.text(`0 ${size}\n`);
  w.text("0000000000 65535 f \n");
  for (const offset of offsets) {
    w.text(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }

  w.text("trailer\n");
  w.text(`<</Size ${size} /Root 1 0 R>>\n`);
  w.text(`startxref\n${xrefAt}\n%%EOF\n`);

  return w.toUint8Array();
}

/* ------------------------------------------------------------------ *
 * Build a fresh document from a chosen set of pages
 * ------------------------------------------------------------------ */

const CATALOG_OBJ = 1;
const PAGES_OBJ = 2;

/** A standard-14 font to expose to overlay content under a chosen resource name. */
export interface OverlayFont {
  /** Resource name used inside the content stream, without the leading slash. */
  name: string;
  /** One of the 14 built-in PDF fonts, e.g. Helvetica or Times-Bold. */
  baseFont: string;
}

/**
 * Extra marks stamped on top of a page. The operators in `content` run after the page's own
 * content, but the writer first pushes and pops the graphics state around the original stream,
 * so an unbalanced `q` in the source cannot drag the stamp out of position.
 */
export interface PageOverlay {
  /** Raw content-stream operators, Latin-1 text. */
  content: string;
  fonts?: OverlayFont[];
}

/** Replaces the name token `/from` (not `/fromX`) with `/to` in content-stream text. */
function renameResource(content: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.replace(new RegExp(`/${escaped}(?=[\\s/\\[\\]()<>{}%]|$)`, "g"), `/${to}`);
}

/** One output page: which source page (0-based index) and an optional absolute rotation. */
export interface PageSelection {
  index: number;
  /** Absolute /Rotate to force (0/90/180/270). Omit to keep the page's own rotation. */
  rotate?: number;
  /** Content drawn on top of the page after its own content stream. */
  overlay?: PageOverlay;
}

/**
 * Writes a new single-document PDF containing exactly the selected pages, in order. Each
 * selected page keeps its content, size, and — unless overridden — its rotation. References
 * to the source page tree, catalog, or pages that are not part of the selection are dropped.
 */
export function buildPdf(doc: PdfDocument, selections: PageSelection[]): Uint8Array {
  const objects: Array<PVal | null> = [null, null]; // reserve the catalog and page-tree root
  const pageRefs: PRef[] = [];
  const depMap = new Map<number, number>(); // source object number -> new object number

  const alloc = (): number => {
    objects.push(null);
    return objects.length;
  };

  function copyRef(oldNum: number): number | null {
    const known = depMap.get(oldNum);
    if (known !== undefined) return known;

    const src = doc.objects.get(oldNum);
    if (src === undefined) return null;

    const type = nameOf(dictOf(src), "Type");
    // Never drag the source page tree, catalog, or an unselected page across.
    if (type === "Pages" || type === "Catalog" || type === "Page") return null;

    const newNum = alloc();
    depMap.set(oldNum, newNum);
    objects[newNum - 1] = copyValue(src, 0);
    return newNum;
  }

  function copyValue(v: PVal, depth: number): PVal {
    if (depth > 96) return NULL_VAL;
    switch (v.k) {
      case "ref": {
        const mapped = copyRef(v.n);
        return mapped === null ? NULL_VAL : { k: "ref", n: mapped };
      }
      case "arr":
        return { k: "arr", v: v.v.map((item) => copyValue(item, depth + 1)) };
      case "dict": {
        const out = new Map<string, PVal>();
        for (const [key, value] of v.v) out.set(key, copyValue(value, depth + 1));
        return { k: "dict", v: out };
      }
      case "stream": {
        const out = new Map<string, PVal>();
        for (const [key, value] of v.d.v) out.set(key, copyValue(value, depth + 1));
        return { k: "stream", d: { k: "dict", v: out }, raw: v.raw };
      }
      default:
        return v;
    }
  }

  const fontObjs = new Map<string, number>();

  /** One shared font object per base font, however many pages ask for it. */
  function standardFont(baseFont: string): number {
    const known = fontObjs.get(baseFont);
    if (known !== undefined) return known;

    const font = new Map<string, PVal>();
    font.set("Type", { k: "name", v: "Font" });
    font.set("Subtype", { k: "name", v: "Type1" });
    font.set("BaseFont", { k: "name", v: baseFont });
    font.set("Encoding", { k: "name", v: "WinAnsiEncoding" });

    const num = alloc();
    objects[num - 1] = { k: "dict", v: font };
    fontObjs.set(baseFont, num);
    return num;
  }

  /** Shallow-copies a possibly indirect dictionary into a direct one we can edit safely. */
  function inlineDict(v: PVal | undefined): PDict {
    const target = v?.k === "ref" ? objects[v.n - 1] : v;
    const source = dictOf(target ?? undefined);
    return { k: "dict", v: new Map(source ? source.v : []) };
  }

  function newStream(text: string): PRef {
    const num = alloc();
    objects[num - 1] = { k: "stream", d: { k: "dict", v: new Map() }, raw: encodeLatin1(text) };
    return { k: "ref", n: num };
  }

  function applyOverlay(dict: Map<string, PVal>, overlay: PageOverlay): void {
    const resources = inlineDict(dict.get("Resources"));
    const fonts = inlineDict(resources.v.get("Font"));
    let content = overlay.content;
    for (const font of overlay.fonts ?? []) {
      // The page's own content may already use this resource name for another font; then
      // the overlay's font gets the first free name with a numeric suffix instead.
      let name = font.name;
      for (let n = 2; fonts.v.has(name); n++) name = `${font.name}${n}`;
      if (name !== font.name) content = renameResource(content, font.name, name);
      fonts.v.set(name, { k: "ref", n: standardFont(font.baseFont) });
    }
    resources.v.set("Font", fonts);
    dict.set("Resources", resources);

    // Contents becomes [ q ] + original + [ Q + stamp ], which is how the stamp gets a clean
    // CTM no matter what the page left on the graphics stack.
    const parts: PVal[] = [newStream("q\n")];
    const existing = dict.get("Contents");
    if (existing?.k === "arr") {
      parts.push(...existing.v);
    } else if (existing?.k === "stream") {
      const num = alloc();
      objects[num - 1] = existing;
      parts.push({ k: "ref", n: num });
    } else if (existing && existing.k !== "null") {
      parts.push(existing);
    }
    parts.push(newStream(`Q\n${content}`));
    dict.set("Contents", { k: "arr", v: parts });
  }

  for (const sel of selections) {
    const page = doc.pages[sel.index];
    if (!page) continue;

    const dict = new Map<string, PVal>();
    for (const [key, value] of page.dict.v) {
      if (key === "Parent") continue; // rewritten below to point at the new tree
      dict.set(key, copyValue(value, 0));
    }
    for (const key of INHERITABLE) {
      const inherited = page.inherited.get(key);
      if (!dict.has(key) && inherited !== undefined) dict.set(key, copyValue(inherited, 0));
    }

    dict.set("Type", { k: "name", v: "Page" });
    dict.set("Parent", { k: "ref", n: PAGES_OBJ });
    if (!dict.has("MediaBox")) dict.set("MediaBox", LETTER_MEDIABOX);
    if (sel.rotate !== undefined) dict.set("Rotate", { k: "num", v: normalizeAngle(sel.rotate) });
    if (sel.overlay) applyOverlay(dict, sel.overlay);

    const newNum = alloc();
    objects[newNum - 1] = { k: "dict", v: dict };
    pageRefs.push({ k: "ref", n: newNum });
  }

  const catalog = new Map<string, PVal>();
  catalog.set("Type", { k: "name", v: "Catalog" });
  catalog.set("Pages", { k: "ref", n: PAGES_OBJ });
  objects[CATALOG_OBJ - 1] = { k: "dict", v: catalog };

  const pagesRoot = new Map<string, PVal>();
  pagesRoot.set("Type", { k: "name", v: "Pages" });
  pagesRoot.set("Kids", { k: "arr", v: pageRefs });
  pagesRoot.set("Count", { k: "num", v: pageRefs.length });
  objects[PAGES_OBJ - 1] = { k: "dict", v: pagesRoot };

  return serialize(objects);
}

/* ------------------------------------------------------------------ *
 * Page-range parsing (shared UI helper)
 * ------------------------------------------------------------------ */

export interface PageRangeParse {
  ok: boolean;
  error?: string;
  /** Sorted, de-duplicated list of 1-based page numbers. */
  pages: number[];
}

/**
 * Parses a spec like "1-3, 5, 8-10" into a sorted, unique list of 1-based page numbers,
 * clamped to the document's page count. "N-" and "-N" open-ended forms are accepted.
 */
export function parsePageRanges(spec: string, pageCount: number): PageRangeParse {
  if (pageCount <= 0) return { ok: false, error: "the PDF has no pages", pages: [] };

  const trimmed = spec.trim();
  if (!trimmed) return { ok: false, error: "enter which pages you want", pages: [] };

  const found = new Set<number>();

  // "2 - 4" is one range: glue the hyphen to its numbers before splitting on spaces/commas
  const glued = trimmed.replace(/\s*([-–])\s*/g, "$1");

  for (const rawPart of glued.split(/[,\s]+/)) {
    const part = rawPart.trim();
    if (!part) continue;

    const range = part.match(/^(\d*)\s*[-–]\s*(\d*)$/);
    if (range) {
      const start = range[1] === "" ? 1 : Number.parseInt(range[1], 10);
      const end = range[2] === "" ? pageCount : Number.parseInt(range[2], 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return { ok: false, error: `"${part}" is not a valid range`, pages: [] };
      }
      // clamp before iterating, so "1-99999999999" costs pageCount steps, not 10^11
      const lo = Math.max(1, Math.min(start, end));
      const hi = Math.min(pageCount, Math.max(start, end));
      for (let p = lo; p <= hi; p++) found.add(p);
      continue;
    }

    if (/^\d+$/.test(part)) {
      const p = Number.parseInt(part, 10);
      if (p >= 1 && p <= pageCount) found.add(p);
      continue;
    }

    return { ok: false, error: `"${part}" is not a page number or range`, pages: [] };
  }

  const pages = [...found].sort((a, b) => a - b);
  if (pages.length === 0) {
    return { ok: false, error: `no pages in range (this PDF has ${pageCount})`, pages: [] };
  }

  return { ok: true, pages };
}

/* ------------------------------------------------------------------ *
 * Shared misc
 * ------------------------------------------------------------------ */

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The ZIP writer sits at the package root so the image tools can reuse it too.
export type { ZipEntry } from "../_zip.js";
export { buildZip } from "../_zip.js";
