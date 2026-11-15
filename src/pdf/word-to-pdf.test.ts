import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildZip } from "../_zip.js";
import { intOf, nameOf, pageBox, parseDocument } from "./_pdf-lib.js";
import { buildImagePdf, formatFileSize, parseDocx } from "./word-to-pdf.js";

/** CRC-32 (IEEE), written out because node:zlib only has crc32 from Node 20.15 / 22.2. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// .docx entries are raw deflate (DecompressionStream("deflate-raw") in the browser).
const inflateRaw = async (d: Uint8Array) => new Uint8Array(inflateRawSync(d));
const utf8 = (s: string) => new TextEncoder().encode(s);

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const doc = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
const para = (inner: string, pPr = "") =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;
const run = (t: string, rPr = "") =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${t}</w:t></w:r>`;

/** A stored (uncompressed) .docx with the given document.xml. */
const storedDocx = (xml: string, name = "word/document.xml") =>
  buildZip([
    { name: "[Content_Types].xml", data: utf8("<Types/>") },
    { name, data: utf8(xml) },
  ]);

/** A single-entry ZIP whose entry is raw-deflated (method 8), written by hand. */
function deflatedZip(name: string, data: Uint8Array, method = 8): Uint8Array {
  const comp = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
  const nameBytes = utf8(name);
  const crc = crc32(data);
  const local = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, method, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, comp.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);

  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(10, method, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, comp.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const cdOffset = local.length + comp.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, cdOffset, true);
  return Uint8Array.from([...local, ...comp, ...central, ...eocd]);
}

describe("parseDocx — container errors", () => {
  it("rejects empty input and non-ZIP files (old .doc)", async () => {
    expect((await parseDocx(new Uint8Array(), inflateRaw)).error).toBe("empty file");
    const doc97 = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const r = await parseDocx(doc97, inflateRaw);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/doesn't look like a \.docx/);
    expect(r.paragraphs).toEqual([]);
  });

  it("rejects a ZIP signature without a central directory", async () => {
    expect((await parseDocx(utf8("PK\x03\x04 truncated"), inflateRaw)).error).toBe(
      "could not read this .docx file",
    );
  });

  it("rejects a ZIP without word/document.xml", async () => {
    const zip = buildZip([{ name: "hello.txt", data: utf8("hi") }]);
    expect((await parseDocx(zip, inflateRaw)).error).toMatch(/no document\.xml/);
  });

  it("reports unreadable entries (bad deflate data, unsupported method)", async () => {
    const xml = utf8(doc(para(run("x"))));
    const broken = deflatedZip("word/document.xml", xml);
    broken.fill(0xff, 30 + 17, 30 + 25); // corrupt the deflate stream
    expect((await parseDocx(broken, inflateRaw)).error).toBe(
      "could not read the document contents",
    );
    const bzip = deflatedZip("word/document.xml", xml, 12);
    expect((await parseDocx(bzip, inflateRaw)).error).toBe("could not read the document contents");
  });

  it("reports a document with no text but still returns its page setup", async () => {
    const r = await parseDocx(
      storedDocx(doc('<w:p/><w:p></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>')),
      inflateRaw,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("this document has no readable text");
    expect(r.page.widthPt).toBe(612);
  });
});

describe("parseDocx — content", () => {
  it("reads a deflated entry and finds it case-insensitively with a leading slash", async () => {
    const r = await parseDocx(
      deflatedZip("/Word/Document.XML", utf8(doc(para(run("Привет, мир"))))),
      inflateRaw,
    );
    expect(r.ok).toBe(true);
    expect(r.paragraphs[0].runs[0].text).toBe("Привет, мир");
  });

  it("keeps runs with bold/italic, honouring w:val=false/0", async () => {
    const xml = doc(
      para(
        run("plain") +
          run("bold", "<w:b/>") +
          run("both", '<w:b w:val="1"/><w:i/>') +
          run("notbold", '<w:b w:val="0"/><w:bCs/>') +
          run("notitalic", '<w:i w:val="false"/>'),
      ),
    );
    const r = await parseDocx(storedDocx(xml), inflateRaw);
    expect(r.paragraphs[0].runs).toEqual([
      { text: "plain", bold: false, italic: false },
      { text: "bold", bold: true, italic: false },
      { text: "both", bold: true, italic: true },
      { text: "notbold", bold: false, italic: false },
      { text: "notitalic", bold: false, italic: false },
    ]);
  });

  it("turns tabs and breaks into characters and decodes entities", async () => {
    const xml = doc(
      para(
        `<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:cr/></w:r>${run("&amp; &lt;x&gt; &quot;q&quot; &apos;s&apos; &#65;&#x416;&#x1F600; &bogus;")}`,
      ),
    );
    const r = await parseDocx(storedDocx(xml), inflateRaw);
    expect(r.paragraphs[0].runs.map((x) => x.text)).toEqual([
      "a\tb\nc\n",
      `& <x> "q" 's' AЖ😀 &bogus;`,
    ]);
  });

  it("reads heading levels, alignment and bullets", async () => {
    const style = (v: string) => `<w:pStyle w:val="${v}"/>`;
    const jc = (v: string) => `<w:jc w:val="${v}"/>`;
    const xml = doc(
      para(run("t"), style("Title")) +
        para(run("s"), style("Subtitle")) +
        para(run("h1"), style("Heading1")) +
        para(run("h2"), style("heading 2")) +
        para(run("h5"), style("Heading5")) +
        para(run("c"), jc("center")) +
        para(run("r"), jc("end")) +
        para(run("j"), jc("both")) +
        para(run("d"), jc("distribute")) +
        para(run("l"), jc("start")) +
        para(run("b"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
        para(run("n"), style("Normal")),
    );
    const r = await parseDocx(storedDocx(xml), inflateRaw);
    expect(r.paragraphs.map((p) => p.heading)).toEqual([1, 2, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.paragraphs.map((p) => p.align)).toEqual([
      "left",
      "left",
      "left",
      "left",
      "left",
      "center",
      "right",
      "justify",
      "justify",
      "left",
      "left",
      "left",
    ]);
    expect(r.paragraphs.map((p) => p.bullet)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it("keeps empty paragraphs, reads runs inside hyperlinks and skips deleted text", async () => {
    const xml = doc(
      `<w:p/>${para(`<w:hyperlink r:id="rId5">${run("link")}</w:hyperlink>`)}${para(`<w:del><w:r><w:delText>gone</w:delText></w:r></w:del>${run("kept")}`)}`,
    );
    const r = await parseDocx(storedDocx(xml), inflateRaw);
    expect(r.paragraphs).toHaveLength(3);
    expect(r.paragraphs[0].runs).toEqual([]);
    expect(r.paragraphs[1].runs[0].text).toBe("link");
    expect(r.paragraphs[2].runs.map((x) => x.text)).toEqual(["kept"]);
  });

  it("detects a heading whose localised style ID maps to 'heading 1'", async () => {
    const styles = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style></w:styles>`;
    const zip = buildZip([
      { name: "word/styles.xml", data: utf8(styles) },
      {
        name: "word/document.xml",
        data: utf8(doc(para(run("Введение"), '<w:pStyle w:val="1"/>'))),
      },
    ]);
    const r = await parseDocx(zip, inflateRaw);
    expect(r.paragraphs[0].heading).toBe(1);
  });

  it("does not throw on an out-of-range numeric entity", async () => {
    await expect(
      parseDocx(storedDocx(doc(para(run("x &#99999999; y")))), inflateRaw),
    ).resolves.toBeDefined();
  });
});

describe("parseDocx — page setup", () => {
  const withSect = (sect: string) => storedDocx(doc(para(run("x")) + sect));

  it("defaults to A4 with 1-inch margins", async () => {
    const r = await parseDocx(storedDocx(doc(para(run("x")))), inflateRaw);
    expect(r.page).toEqual({
      widthPt: 595.28,
      heightPt: 841.89,
      marginTopPt: 72,
      marginRightPt: 72,
      marginBottomPt: 72,
      marginLeftPt: 72,
    });
  });

  it("converts twips to points (1 pt = 20 twips)", async () => {
    const r = await parseDocx(
      withSect(
        '<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" w:right="1080" w:bottom="1440" w:left="1800" w:header="708"/></w:sectPr>',
      ),
      inflateRaw,
    );
    // Letter landscape 792 x 612; margins 36 / 54 / 72 / 90
    expect(r.page).toEqual({
      widthPt: 792,
      heightPt: 612,
      marginTopPt: 36,
      marginRightPt: 54,
      marginBottomPt: 72,
      marginLeftPt: 90,
    });
  });

  it("uses the last section's properties", async () => {
    const r = await parseDocx(
      storedDocx(
        doc(
          `${para(run("a"), '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>`,
        ),
      ),
      inflateRaw,
    );
    expect(r.page.widthPt).toBeCloseTo(595.3, 10);
    expect(r.page.heightPt).toBeCloseTo(841.9, 10);
  });

  it("falls back on nonsense sizes and margins that leave no room", async () => {
    const r = await parseDocx(
      withSect(
        '<w:sectPr><w:pgSz w:w="500" w:h="99999"/><w:pgMar w:top="-100" w:right="6000" w:bottom="0" w:left="6000"/></w:sectPr>',
      ),
      inflateRaw,
    );
    // 25 pt wide and 4999.95 pt tall are both out of range -> A4. Left+right 600 pt > width - 72 -> reset.
    expect(r.page).toEqual({
      widthPt: 595.28,
      heightPt: 841.89,
      marginTopPt: 0,
      marginRightPt: 72,
      marginBottomPt: 0,
      marginLeftPt: 72,
    });
  });
});

describe("buildImagePdf", () => {
  const page = {
    widthPt: 595.28,
    heightPt: 841.89,
    marginTopPt: 72,
    marginRightPt: 72,
    marginBottomPt: 72,
    marginLeftPt: 72,
  };
  const jpeg = (n: number) => Uint8Array.from([0xff, 0xd8, n, n, n, 0xff, 0xd9]);

  it("writes one full-page image per page with a valid xref", async () => {
    const bytes = buildImagePdf(
      [
        { jpeg: jpeg(1), pxWidth: 1240, pxHeight: 1754 },
        { jpeg: jpeg(2), pxWidth: 10, pxHeight: 20 },
      ],
      page,
    );
    const s = Buffer.from(bytes).toString("latin1");
    const xrefAt = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const offsets = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(8); // catalog, tree, 3 objects per page
    offsets.forEach((off, i) =>
      expect(s.slice(off, off + 7 + String(i + 1).length)).toBe(`${i + 1} 0 obj\n`),
    );

    const { doc: pdf, error } = await parseDocument(bytes, async (d) => d);
    expect(error).toBeUndefined();
    expect(pdf?.pages).toHaveLength(2);
    if (!pdf) return;
    expect(pageBox(pdf, pdf.pages[0])).toEqual({ x0: 0, y0: 0, width: 595.28, height: 841.89 });
    const img = pdf.objects.get(6);
    expect(img?.k === "stream" && [...img.raw]).toEqual([...jpeg(2)]);
    if (img?.k === "stream") {
      expect(nameOf(img.d, "Filter")).toBe("DCTDecode");
      expect(intOf(img.d, "Width")).toBe(10);
      expect(intOf(img.d, "Height")).toBe(20);
    }
    const content = pdf.objects.get(4);
    expect(content?.k === "stream" && Buffer.from(content.raw).toString("latin1")).toBe(
      "q 595.28 0 0 841.89 0 0 cm /Im0 Do Q",
    );
  });

  it("writes a structurally valid file with no pages", async () => {
    const r = await parseDocument(buildImagePdf([], page), async (d) => d);
    expect(r.error).toBe("no pages found");
  });
});

describe("formatFileSize", () => {
  it("formats sizes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
