/**
 * Client-side PDF merger.
 *
 * Parses each source PDF into an object graph, copies the reachable objects of every page
 * into a fresh document with renumbered references, and writes a new file with a classic
 * cross-reference table. Content streams are copied byte-for-byte with their original
 * filters, so nothing is re-encoded and quality is untouched.
 *
 * Inflation is injected rather than implemented: the caller passes a function backed by the
 * browser's DecompressionStream. It is only needed to read object streams (PDF 1.5+), never
 * to write output.
 */

export type PdfInflate = (data: Uint8Array) => Promise<Uint8Array>;

export interface PdfFileInput {
  name: string;
  data: Uint8Array;
}

export interface PdfInfo {
  ok: boolean;
  error?: string;
  pageCount: number;
}

export interface PdfMergeResult {
  ok: boolean;
  error?: string;
  bytes: Uint8Array;
  pageCount: number;
  fileCount: number;
  sizeBytes: number;
}

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
type PVal = PNum | PBool | PNull | PName | PStr | PRef | PArr | PDict | PStream;

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

function dictOf(v: PVal | undefined): PDict | null {
  if (!v) return null;
  if (v.k === "dict") return v;
  if (v.k === "stream") return v.d;
  return null;
}

function nameOf(d: PDict | null, key: string): string | null {
  const v = d?.v.get(key);
  return v && v.k === "name" ? v.v : null;
}

function intOf(d: PDict | null, key: string): number | null {
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

async function decodeStream(stream: PStream, inflate: PdfInflate): Promise<Uint8Array | null> {
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

interface PageEntry {
  num: number;
  dict: PDict;
  inherited: Map<string, PVal>;
}

interface PdfDocument {
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

async function parseDocument(
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

function serialize(objects: Array<PVal | null>): Uint8Array {
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
 * Merge
 * ------------------------------------------------------------------ */

const CATALOG_OBJ = 1;
const PAGES_OBJ = 2;

function mergeDocuments(docs: PdfDocument[]): Uint8Array {
  const objects: Array<PVal | null> = [null, null]; // reserve the catalog and the page-tree root
  const pageRefs: PRef[] = [];

  const alloc = (): number => {
    objects.push(null);
    return objects.length;
  };

  for (const doc of docs) {
    const map = new Map<number, number>();

    // Page numbers are reserved up front so that links and annotations pointing back at a page
    // resolve to the very same object we emit into the merged page tree.
    for (const page of doc.pages) map.set(page.num, alloc());

    function copyRef(oldNum: number): number | null {
      const known = map.get(oldNum);
      if (known !== undefined) return known;

      const src = doc.objects.get(oldNum);
      if (src === undefined) return null;

      const type = nameOf(dictOf(src), "Type");
      // The source page tree and catalog are replaced wholesale; never drag them across.
      if (type === "Pages" || type === "Catalog") return null;

      const newNum = alloc();
      map.set(oldNum, newNum);
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

    for (const page of doc.pages) {
      const newNum = map.get(page.num);
      if (newNum === undefined) continue;

      const dict = new Map<string, PVal>();
      for (const [key, value] of page.dict.v) {
        if (key === "Parent") continue; // rewritten below to point at the merged tree
        dict.set(key, copyValue(value, 0));
      }
      for (const key of INHERITABLE) {
        const inherited = page.inherited.get(key);
        if (!dict.has(key) && inherited !== undefined) dict.set(key, copyValue(inherited, 0));
      }

      dict.set("Type", { k: "name", v: "Page" });
      dict.set("Parent", { k: "ref", n: PAGES_OBJ });
      if (!dict.has("MediaBox")) dict.set("MediaBox", LETTER_MEDIABOX);

      objects[newNum - 1] = { k: "dict", v: dict };
      pageRefs.push({ k: "ref", n: newNum });
    }
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
 * Public API
 * ------------------------------------------------------------------ */

/** Reads a single PDF and reports how many pages it has. */
export async function readPdfInfo(data: Uint8Array, inflate: PdfInflate): Promise<PdfInfo> {
  if (!data || data.length === 0) return { ok: false, error: "empty file", pageCount: 0 };

  try {
    const { doc, error } = await parseDocument(data, inflate);
    if (!doc) return { ok: false, error: error ?? "could not read this PDF", pageCount: 0 };
    return { ok: true, pageCount: doc.pages.length };
  } catch {
    return { ok: false, error: "could not read this PDF", pageCount: 0 };
  }
}

/**
 * Merges PDFs in the order given. Pages keep their original size, rotation, and content;
 * bookmarks, form fields, and named destinations are not carried over.
 */
export async function mergePdfs(
  files: PdfFileInput[],
  inflate: PdfInflate,
): Promise<PdfMergeResult> {
  const empty: PdfMergeResult = {
    ok: false,
    bytes: new Uint8Array(0),
    pageCount: 0,
    fileCount: 0,
    sizeBytes: 0,
  };

  if (!files || files.length === 0) {
    return { ...empty, error: "add at least one PDF" };
  }

  const docs: PdfDocument[] = [];
  for (const file of files) {
    let parsed: { doc: PdfDocument | null; error?: string };
    try {
      parsed = await parseDocument(file.data, inflate);
    } catch {
      parsed = { doc: null, error: "could not be read" };
    }
    if (!parsed.doc) {
      return { ...empty, error: `${file.name}: ${parsed.error ?? "could not be read"}` };
    }
    docs.push(parsed.doc);
  }

  let bytes: Uint8Array;
  try {
    bytes = mergeDocuments(docs);
  } catch {
    return { ...empty, error: "merge failed — one of the files may be malformed" };
  }

  return {
    ok: true,
    bytes,
    pageCount: docs.reduce((sum, d) => sum + d.pages.length, 0),
    fileCount: docs.length,
    sizeBytes: bytes.length,
  };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
