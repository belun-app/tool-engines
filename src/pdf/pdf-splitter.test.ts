import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pageBox, pageRotation, parseDocument } from "./_pdf-lib.js";
import { readPdfInfo, splitPdf, zipPdfFiles } from "./pdf-splitter.js";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

interface TestPage {
  box?: [number, number];
  rotate?: number;
  text: string;
}

function makePdf(pages: TestPage[]) {
  const bodies: string[] = [];
  const kids: string[] = [];
  pages.forEach((p, i) => {
    const pageNum = 3 + i * 2;
    kids.push(`${pageNum} 0 R`);
    const box = p.box ? ` /MediaBox [0 0 ${p.box[0]} ${p.box[1]}]` : "";
    const rot = p.rotate !== undefined ? ` /Rotate ${p.rotate}` : "";
    bodies[pageNum] = `<< /Type /Page /Parent 2 0 R${box}${rot} /Contents ${pageNum + 1} 0 R >>`;
    const s = `BT (${p.text}) Tj ET`;
    bodies[pageNum + 1] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  });
  bodies[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  bodies[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n";
  for (let n = 1; n < bodies.length; n++) out += `${n} 0 obj\n${bodies[n]}\nendobj\n`;
  out += "trailer\n<< /Root 1 0 R >>\n%%EOF\n";
  return latin1(out);
}

const nPages = (n: number) => makePdf(Array.from({ length: n }, (_, i) => ({ text: `p${i + 1}` })));

async function texts(bytes: Uint8Array) {
  const { doc, error } = await parseDocument(bytes, inflate);
  if (!doc) throw new Error(error);
  return doc.pages.map((p) => {
    const c = p.dict.v.get("Contents");
    const s = c?.k === "ref" ? doc.objects.get(c.n) : undefined;
    return /\((.*)\)/.exec(s?.k === "stream" ? Buffer.from(s.raw).toString("latin1") : "")?.[1];
  });
}

describe("readPdfInfo", () => {
  it("counts pages and rejects empty input", async () => {
    expect(await readPdfInfo(nPages(4), inflate)).toEqual({ ok: true, pageCount: 4 });
    expect((await readPdfInfo(new Uint8Array(), inflate)).error).toBe("empty file");
    expect((await readPdfInfo(latin1("plain text"), inflate)).ok).toBe(false);
  });
});

describe("splitPdf — extract", () => {
  it("pulls the chosen pages into one file, in page order", async () => {
    const r = await splitPdf(
      nPages(5),
      { mode: "extract", ranges: "4, 1-2", baseName: "report.pdf" },
      inflate,
    );
    expect(r.ok).toBe(true);
    expect(r.files).toHaveLength(1);
    expect(r.files[0].name).toBe("report-pages.pdf");
    expect(r.files[0].pageCount).toBe(3);
    expect(r.files[0].sizeBytes).toBe(r.files[0].bytes.length);
    expect(r.totalPages).toBe(3);
    expect(await texts(r.files[0].bytes)).toEqual(["p1", "p2", "p4"]);
  });

  it("names a single extracted page after its number", async () => {
    const r = await splitPdf(nPages(5), { mode: "extract", ranges: "3", baseName: "x" }, inflate);
    expect(r.files[0].name).toBe("x-page-3.pdf");
  });

  it("keeps page size and rotation", async () => {
    const pdf = makePdf([{ text: "a" }, { text: "b", box: [100, 50], rotate: 270 }]);
    const r = await splitPdf(pdf, { mode: "extract", ranges: "2" }, inflate);
    const { doc } = await parseDocument(r.files[0].bytes, inflate);
    expect(doc && pageBox(doc, doc.pages[0])).toEqual({ x0: 0, y0: 0, width: 100, height: 50 });
    expect(doc && pageRotation(doc.pages[0])).toBe(270);
  });

  it("passes on range errors", async () => {
    expect((await splitPdf(nPages(2), { mode: "extract" }, inflate)).error).toBe(
      "enter which pages you want",
    );
    expect((await splitPdf(nPages(2), { mode: "extract", ranges: "5" }, inflate)).error).toBe(
      "no pages in range (this PDF has 2)",
    );
  });
});

describe("splitPdf — each / every", () => {
  it("writes one file per page", async () => {
    const r = await splitPdf(nPages(3), { mode: "each", baseName: "doc" }, inflate);
    expect(r.files.map((f) => f.name)).toEqual([
      "doc-page-1.pdf",
      "doc-page-2.pdf",
      "doc-page-3.pdf",
    ]);
    expect(await texts(r.files[2].bytes)).toEqual(["p3"]);
    expect(r.totalPages).toBe(3);
  });

  it("chunks every N pages, the last chunk taking the remainder", async () => {
    // 5 pages by 2 -> [1,2] [3,4] [5]
    const r = await splitPdf(nPages(5), { mode: "every", everyN: 2, baseName: "d" }, inflate);
    expect(r.files.map((f) => f.name)).toEqual([
      "d-part-1_1-2.pdf",
      "d-part-2_3-4.pdf",
      "d-part-3_5.pdf",
    ]);
    expect(r.files.map((f) => f.pageCount)).toEqual([2, 2, 1]);
    expect(await texts(r.files[1].bytes)).toEqual(["p3", "p4"]);
  });

  it("zero-pads part numbers to the width of the part count", async () => {
    const r = await splitPdf(nPages(10), { mode: "every", everyN: 1, baseName: "d" }, inflate);
    expect(r.files[0].name).toBe("d-part-01_1.pdf");
    expect(r.files[9].name).toBe("d-part-10_10.pdf");
  });

  it("floors a fractional N and rejects N < 1", async () => {
    const r = await splitPdf(nPages(5), { mode: "every", everyN: 2.9 }, inflate);
    expect(r.files).toHaveLength(3);
    for (const everyN of [0, 0.5, -3, Number.NaN, undefined]) {
      const bad = await splitPdf(nPages(5), { mode: "every", everyN }, inflate);
      expect(bad.ok).toBe(false);
      expect(bad.error).toBe("enter how many pages per file (1 or more)");
    }
  });

  it("gives one file when N exceeds the page count", async () => {
    const r = await splitPdf(nPages(3), { mode: "every", everyN: 50, baseName: "d" }, inflate);
    expect(r.files.map((f) => f.name)).toEqual(["d-part-1_1-3.pdf"]);
  });
});

describe("splitPdf — names and errors", () => {
  it("sanitises the base name and defaults to 'document'", async () => {
    const name = async (baseName?: string) =>
      (await splitPdf(nPages(1), { mode: "each", baseName }, inflate)).files[0].name;
    expect(await name("My Report (final).PDF")).toBe("My_Report_final_-page-1.pdf");
    expect(await name("")).toBe("document-page-1.pdf");
    expect(await name(undefined)).toBe("document-page-1.pdf");
    expect(await name("  .pdf")).toBe("document-page-1.pdf");
  });

  it("keeps a Cyrillic base name readable", async () => {
    const r = await splitPdf(nPages(1), { mode: "each", baseName: "Отчёт.pdf" }, inflate);
    expect(r.files[0].name).toBe("Отчёт-page-1.pdf");
  });

  it("returns an error, not a throw, for empty or broken input", async () => {
    expect(await splitPdf(new Uint8Array(), { mode: "each" }, inflate)).toEqual({
      ok: false,
      files: [],
      totalPages: 0,
      error: "add a PDF first",
    });
    const r = await splitPdf(latin1("%PDF-1.4\ngarbage"), { mode: "each" }, inflate);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/corrupt/);
  });
});

describe("zipPdfFiles", () => {
  it("bundles every output into one stored ZIP", async () => {
    const r = await splitPdf(nPages(3), { mode: "each", baseName: "z" }, inflate);
    const zip = zipPdfFiles(r.files, "z.zip");
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50); // local file header
    const eocd = zip.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(3); // total entries
    const asText = Buffer.from(zip).toString("latin1");
    for (const f of r.files) expect(asText).toContain(f.name);
  });
});
