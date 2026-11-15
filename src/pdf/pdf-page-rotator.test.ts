import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pageBox, pageRotation, parseDocument } from "./_pdf-lib.js";
import { readPdfInfo, rotatePdf } from "./pdf-page-rotator.js";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

interface TestPage {
  box?: [number, number];
  rotate?: number;
  text: string;
}

/** Hand-written PDF: 1 = catalog, 2 = page tree, then a page + content pair per page. */
function makePdf(pages: TestPage[], tree: { rotate?: number } = {}) {
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
  const treeRot = tree.rotate !== undefined ? ` /Rotate ${tree.rotate}` : "";
  bodies[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  bodies[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length}${treeRot} >>`;
  let out = "%PDF-1.4\n";
  for (let n = 1; n < bodies.length; n++) out += `${n} 0 obj\n${bodies[n]}\nendobj\n`;
  out += "trailer\n<< /Root 1 0 R >>\n%%EOF\n";
  return latin1(out);
}

async function inspect(bytes: Uint8Array) {
  const { doc, error } = await parseDocument(bytes, inflate);
  if (!doc) throw new Error(error);
  return doc.pages.map((p) => {
    const c = p.dict.v.get("Contents");
    const s = c?.k === "ref" ? doc.objects.get(c.n) : undefined;
    const raw = s?.k === "stream" ? Buffer.from(s.raw).toString("latin1") : "";
    return { rotation: pageRotation(p), box: pageBox(doc, p), text: /\((.*)\)/.exec(raw)?.[1] };
  });
}

const threePages = () =>
  makePdf([{ text: "a", box: [200, 300] }, { text: "b", rotate: 90 }, { text: "c" }], {
    rotate: 180,
  });

describe("readPdfInfo", () => {
  it("counts pages", async () => {
    expect(await readPdfInfo(threePages(), inflate)).toEqual({ ok: true, pageCount: 3 });
  });

  it("rejects empty, non-PDF and encrypted input with a message", async () => {
    expect(await readPdfInfo(new Uint8Array(), inflate)).toEqual({
      ok: false,
      error: "empty file",
      pageCount: 0,
    });
    expect((await readPdfInfo(latin1("GIF89a"), inflate)).error).toBe("not a PDF file");
    const enc = latin1(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 5 0 R >>\n",
    );
    expect((await readPdfInfo(enc, inflate)).error).toMatch(/password/);
  });
});

describe("rotatePdf", () => {
  it("asks for a file and a non-zero angle", async () => {
    expect((await rotatePdf(new Uint8Array(), { angle: 90 }, inflate)).error).toBe(
      "add a PDF first",
    );
    for (const angle of [0, 360, -720, Number.NaN]) {
      const r = await rotatePdf(threePages(), { angle }, inflate);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/choose a rotation/);
      expect(r.bytes).toHaveLength(0);
    }
  });

  it("adds the angle to each page's existing (own or inherited) rotation", async () => {
    // Own rotations: a inherits 180, b has 90, c inherits 180. +90 -> 270, 180, 270.
    const r = await rotatePdf(threePages(), { angle: 90 }, inflate);
    expect(r.ok).toBe(true);
    expect(r.pageCount).toBe(3);
    expect(r.rotatedCount).toBe(3);
    expect(r.sizeBytes).toBe(r.bytes.length);
    const pages = await inspect(r.bytes);
    expect(pages.map((p) => p.rotation)).toEqual([270, 180, 270]);
    expect(pages.map((p) => p.text)).toEqual(["a", "b", "c"]);
    expect(pages[0].box).toEqual({ x0: 0, y0: 0, width: 200, height: 300 });
  });

  it("wraps past 360 and accepts negative angles", async () => {
    // 180 (inherited) + 180 = 360 -> 0; 90 + 180 = 270
    let pages = await inspect((await rotatePdf(threePages(), { angle: 180 }, inflate)).bytes);
    expect(pages.map((p) => p.rotation)).toEqual([0, 270, 0]);
    // -90 is a counter-clockwise quarter turn: 180-90 = 90, 90-90 = 0
    pages = await inspect((await rotatePdf(threePages(), { angle: -90 }, inflate)).bytes);
    expect(pages.map((p) => p.rotation)).toEqual([90, 0, 90]);
  });

  it("rotates only the selected pages and keeps the others as they were", async () => {
    const r = await rotatePdf(threePages(), { angle: 270, ranges: "2" }, inflate);
    expect(r.rotatedCount).toBe(1);
    const pages = await inspect(r.bytes);
    expect(pages.map((p) => p.rotation)).toEqual([180, 0, 180]);
  });

  it("treats a whitespace-only selection as every page", async () => {
    const r = await rotatePdf(threePages(), { angle: 90, ranges: "   " }, inflate);
    expect(r.rotatedCount).toBe(3);
  });

  it("returns the range parser's error for a bad or out-of-range selection", async () => {
    expect((await rotatePdf(threePages(), { angle: 90, ranges: "x" }, inflate)).error).toBe(
      '"x" is not a page number or range',
    );
    expect((await rotatePdf(threePages(), { angle: 90, ranges: "7-9" }, inflate)).error).toBe(
      "no pages in range (this PDF has 3)",
    );
  });

  it("returns the parser error for an unreadable file", async () => {
    const r = await rotatePdf(latin1("%PDF-1.4\n"), { angle: 90 }, inflate);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no PDF objects/);
  });
});
