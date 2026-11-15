/**
 * Client-side Word (.docx) → PDF converter.
 *
 * A .docx is a ZIP of XML parts, so this splits cleanly into three pieces:
 *   1. A tiny ZIP reader that walks the central directory and inflates `word/document.xml`.
 *   2. A regex-driven parser that turns that XML into a flat list of paragraphs, keeping the
 *      run-level bold/italic, heading level, and alignment, plus the page size and margins from
 *      the section properties.
 *   3. A minimal PDF writer that packs one full-page JPEG per page into a valid document.
 *
 * The actual text layout — line wrapping, pagination, and drawing — happens in the mount, where
 * a canvas can measure and rasterize text in whatever font and script the document uses. Doing
 * it that way means a Cyrillic, Greek, or accented document renders exactly as the browser draws
 * it, without shipping or subsetting a font. Flate inflation for the ZIP is injected (browser
 * DecompressionStream), the same split the other PDF engines use. Nothing is uploaded.
 */

export type PdfInflate = (data: Uint8Array) => Promise<Uint8Array>;

export interface DocxRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface DocxParagraph {
  runs: DocxRun[];
  /** 1–3 for headings, 0 for body text. */
  heading: number;
  align: "left" | "center" | "right" | "justify";
  bullet: boolean;
}

export interface PageSetup {
  widthPt: number;
  heightPt: number;
  marginTopPt: number;
  marginRightPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
}

export interface DocxParseResult {
  ok: boolean;
  error?: string;
  paragraphs: DocxParagraph[];
  page: PageSetup;
}

/** A page rasterized by the caller, ready to embed. */
export interface RenderedPage {
  /** Baseline JPEG bytes. */
  jpeg: Uint8Array;
  pxWidth: number;
  pxHeight: number;
}

/* ------------------------------------------------------------------ *
 * A4 defaults (twips → points; 1 point = 20 twips)
 * ------------------------------------------------------------------ */

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const DEFAULT_MARGIN_PT = 72; // Word's default 1-inch margin

const DEFAULT_PAGE: PageSetup = {
  widthPt: A4_WIDTH_PT,
  heightPt: A4_HEIGHT_PT,
  marginTopPt: DEFAULT_MARGIN_PT,
  marginRightPt: DEFAULT_MARGIN_PT,
  marginBottomPt: DEFAULT_MARGIN_PT,
  marginLeftPt: DEFAULT_MARGIN_PT,
};

/* ================================================================== *
 * ZIP reader (central-directory based)
 * ================================================================== */

const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0;

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  localOffset: number;
}

function findEocd(buf: Uint8Array): number {
  // End-of-central-directory signature 50 4B 05 06, searched from the end (comment may follow).
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

function readCentralDirectory(buf: Uint8Array): ZipEntry[] | null {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;

  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const entries: ZipEntry[] = [];

  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (u32(buf, p) !== 0x02014b50) break;
    const method = u16(buf, p + 10);
    const compSize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOffset = u32(buf, p + 42);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extractEntry(
  buf: Uint8Array,
  entry: ZipEntry,
  inflate: PdfInflate,
): Promise<Uint8Array | null> {
  const lo = entry.localOffset;
  if (lo + 30 > buf.length || u32(buf, lo) !== 0x04034b50) return null;

  const nameLen = u16(buf, lo + 26);
  const extraLen = u16(buf, lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const comp = buf.subarray(start, start + entry.compSize);

  if (entry.method === 0) return comp.slice();
  if (entry.method === 8) {
    try {
      return await inflate(comp);
    } catch {
      return null;
    }
  }
  return null;
}

/* ================================================================== *
 * document.xml parsing
 * ================================================================== */

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, ent: string) => {
    if (ent[0] === "#") {
      const code =
        ent[1] === "x" || ent[1] === "X"
          ? Number.parseInt(ent.slice(2), 16)
          : Number.parseInt(ent.slice(1), 10);
      // an out-of-range reference (&#99999999;) is kept as written instead of throwing
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return XML_ENTITIES[ent] ?? whole;
  });
}

/** Reads a boolean run property like <w:b/> or <w:b w:val="false"/>. */
function boolProp(rPr: string, tag: string): boolean {
  const m = rPr.match(new RegExp(`<w:${tag}\\b([^>]*?)/?>`));
  if (!m) return false;
  const val = m[1].match(/w:val="([^"]*)"/);
  if (val && /^(0|false|off|none)$/i.test(val[1])) return false;
  return true;
}

function attrInt(tag: string, attr: string): number | null {
  const m = tag.match(new RegExp(`${attr}="(-?\\d+)"`));
  return m ? Number.parseInt(m[1], 10) : null;
}

function parseRuns(inner: string): DocxRun[] {
  const runs: DocxRun[] = [];
  const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  let rm: RegExpExecArray | null = runRe.exec(inner);
  while (rm !== null) {
    const run = rm[1];
    const rPrMatch = run.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[1] : "";
    const bold = boolProp(rPr, "b");
    const italic = boolProp(rPr, "i");

    let text = "";
    const tokenRe =
      /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>/g;
    let tm: RegExpExecArray | null = tokenRe.exec(run);
    while (tm !== null) {
      if (tm[1] !== undefined) text += decodeXml(tm[1]);
      else if (tm[0].startsWith("<w:tab")) text += "\t";
      else text += "\n";
      tm = tokenRe.exec(run);
    }

    if (text.length > 0) runs.push({ text, bold, italic });
    rm = runRe.exec(inner);
  }
  return runs;
}

/**
 * Paragraph style ID -> style name from word/styles.xml. Localised Word writes
 * built-in styles with numeric or translated IDs (Russian Heading 1 is styleId "1"),
 * but the w:name stays the English built-in name ("heading 1").
 */
function parseStyleNames(xml: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const m of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = m[1].match(/w:styleId="([^"]*)"/);
    const name = m[2].match(/<w:name\b[^>]*w:val="([^"]*)"/);
    if (id && name) names.set(id[1], decodeXml(name[1]));
  }
  return names;
}

function levelFromStyle(val: string): number {
  const h = val.match(/heading\s*([1-9])/i);
  if (h) return Math.min(3, Number.parseInt(h[1], 10));
  if (/^title$/i.test(val)) return 1;
  if (/^subtitle$/i.test(val)) return 2;
  return 0;
}

function headingLevel(pPr: string, styleNames?: Map<string, string>): number {
  const style = pPr.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/);
  if (!style) return 0;
  const val = style[1];
  const byId = levelFromStyle(val);
  if (byId) return byId;
  const name = styleNames?.get(val);
  return name ? levelFromStyle(name) : 0;
}

function alignOf(pPr: string): DocxParagraph["align"] {
  const jc = pPr.match(/<w:jc\b[^>]*w:val="([^"]*)"/);
  if (!jc) return "left";
  const v = jc[1].toLowerCase();
  if (v === "center") return "center";
  if (v === "right" || v === "end") return "right";
  if (v === "both" || v === "distribute") return "justify";
  return "left";
}

function parsePageSetup(body: string): PageSetup {
  const sects = [...body.matchAll(/<w:sectPr\b[^>]*>([\s\S]*?)<\/w:sectPr>/g)];
  const sect = sects.length > 0 ? sects[sects.length - 1][1] : "";
  const page: PageSetup = { ...DEFAULT_PAGE };

  const pgSz = sect.match(/<w:pgSz\b[^>]*\/?>/);
  if (pgSz) {
    const w = attrInt(pgSz[0], "w:w");
    const h = attrInt(pgSz[0], "w:h");
    if (w && w > 0) page.widthPt = w / 20;
    if (h && h > 0) page.heightPt = h / 20;
  }

  const pgMar = sect.match(/<w:pgMar\b[^>]*\/?>/);
  if (pgMar) {
    const top = attrInt(pgMar[0], "w:top");
    const right = attrInt(pgMar[0], "w:right");
    const bottom = attrInt(pgMar[0], "w:bottom");
    const left = attrInt(pgMar[0], "w:left");
    if (top !== null) page.marginTopPt = Math.max(0, top / 20);
    if (right !== null) page.marginRightPt = Math.max(0, right / 20);
    if (bottom !== null) page.marginBottomPt = Math.max(0, bottom / 20);
    if (left !== null) page.marginLeftPt = Math.max(0, left / 20);
  }

  // Guard against nonsense values that would leave no room to draw.
  if (page.widthPt < 72 || page.widthPt > 4000) page.widthPt = A4_WIDTH_PT;
  if (page.heightPt < 72 || page.heightPt > 4000) page.heightPt = A4_HEIGHT_PT;
  if (page.marginLeftPt + page.marginRightPt > page.widthPt - 72) {
    page.marginLeftPt = DEFAULT_MARGIN_PT;
    page.marginRightPt = DEFAULT_MARGIN_PT;
  }
  if (page.marginTopPt + page.marginBottomPt > page.heightPt - 72) {
    page.marginTopPt = DEFAULT_MARGIN_PT;
    page.marginBottomPt = DEFAULT_MARGIN_PT;
  }
  return page;
}

function parseDocumentXml(
  xml: string,
  styleNames?: Map<string, string>,
): { paragraphs: DocxParagraph[]; page: PageSetup } {
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : xml;

  const paragraphs: DocxParagraph[] = [];
  const pRe = /<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g;
  let pm: RegExpExecArray | null = pRe.exec(body);
  while (pm !== null) {
    const inner = pm[1] ?? "";
    const pPrMatch = inner.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[1] : "";
    paragraphs.push({
      runs: parseRuns(inner),
      heading: headingLevel(pPr, styleNames),
      align: alignOf(pPr),
      bullet: /<w:numPr\b/.test(pPr),
    });
    pm = pRe.exec(body);
  }

  return { paragraphs, page: parsePageSetup(body) };
}

/* ================================================================== *
 * Public: parse a .docx into paragraphs + page setup
 * ================================================================== */

export async function parseDocx(data: Uint8Array, inflate: PdfInflate): Promise<DocxParseResult> {
  const empty: DocxParseResult = { ok: false, paragraphs: [], page: { ...DEFAULT_PAGE } };
  if (!data || data.length === 0) return { ...empty, error: "empty file" };

  // A .docx (like any ZIP) starts with "PK". A stored .doc (old binary) does not.
  if (!(data[0] === 0x50 && data[1] === 0x4b)) {
    return {
      ...empty,
      error: "this doesn't look like a .docx file — save it as .docx and try again",
    };
  }

  const entries = readCentralDirectory(data);
  if (!entries) return { ...empty, error: "could not read this .docx file" };

  const docEntry = entries.find(
    (e) => e.name.replace(/^\/+/, "").toLowerCase() === "word/document.xml",
  );
  if (!docEntry) return { ...empty, error: "not a valid Word document (no document.xml inside)" };

  const xmlBytes = await extractEntry(data, docEntry, inflate);
  if (!xmlBytes) return { ...empty, error: "could not read the document contents" };

  const xml = new TextDecoder().decode(xmlBytes);

  let styleNames: Map<string, string> | undefined;
  const stylesEntry = entries.find(
    (e) => e.name.replace(/^\/+/, "").toLowerCase() === "word/styles.xml",
  );
  if (stylesEntry) {
    const stylesBytes = await extractEntry(data, stylesEntry, inflate);
    if (stylesBytes) styleNames = parseStyleNames(new TextDecoder().decode(stylesBytes));
  }

  const { paragraphs, page } = parseDocumentXml(xml, styleNames);

  const hasText = paragraphs.some((p) => p.runs.some((r) => r.text.trim().length > 0));
  if (!hasText) return { ...empty, page, error: "this document has no readable text" };

  return { ok: true, paragraphs, page };
}

/* ================================================================== *
 * Minimal PDF writer (one full-page image per page)
 * ================================================================== */

function encodeLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

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

/**
 * Writes a PDF where each page is a single full-bleed JPEG at the given point size. Object layout
 * per page is fixed: image XObject, content stream, page dictionary — so object numbers are
 * predictable. The catalog is object 1 and the page tree is object 2.
 */
export function buildImagePdf(pages: RenderedPage[], page: PageSetup): Uint8Array {
  const w = new ByteWriter();
  w.text("%PDF-1.7\n");
  w.bytes(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const total = 2 + pages.length * 3;
  const offsets = new Array<number>(total).fill(0);

  const begin = (num: number) => {
    offsets[num - 1] = w.length;
    w.text(`${num} 0 obj\n`);
  };
  const end = () => w.text("\nendobj\n");

  const wpt = fmt(page.widthPt);
  const hpt = fmt(page.heightPt);

  // 1: catalog
  begin(1);
  w.text("<</Type /Catalog /Pages 2 0 R>>");
  end();

  // 2: page tree
  begin(2);
  w.text(`<</Type /Pages /Count ${pages.length} /Kids [`);
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) w.text(" ");
    w.text(`${5 + i * 3} 0 R`);
  }
  w.text("]>>");
  end();

  for (let i = 0; i < pages.length; i++) {
    const base = 3 + i * 3;
    const imgNum = base;
    const contentNum = base + 1;
    const pageNum = base + 2;
    const img = pages[i];

    // image XObject
    begin(imgNum);
    w.text(
      `<</Type /XObject /Subtype /Image /Width ${img.pxWidth} /Height ${img.pxHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length}>>\nstream\n`,
    );
    w.bytes(img.jpeg);
    w.text("\nendstream");
    end();

    // content stream: scale the unit image to fill the page
    const content = `q ${wpt} 0 0 ${hpt} 0 0 cm /Im0 Do Q`;
    const contentBytes = encodeLatin1(content);
    begin(contentNum);
    w.text(`<</Length ${contentBytes.length}>>\nstream\n`);
    w.bytes(contentBytes);
    w.text("\nendstream");
    end();

    // page
    begin(pageNum);
    w.text(
      `<</Type /Page /Parent 2 0 R /MediaBox [0 0 ${wpt} ${hpt}] ` +
        `/Resources <</XObject <</Im0 ${imgNum} 0 R>>>> /Contents ${contentNum} 0 R>>`,
    );
    end();
  }

  const xrefAt = w.length;
  const size = total + 1;
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

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
