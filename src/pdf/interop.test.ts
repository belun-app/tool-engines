/**
 * Interoperability with an independent PDF implementation: fixtures are written by pdf-lib
 * (a dev dependency only) in the layouts real files use — a classic xref table, xref and
 * object streams (PDF 1.5), and an incremental update appended to an existing file — and
 * every output of the page tools is opened again with pdf-lib and compared page by page.
 */
import { inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFPage,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  degrees,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { mergePdfs, readPdfInfo as mergerInfo } from "../file/pdf-merger.js";
import { addPageNumbers } from "./add-page-numbers-to-pdf.js";
import { deletePdfPages } from "./delete-pages-from-pdf.js";
import { rotatePdf } from "./pdf-page-rotator.js";
import { splitPdf } from "./pdf-splitter.js";
import { reorderPdfPages } from "./reorder-pdf-pages.js";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const hexOf = (s: string) => Buffer.from(s, "latin1").toString("hex");

/** Three pages: A4 with Helvetica, Letter turned 90 degrees, and a small page in Times. */
async function baseDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setProducer("fixture");
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const sizes: Array<[number, number]> = [
    [595, 842],
    [612, 792],
    [300, 400],
  ];
  sizes.forEach(([w, h], i) => {
    const page = doc.addPage([w, h]);
    page.drawText(`Page ${i + 1}`, {
      x: 40,
      y: h - 60,
      size: 18,
      font: i === 2 ? times : helvetica,
    });
    if (i === 1) page.setRotation(degrees(90));
  });
  return doc;
}

/**
 * A second revision appended to a classic-xref file, the way an editor saves changes without
 * rewriting the file: page 1 is replaced (new size, new content) and a fourth page is added,
 * with a new xref section and a trailer whose /Prev points at the original one.
 */
async function incrementalUpdate(original: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original);
  const text = latin1(original);
  const prevXref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1]);
  const pagesRef = doc.catalog.get(PDFName.of("Pages")) as PDFRef;
  const pageRefs = doc.getPages().map((p) => p.ref);
  const rootRef = doc.context.trailerInfo.Root as PDFRef;
  let next = doc.context.largestObjectNumber + 1;
  const font = next++;
  const content1 = next++;
  const content4 = next++;
  const page4 = next++;
  const ref = (n: number) => `${n} 0 R`;
  const stream = (s: string) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  const pageDict = (contents: number, box: string) =>
    `<< /Type /Page /Parent ${pagesRef.toString()} /MediaBox ${box} /Contents ${ref(contents)} /Resources << /Font << /F9 ${ref(font)} >> >> >>`;
  const objects: Array<[number, string]> = [
    [font, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"],
    [content1, stream("BT /F9 12 Tf 20 20 Td (Revised page 1) Tj ET")],
    [content4, stream("BT /F9 12 Tf 20 20 Td (Added page 4) Tj ET")],
    [pageRefs[0].objectNumber, pageDict(content1, "[0 0 200 200]")],
    [page4, pageDict(content4, "[0 0 250 150]")],
    [
      pagesRef.objectNumber,
      `<< /Type /Pages /Kids [${[...pageRefs.map((r) => r.toString()), ref(page4)].join(" ")}] /Count 4 >>`,
    ],
  ];
  let out = text.endsWith("\n") ? text : `${text}\n`;
  const offsets = new Map<number, number>();
  for (const [num, body] of objects) {
    offsets.set(num, out.length);
    out += `${num} 0 obj\n${body}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += "xref\n0 1\n0000000000 65535 f \n";
  for (const num of [...offsets.keys()].sort((a, b) => a - b)) {
    out += `${num} 1\n${String(offsets.get(num)).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${next} /Root ${rootRef.toString()} /Prev ${prevXref} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(out, "latin1"));
}

async function fixtures() {
  const classic = await (await baseDoc()).save({ useObjectStreams: false });
  const objectStreams = await (await baseDoc()).save({ useObjectStreams: true });
  const incremental = await incrementalUpdate(classic);
  return { classic, objectStreams, incremental };
}

/** The decoded bytes of a page's content streams, concatenated. */
function pageContent(doc: PDFDocument, page: PDFPage): string {
  const contents = page.node.get(PDFName.of("Contents"));
  const refs =
    contents instanceof PDFArray ? contents.asArray() : contents === undefined ? [] : [contents];
  let out = "";
  for (const r of refs) {
    const stream = r instanceof PDFRef ? doc.context.lookup(r) : r;
    if (!(stream instanceof PDFRawStream)) throw new Error("content is not a stream");
    const filter = stream.dict.get(PDFName.of("Filter"));
    const bytes = filter ? inflateSync(stream.contents) : stream.contents;
    out += `${latin1(bytes)}\n`;
  }
  return out;
}

interface PageFacts {
  width: number;
  height: number;
  rotation: number;
  content: string;
}

async function open(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
  const pages: PageFacts[] = doc.getPages().map((page) => {
    const box = page.getMediaBox();
    return {
      width: box.width,
      height: box.height,
      rotation: page.getRotation().angle,
      content: pageContent(doc, page),
    };
  });
  return { doc, pages };
}

/** Same size, the expected rotation, and the source's content stream bytes all still there. */
function expectSamePage(out: PageFacts, src: PageFacts, rotation = src.rotation) {
  expect({ width: out.width, height: out.height, rotation: out.rotation }).toEqual({
    width: src.width,
    height: src.height,
    rotation,
  });
  expect(out.content).toContain(src.content.trim());
}

const KINDS = ["classic", "objectStreams", "incremental"] as const;

describe("pdf-lib fixtures", () => {
  it("are what the tests assume: pages, sizes, rotations and text", async () => {
    const f = await fixtures();
    expect(latin1(f.classic)).toMatch(/\nxref\n/);
    expect(latin1(f.objectStreams)).toMatch(/\/Type \/ObjStm/);
    expect(latin1(f.objectStreams)).toMatch(/\/Type \/XRef/);
    expect(latin1(f.incremental).match(/%%EOF/g)).toHaveLength(2);
    expect(latin1(f.incremental)).toMatch(/\/Prev \d+/);

    const classic = (await open(f.classic)).pages;
    expect(classic.map((p) => [p.width, p.height, p.rotation])).toEqual([
      [595, 842, 0],
      [612, 792, 90],
      [300, 400, 0],
    ]);
    classic.forEach((p, i) => expect(p.content).toContain(hexOf(`Page ${i + 1}`).toUpperCase()));

    const incremental = (await open(f.incremental)).pages;
    expect(incremental.map((p) => [p.width, p.height])).toEqual([
      [200, 200],
      [612, 792],
      [300, 400],
      [250, 150],
    ]);
    expect(incremental[0].content).toContain("(Revised page 1)");
  });
});

describe.each(KINDS)("%s fixture through the page tools, re-opened with pdf-lib", (kind) => {
  async function source() {
    const bytes = (await fixtures())[kind];
    return { bytes, pages: (await open(bytes)).pages };
  }

  it("reports the same page count as pdf-lib", async () => {
    const src = await source();
    expect(await mergerInfo(src.bytes, inflate)).toEqual({
      ok: true,
      pageCount: src.pages.length,
    });
  });

  it("merges the file with itself", async () => {
    const src = await source();
    const r = await mergePdfs(
      [
        { name: "a.pdf", data: src.bytes },
        { name: "b.pdf", data: src.bytes },
      ],
      inflate,
    );
    expect(r.error).toBeUndefined();
    const out = (await open(r.bytes)).pages;
    expect(out).toHaveLength(src.pages.length * 2);
    out.forEach((p, i) => expectSamePage(p, src.pages[i % src.pages.length]));
  });

  it("splits into one file per page and extracts a range", async () => {
    const src = await source();
    const each = await splitPdf(src.bytes, { mode: "each", baseName: "doc" }, inflate);
    expect(each.error).toBeUndefined();
    expect(each.files).toHaveLength(src.pages.length);
    for (const [i, file] of each.files.entries()) {
      const out = (await open(file.bytes)).pages;
      expect(out).toHaveLength(1);
      expectSamePage(out[0], src.pages[i]);
    }
    const range = await splitPdf(src.bytes, { mode: "extract", ranges: "2-3" }, inflate);
    const out = (await open(range.files[0].bytes)).pages;
    expect(out).toHaveLength(2);
    expectSamePage(out[0], src.pages[1]);
    expectSamePage(out[1], src.pages[2]);
  });

  it("rotates selected pages on top of their own rotation", async () => {
    const src = await source();
    const r = await rotatePdf(src.bytes, { angle: 90, ranges: "1-2" }, inflate);
    expect(r.error).toBeUndefined();
    expect(r.rotatedCount).toBe(2);
    const out = (await open(r.bytes)).pages;
    expect(out).toHaveLength(src.pages.length);
    out.forEach((p, i) =>
      expectSamePage(p, src.pages[i], i < 2 ? (src.pages[i].rotation + 90) % 360 : undefined),
    );
  });

  it("deletes and reorders pages", async () => {
    const src = await source();
    const del = await deletePdfPages(src.bytes, { pages: "2" }, inflate);
    expect(del.error).toBeUndefined();
    const kept = (await open(del.bytes)).pages;
    expect(kept).toHaveLength(src.pages.length - 1);
    expectSamePage(kept[0], src.pages[0]);
    expectSamePage(kept[1], src.pages[2]);

    const order = src.pages.map((_, i) => src.pages.length - i);
    const re = await reorderPdfPages(src.bytes, { order }, inflate);
    expect(re.error).toBeUndefined();
    const reordered = (await open(re.bytes)).pages;
    reordered.forEach((p, i) => expectSamePage(p, src.pages[order[i] - 1]));
  });

  it("stamps page numbers with a font every page can resolve", async () => {
    const src = await source();
    const r = await addPageNumbers(src.bytes, {}, inflate);
    expect(r.error).toBeUndefined();
    const { doc, pages } = await open(r.bytes);
    pages.forEach((p, i) => {
      expectSamePage(p, src.pages[i]);
      // The stamp names its font, and that name is in the page's own font resources.
      const font = /\/(\w+) [\d.]+ Tf\s+0 g/.exec(p.content)?.[1];
      expect(font).toBeTruthy();
      const resources = doc.getPages()[i].node.Resources();
      const fonts = resources?.lookup(PDFName.of("Font"), PDFDict);
      expect(fonts?.has(PDFName.of(font as string))).toBe(true);
    });
  });
});
