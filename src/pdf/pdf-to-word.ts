/**
 * Client-side PDF → Word (.docx) converter.
 *
 * Two independent pieces:
 *   1. A text extractor that parses the PDF object graph, decodes each page's content
 *      streams, and walks the text-showing operators (Tj / TJ / ' / ") while tracking the
 *      text matrix to recover line and paragraph breaks. Font bytes are mapped to Unicode
 *      through the font's /ToUnicode CMap when present, and WinAnsi otherwise.
 *   2. A minimal Office Open XML writer that packs the recovered paragraphs into a valid
 *      .docx (a ZIP of a few XML parts). Entries are stored uncompressed, which Word reads
 *      without complaint and keeps the writer free of any compression dependency.
 *
 * Flate inflation for reading is injected (browser DecompressionStream) rather than
 * implemented, exactly like the PDF merger.
 */

export type PdfInflate = (data: Uint8Array) => Promise<Uint8Array>;

/** Document properties written into the .docx. Each is left out unless given. */
export interface PdfToWordOptions {
  /** Author in the document properties (docProps/core.xml, dc:creator). */
  creator?: string;
  /** Producing application (docProps/app.xml, Application). */
  application?: string;
}

export interface PdfToWordResult {
  ok: boolean;
  error?: string;
  docx: Uint8Array;
  pageCount: number;
  wordCount: number;
  charCount: number;
}

/* ================================================================== *
 * PDF object model + parser (reading only)
 * ================================================================== */

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
const INHERITABLE = ["Resources", "MediaBox", "CropBox", "Rotate"];

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

const isWs = (c: number) => WS.has(c);
const isDelim = (c: number) => DELIM.has(c);
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function indexOfSeq(buf: Uint8Array, needle: string, from: number): number {
  const last = buf.length - needle.length;
  for (let i = Math.max(0, from); i <= last; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle.charCodeAt(j)) {
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
  for (let i = 0; i < s.length; i++) if (buf[pos + i] !== s.charCodeAt(i)) return false;
  return true;
}

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
      if (isWs(c)) this.pos++;
      else if (c === 0x25) {
        while (
          this.pos < this.buf.length &&
          this.buf[this.pos] !== 0x0a &&
          this.buf[this.pos] !== 0x0d
        )
          this.pos++;
      } else break;
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
    this.pos++;
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
    this.pos++;
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
          /* continuation */
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
        } else out.push(e);
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
    this.pos++;
    const digits: string[] = [];
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos++];
      if (c === 0x3e) break;
      const ch = String.fromCharCode(c);
      if (/[0-9a-fA-F]/.test(ch)) digits.push(ch);
    }
    if (digits.length % 2 === 1) digits.push("0");
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++)
      out[i] = Number.parseInt(digits[i * 2] + digits[i * 2 + 1], 16);
    return { k: "str", v: out };
  }

  parseArray(depth: number): PArr {
    this.pos++;
    const items: PVal[] = [];
    while (this.pos < this.buf.length) {
      this.skipWs();
      if (this.buf[this.pos] === 0x5d) {
        this.pos++;
        break;
      }
      const before = this.pos;
      items.push(this.parseValue(depth + 1));
      if (this.pos === before) this.pos++;
    }
    return { k: "arr", v: items };
  }

  parseDict(depth: number): PDict {
    this.pos += 2;
    const map = new Map<string, PVal>();
    while (this.pos < this.buf.length) {
      this.skipWs();
      if (matchesAt(this.buf, this.pos, ">>")) {
        this.pos += 2;
        break;
      }
      if (this.buf[this.pos] !== 0x2f) {
        this.pos++;
        continue;
      }
      const key = this.parseName().v;
      map.set(key, this.parseValue(depth + 1));
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
      const afterInt = this.pos;
      const gen = this.readInteger();
      if (gen !== null) {
        const beforeR = this.pos;
        if (this.readToken() === "R") return { k: "ref", n: Number.parseInt(tok, 10) };
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
 * Dictionary + reference helpers
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
 * Stream decoding
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
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
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
  else if (filterVal?.k === "arr")
    for (const f of filterVal.v) if (f.k === "name") filters.push(f.v);

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
    objects.set(num, value);
    i = parser.pos > i + 3 ? parser.pos : i + 3;
  }
  return objects;
}

async function expandObjectStreams(objects: Map<number, PVal>, inflate: PdfInflate): Promise<void> {
  const direct = new Set(objects.keys());
  const snapshot = [...objects.values()];
  for (const value of snapshot) {
    if (value.k !== "stream" || nameOf(value.d, "Type") !== "ObjStm") continue;
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
      if (direct.has(objNum)) continue;
      const start = first + offset;
      if (start < 0 || start >= data.length) continue;
      try {
        objects.set(objNum, new PdfParser(data, start).parseValue());
      } catch {
        /* skip one bad entry */
      }
    }
  }
}

function findRoot(
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
    if (value.k !== "stream" || nameOf(value.d, "Type") !== "XRef") continue;
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

interface PageEntry {
  dict: PDict;
  resources: PDict | null;
}

function collectPages(objects: Map<number, PVal>, root: number | null): PageEntry[] {
  const resolve = (v: PVal | undefined): PVal | undefined =>
    v?.k === "ref" ? objects.get(v.n) : v;
  const pages: PageEntry[] = [];
  const seen = new Set<number>();

  const walk = (ref: number, inherited: Map<string, PVal>, depth: number): void => {
    if (depth > 64 || seen.has(ref)) return;
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
      seen.add(ref);
      for (const kid of kids.v) if (kid.k === "ref") walk(kid.n, inh, depth + 1);
      return;
    }
    seen.add(ref);
    pages.push({ dict: node, resources: dictOf(resolve(inh.get("Resources"))) });
  };

  const catalog = root === null ? null : dictOf(objects.get(root));
  const pagesRef = catalog?.v.get("Pages");
  if (pagesRef?.k === "ref") walk(pagesRef.n, new Map(), 0);

  if (pages.length > 0) return pages;

  const loose = [...objects.entries()]
    .filter(([, v]) => nameOf(dictOf(v), "Type") === "Page")
    .sort((a, b) => a[0] - b[0]);
  for (const [, value] of loose) {
    const dict = dictOf(value);
    if (dict) pages.push({ dict, resources: dictOf(resolve(dict.v.get("Resources"))) });
  }
  return pages;
}

/* ================================================================== *
 * Encoding + font decoding
 * ================================================================== */

// WinAnsiEncoding (CP1252) code → Unicode. Codes 0x20-0x7E and 0xA0-0xFF map to
// the identical Unicode value; only the 0x80-0x9F band needs an explicit table.
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

interface FontDecoder {
  twoByte: boolean;
  toUnicode: Map<number, string> | null;
}

function parseHexCode(hex: string): number {
  return Number.parseInt(hex, 16);
}

function utf16beToString(hex: string): string {
  let s = "";
  for (let i = 0; i + 3 < hex.length + 1 && i + 4 <= hex.length; i += 4) {
    s += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  }
  if (s === "" && hex.length >= 2)
    s = String.fromCharCode(Number.parseInt(hex.slice(0, 4).padEnd(4, "0"), 16));
  return s;
}

/** Parses a /ToUnicode CMap stream into a code → string map. */
function parseToUnicode(text: string): { map: Map<number, string>; twoByte: boolean } {
  const map = new Map<number, string>();
  let twoByte = false;

  // Codespace tells us the byte width; <0000><FFFF> ⇒ 2-byte codes.
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
    // Each entry is <lo> <hi> <dst>  OR  <lo> <hi> [<d0> <d1> ...].
    const body = block[1];
    const re = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    let e: RegExpExecArray | null = re.exec(body);
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
      e = re.exec(body);
    }
  }
  return { map, twoByte };
}

async function buildFontDecoders(
  resources: PDict | null,
  objects: Map<number, PVal>,
  inflate: PdfInflate,
): Promise<Map<string, FontDecoder>> {
  const decoders = new Map<string, FontDecoder>();
  const resolve = (v: PVal | undefined): PVal | undefined =>
    v?.k === "ref" ? objects.get(v.n) : v;
  const fontDict = dictOf(resolve(resources?.v.get("Font")));
  if (!fontDict) return decoders;

  for (const [name, ref] of fontDict.v) {
    const font = dictOf(resolve(ref));
    if (!font) continue;
    const subtype = nameOf(font, "Subtype");
    let twoByte = subtype === "Type0";
    let toUnicode: Map<number, string> | null = null;

    const tuVal = resolve(font.v.get("ToUnicode"));
    if (tuVal?.k === "stream") {
      const data = await decodeStream(tuVal, inflate);
      if (data) {
        try {
          const parsed = parseToUnicode(latin1(data, 0, data.length));
          if (parsed.map.size > 0) {
            toUnicode = parsed.map;
            twoByte = twoByte || parsed.twoByte;
          }
        } catch {
          /* ignore malformed CMap */
        }
      }
    }
    decoders.set(name, { twoByte, toUnicode });
  }
  return decoders;
}

/**
 * The Form XObjects a resource dictionary names, each with its decoded content, its own
 * fonts (falling back to the parent's resources) and its nested forms. `chain` holds the
 * object numbers of the enclosing forms, so a form that draws itself is not followed.
 */
async function buildForms(
  resources: PDict | null,
  objects: Map<number, PVal>,
  inflate: PdfInflate,
  chain: number[] = [],
): Promise<Map<string, FormSource>> {
  const forms = new Map<string, FormSource>();
  if (chain.length >= MAX_FORM_DEPTH) return forms;
  const resolve = (v: PVal | undefined): PVal | undefined =>
    v?.k === "ref" ? objects.get(v.n) : v;
  const xobjects = dictOf(resolve(resources?.v.get("XObject")));
  if (!xobjects) return forms;

  for (const [name, ref] of xobjects.v) {
    if (ref?.k === "ref" && chain.includes(ref.n)) continue;
    const xo = resolve(ref);
    if (xo?.k !== "stream" || nameOf(xo.d, "Subtype") !== "Form") continue;
    const content = await decodeStream(xo, inflate);
    if (!content) continue;
    const own = dictOf(resolve(xo.d.v.get("Resources")));
    const formResources = own ?? resources;
    const nextChain = ref?.k === "ref" ? [...chain, ref.n] : [...chain, -1];
    forms.set(name, {
      content,
      fonts: await buildFontDecoders(formResources, objects, inflate),
      forms: await buildForms(formResources, objects, inflate, nextChain),
    });
  }
  return forms;
}

function decodeString(bytes: Uint8Array, font: FontDecoder | null): string {
  if (font?.toUnicode) {
    const width = font.twoByte ? 2 : 1;
    let out = "";
    for (let i = 0; i + width - 1 < bytes.length; i += width) {
      const code = width === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
      const mapped = font.toUnicode.get(code);
      out += mapped !== undefined ? mapped : "";
    }
    return out;
  }
  if (font?.twoByte) {
    // Composite font with no ToUnicode — we cannot recover glyphs reliably.
    return "";
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += winAnsiChar(bytes[i]);
  return out;
}

/* ================================================================== *
 * Content stream text extraction
 * ================================================================== */

type COp =
  | { t: "num"; v: number }
  | { t: "str"; v: Uint8Array }
  | { t: "name"; v: string }
  | { t: "arr"; v: COp[] }
  | { t: "other" };

function isContentWs(c: number): boolean {
  return isWs(c);
}

/** A Form XObject's content with the fonts and nested forms its resources name. */
interface FormSource {
  content: Uint8Array;
  fonts: Map<string, FontDecoder>;
  forms: Map<string, FormSource>;
}

/** Nesting limit for forms drawing forms; real files rarely go past two levels. */
const MAX_FORM_DEPTH = 8;

/**
 * Extracts a single page's text, inserting line and paragraph breaks from the text matrix.
 * Text drawn through a Form XObject (`/Fm0 Do`) is walked in place, with the form's own fonts.
 */
function extractPageText(
  pageContent: Uint8Array,
  pageFonts: Map<string, FontDecoder>,
  pageForms: Map<string, FormSource> = new Map(),
): string {
  let out = "";

  let font: FontDecoder | null = null;
  let fontSize = 0;
  let leading = 0;
  let lineY = 0;
  let lastY: number | null = null;
  let movedSinceShow = false;
  let shownAnything = false;

  const num = (o: COp | undefined): number => (o && o.t === "num" ? o.v : 0);

  const breakForLine = () => {
    if (lastY === null) {
      lastY = lineY;
      return;
    }
    const dy = lastY - lineY;
    const threshold = Math.max(2, fontSize * 0.4);
    if (Math.abs(dy) > threshold) {
      if (dy > fontSize * 1.6 && fontSize > 0) out += "\n\n";
      else out += "\n";
      lastY = lineY;
      movedSinceShow = false;
    }
  };

  const show = (bytes: Uint8Array) => {
    breakForLine();
    if (shownAnything && movedSinceShow && out.length > 0 && !/\s$/.test(out)) out += " ";
    out += decodeString(bytes, font);
    movedSinceShow = false;
    shownAnything = true;
    lastY = lineY;
  };

  const run = (
    content: Uint8Array,
    fonts: Map<string, FontDecoder>,
    forms: Map<string, FormSource>,
    depth: number,
  ): void => {
    const parser = new PdfParser(content);
    const stack: COp[] = [];

    const readString = (): Uint8Array => {
      const c = content[parser.pos];
      if (c === 0x28) return parser.parseLiteralString().v;
      if (c === 0x3c) return parser.parseHexString().v;
      return new Uint8Array(0);
    };

    const readArray = (): COp[] => {
      parser.pos++; // "["
      const items: COp[] = [];
      while (parser.pos < content.length) {
        parser.skipWs();
        const c = content[parser.pos];
        if (c === 0x5d) {
          parser.pos++;
          break;
        }
        if (c === 0x28 || c === 0x3c) items.push({ t: "str", v: readString() });
        else if (c === 0x2f) items.push({ t: "name", v: parser.parseName().v });
        else {
          const tok = parser.readToken();
          if (tok === "") parser.pos++;
          else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok))
            items.push({ t: "num", v: Number.parseFloat(tok) });
        }
      }
      return items;
    };

    while (parser.pos < content.length) {
      parser.skipWs();
      if (parser.pos >= content.length) break;
      const c = content[parser.pos];

      if (c === 0x25) {
        while (
          parser.pos < content.length &&
          content[parser.pos] !== 0x0a &&
          content[parser.pos] !== 0x0d
        )
          parser.pos++;
        continue;
      }
      if (c === 0x28 || c === 0x3c) {
        if (c === 0x3c && content[parser.pos + 1] === 0x3c) {
          parser.parseDict(0); // marked-content property dict — discard
        } else {
          stack.push({ t: "str", v: readString() });
        }
        continue;
      }
      if (c === 0x5b) {
        stack.push({ t: "arr", v: readArray() });
        continue;
      }
      if (c === 0x2f) {
        stack.push({ t: "name", v: parser.parseName().v });
        continue;
      }
      if (c === 0x2b || c === 0x2d || c === 0x2e || isDigit(c)) {
        const tok = parser.readToken();
        if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok))
          stack.push({ t: "num", v: Number.parseFloat(tok) });
        else stack.push({ t: "other" });
        continue;
      }

      // Operator keyword (letters, ', ", *, etc.).
      const start = parser.pos;
      while (parser.pos < content.length) {
        const d = content[parser.pos];
        if (isContentWs(d) || isDelim(d)) break;
        parser.pos++;
      }
      if (parser.pos === start) {
        parser.pos++;
        continue;
      }
      const op = latin1(content, start, parser.pos);

      switch (op) {
        case "BT":
          lineY = 0;
          break;
        case "Tf": {
          const nameOp = stack[stack.length - 2];
          font = fonts.get(nameOp?.t === "name" ? nameOp.v : "") ?? null;
          fontSize = num(stack[stack.length - 1]);
          break;
        }
        case "Td": {
          lineY += num(stack[1]);
          movedSinceShow = true;
          break;
        }
        case "TD": {
          leading = -num(stack[1]);
          lineY += num(stack[1]);
          movedSinceShow = true;
          break;
        }
        case "Tm": {
          lineY = num(stack[5]);
          movedSinceShow = true;
          break;
        }
        case "T*":
          lineY -= leading;
          movedSinceShow = true;
          break;
        case "TL":
          leading = num(stack[0]);
          break;
        case "Tj":
          if (stack[0]?.t === "str") show(stack[0].v);
          break;
        case "'":
          lineY -= leading;
          movedSinceShow = true;
          if (stack[0]?.t === "str") show(stack[0].v);
          break;
        case '"':
          lineY -= leading;
          movedSinceShow = true;
          if (stack[2]?.t === "str") show(stack[2].v);
          break;
        case "TJ": {
          const arr = stack[0];
          if (arr?.t === "arr") {
            breakForLine();
            if (shownAnything && movedSinceShow && out.length > 0 && !/\s$/.test(out)) out += " ";
            for (const el of arr.v) {
              if (el.t === "str") out += decodeString(el.v, font);
              else if (el.t === "num" && el.v <= -200 && !/\s$/.test(out)) out += " ";
            }
            movedSinceShow = false;
            shownAnything = true;
            lastY = lineY;
          }
          break;
        }
        case "Do": {
          const nameOp = stack[0];
          const form = nameOp?.t === "name" ? forms.get(nameOp.v) : undefined;
          if (form && depth < MAX_FORM_DEPTH) {
            // A form runs inside its own graphics state: restore the text font afterwards.
            const saved = { font, fontSize, leading };
            run(form.content, form.fonts, form.forms, depth + 1);
            ({ font, fontSize, leading } = saved);
          }
          break;
        }
        case "BI": {
          // Skip inline image data up to the EI marker.
          const ei = indexOfSeq(content, "EI", parser.pos);
          parser.pos = ei < 0 ? content.length : ei + 2;
          break;
        }
        default:
          break;
      }
      stack.length = 0;
    }
  };

  run(pageContent, pageFonts, pageForms, 0);
  return out;
}

async function pageContentBytes(
  entry: PageEntry,
  objects: Map<number, PVal>,
  inflate: PdfInflate,
): Promise<Uint8Array> {
  const resolve = (v: PVal | undefined): PVal | undefined =>
    v?.k === "ref" ? objects.get(v.n) : v;
  const contents = entry.dict.v.get("Contents");
  const streams: PStream[] = [];
  const collect = (v: PVal | undefined) => {
    const r = resolve(v);
    if (r?.k === "stream") streams.push(r);
    else if (r?.k === "arr")
      for (const item of r.v) {
        const s = resolve(item);
        if (s?.k === "stream") streams.push(s);
      }
  };
  collect(contents);

  const parts: Uint8Array[] = [];
  for (const s of streams) {
    const data = await decodeStream(s, inflate);
    if (data) {
      parts.push(data);
      parts.push(Uint8Array.from([0x0a]));
    }
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const joined = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    at += p.length;
  }
  return joined;
}

/* ================================================================== *
 * DOCX writer (ZIP of Office Open XML parts, stored/uncompressed)
 * ================================================================== */

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

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

function escapeXml(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    // Strip characters XML 1.0 forbids (control chars except tab/newline/CR).
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else out += ch;
  }
  return out;
}

function paragraphXml(text: string): string {
  const t = text.trim();
  if (t === "") return "<w:p/>";
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`;
}

function buildDocumentXml(pages: string[]): string {
  const body: string[] = [];
  pages.forEach((pageText, pageIndex) => {
    if (pageIndex > 0) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    const lines = pageText.split("\n");
    for (const line of lines) body.push(paragraphXml(line));
  });
  if (body.length === 0) body.push("<w:p/>");
  const sect =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  const header =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';
  return `${header}<w:body>${body.join("")}${sect}</w:body></w:document>`;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) =>
    Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  for (const entry of entries) {
    const nameBytes = utf8(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local: Uint8Array[] = [
      u32(0x04034b50),
      u16(20), // version needed
      u16(0x0800), // UTF-8 filename flag
      u16(0), // method: stored
      u16(0), // mod time
      u16(0x21), // mod date (1980-01-01)
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      entry.data,
    ];
    for (const part of local) chunks.push(part);

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
  const centralOffset = offset;

  const end: Uint8Array[] = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0),
  ];

  const all = [...chunks, ...central, ...end];
  let total = 0;
  for (const part of all) total += part.length;
  const result = new Uint8Array(total);
  let at = 0;
  for (const part of all) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

function buildDocx(pages: string[], meta: PdfToWordOptions): Uint8Array {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    "</Types>";

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    "</Relationships>";

  const creator = meta.creator ? `<dc:creator>${escapeXml(meta.creator)}</dc:creator>` : "";
  const core = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ',
    'xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "<dc:title>Converted from PDF</dc:title>",
    creator,
    "</cp:coreProperties>",
  ].join("");

  const application = meta.application
    ? `<Application>${escapeXml(meta.application)}</Application>`
    : "";
  const app = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">',
    application,
    "</Properties>",
  ].join("");

  return buildZip([
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rels) },
    { name: "docProps/core.xml", data: utf8(core) },
    { name: "docProps/app.xml", data: utf8(app) },
    { name: "word/document.xml", data: utf8(buildDocumentXml(pages)) },
  ]);
}

/* ================================================================== *
 * Public API
 * ================================================================== */

function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Extracts the text of every page, in reading order. */
export async function extractPdfText(
  data: Uint8Array,
  inflate: PdfInflate,
): Promise<{ ok: boolean; error?: string; pages: string[] }> {
  if (!data || data.length === 0) return { ok: false, error: "empty file", pages: [] };
  if (indexOfSeq(data.subarray(0, 2048), "%PDF-", 0) < 0)
    return { ok: false, error: "not a PDF file", pages: [] };

  const objects = scanObjects(data);
  if (objects.size === 0)
    return { ok: false, error: "no PDF objects found — the file looks corrupt", pages: [] };

  const { root, encrypted } = findRoot(data, objects);
  if (encrypted)
    return {
      ok: false,
      error: "password-protected PDFs are not supported — remove the password first",
      pages: [],
    };

  await expandObjectStreams(objects, inflate);
  const pageEntries = collectPages(objects, root);
  if (pageEntries.length === 0) return { ok: false, error: "no pages found", pages: [] };

  const pages: string[] = [];
  for (const entry of pageEntries) {
    const fonts = await buildFontDecoders(entry.resources, objects, inflate);
    const content = await pageContentBytes(entry, objects, inflate);
    const forms = await buildForms(entry.resources, objects, inflate);
    let text = "";
    try {
      text = extractPageText(content, fonts, forms);
    } catch {
      text = "";
    }
    pages.push(
      text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    );
  }
  return { ok: true, pages };
}

/**
 * Converts a PDF to a downloadable .docx. Extracts selectable text only — a scanned
 * (image-only) PDF has no text layer and will produce an empty document.
 */
export async function pdfToWord(
  data: Uint8Array,
  inflate: PdfInflate,
  options: PdfToWordOptions = {},
): Promise<PdfToWordResult> {
  const empty: PdfToWordResult = {
    ok: false,
    docx: new Uint8Array(0),
    pageCount: 0,
    wordCount: 0,
    charCount: 0,
  };

  let extracted: { ok: boolean; error?: string; pages: string[] };
  try {
    extracted = await extractPdfText(data, inflate);
  } catch {
    return { ...empty, error: "could not read this PDF" };
  }
  if (!extracted.ok) return { ...empty, error: extracted.error ?? "could not read this PDF" };

  const joined = extracted.pages.join("\n");
  const charCount = joined.replace(/\s/g, "").length;
  const wordCount = countWords(joined);

  if (wordCount === 0) {
    return {
      ...empty,
      pageCount: extracted.pages.length,
      error: "no selectable text found — this looks like a scanned or image-only PDF",
    };
  }

  const docx = buildDocx(extracted.pages, options);
  return {
    ok: true,
    docx,
    pageCount: extracted.pages.length,
    wordCount,
    charCount,
  };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
