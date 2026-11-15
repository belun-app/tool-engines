import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractPdfText, formatFileSize, pdfToWord } from "./pdf-to-word.js";

/** CRC-32 (IEEE), written out because node:zlib only has crc32 from Node 20.15 / 22.2. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

const streamObj = (content: string | Uint8Array, extra = "") => {
  const bytes = typeof content === "string" ? latin1(content) : content;
  return [latin1(`<< /Length ${bytes.length}${extra} >>\nstream\n`), bytes, latin1("\nendstream")];
};

/**
 * Pages are objects 10, 20, 30… with their content at +1. Shared resources (fonts etc.) are
 * passed as extra objects. `contents` may be a string, raw bytes, or a full Contents value.
 */
function makePdf(
  pages: Array<{ content?: string | Uint8Array; contentsValue?: string; filter?: string }>,
  resources = "<< /Font << /F1 5 0 R >> >>",
  extra: Record<number, Array<Uint8Array> | string> = {},
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const add = (n: number, body: Array<Uint8Array> | string) => {
    chunks.push(latin1(`${n} 0 obj\n`));
    if (typeof body === "string") chunks.push(latin1(body));
    else chunks.push(...body);
    chunks.push(latin1("\nendobj\n"));
  };
  chunks.push(latin1("%PDF-1.4\n"));
  add(1, "<< /Type /Catalog /Pages 2 0 R >>");
  add(
    2,
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${10 * (i + 1)} 0 R`).join(" ")}] /Resources ${resources} >>`,
  );
  add(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((p, i) => {
    const n = 10 * (i + 1);
    add(n, `<< /Type /Page /Parent 2 0 R /Contents ${p.contentsValue ?? `${n + 1} 0 R`} >>`);
    if (p.content !== undefined)
      add(n + 1, streamObj(p.content, p.filter ? ` /Filter /${p.filter}` : ""));
  });
  for (const [n, body] of Object.entries(extra)) add(Number(n), body);
  chunks.push(latin1("trailer\n<< /Root 1 0 R >>\n%%EOF\n"));
  return Uint8Array.from(chunks.flatMap((c) => [...c]));
}

async function textOf(
  content: string | Uint8Array,
  opts: Parameters<typeof makePdf>[1] = undefined,
  extra = {},
) {
  const r = await extractPdfText(makePdf([{ content }], opts, extra), inflate);
  expect(r.ok).toBe(true);
  return r.pages[0];
}

/** Minimal reader for the stored ZIP the converter writes: name -> bytes, CRC-checked. */
function readStoredZip(zip: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    const lName = view.getUint16(local + 26, true);
    const lExtra = view.getUint16(local + 28, true);
    const data = zip.subarray(local + 30 + lName + lExtra, local + 30 + lName + lExtra + size);
    expect(method).toBe(0);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("extractPdfText — layout", () => {
  it("joins lines moved by Td with a newline", async () => {
    expect(await textOf("BT /F1 12 Tf 72 700 Td (Hello) Tj 0 -14 Td (World) Tj ET")).toBe(
      "Hello\nWorld",
    );
  });

  it("inserts a blank line for a gap larger than 1.6 x the font size", async () => {
    // 30 > 12 * 1.6 = 19.2
    expect(await textOf("BT /F1 12 Tf 72 700 Td (One) Tj 0 -30 Td (Two) Tj ET")).toBe("One\n\nTwo");
  });

  it("adds a space between runs moved along the same line", async () => {
    expect(await textOf("BT /F1 12 Tf 72 700 Td (Hello) Tj 40 0 Td (World) Tj ET")).toBe(
      "Hello World",
    );
  });

  it("ignores small vertical shifts (superscripts)", async () => {
    // threshold = max(2, 12 * 0.4) = 4.8
    expect(await textOf("BT /F1 12 Tf 72 700 Td (x) Tj 0 4 Td (2) Tj ET")).toBe("x 2");
  });

  it("reads TJ arrays, turning kerning of -200 or more into a space", async () => {
    expect(await textOf("BT /F1 12 Tf [(Hel) 20 (lo) -250 (World)] TJ ET")).toBe("Hello World");
    expect(await textOf("BT /F1 12 Tf [(Hel) -199 (lo)] TJ ET")).toBe("Hello");
  });

  it("handles T*, TL, TD, Tm, ' and \" line operators", async () => {
    expect(await textOf("BT /F1 10 Tf 14 TL 0 700 Td (a) Tj T* (b) Tj (c) ' 1 2 (d) \" ET")).toBe(
      "a\nb\nc\nd",
    );
    expect(await textOf("BT /F1 10 Tf 0 700 TD (a) Tj 0 -12 TD (b) Tj T* (c) Tj ET")).toBe(
      "a\nb\nc",
    );
    expect(await textOf("BT /F1 10 Tf 1 0 0 1 72 700 Tm (a) Tj 1 0 0 1 72 688 Tm (b) Tj ET")).toBe(
      "a\nb",
    );
  });

  it("skips comments, marked-content dictionaries and inline images", async () => {
    const content =
      "% a comment (not text) Tj\n/P << /MCID 0 >> BDC BT /F1 12 Tf (Tagged) Tj ET EMC\n" +
      "BI /W 2 /H 1 /CS /G /BPC 8 ID \x01\x02 EI\nBT /F1 12 Tf 0 -40 Td (After) Tj ET";
    expect(await textOf(content)).toBe("Tagged\n\nAfter");
  });

  it("tidies trailing spaces and runs of blank lines", async () => {
    expect(
      await textOf("BT /F1 12 Tf 0 700 Td (a  ) Tj 0 -100 Td (b) Tj 0 -100 Td (c) Tj ET"),
    ).toBe("a\n\nb\n\nc");
  });
});

describe("extractPdfText — encodings", () => {
  it("decodes hex strings and literal escapes", async () => {
    expect(await textOf("BT /F1 12 Tf <48656C6C6F> Tj ET")).toBe("Hello");
    expect(await textOf("BT /F1 12 Tf (\\(a\\) \\\\ \\101) Tj ET")).toBe("(a) \\ A");
  });

  it("maps WinAnsi codes, including the 0x80-0x9F block", async () => {
    // \200 = €, \223/\224 = curly double quotes, \351 = é, \227 = em dash
    expect(await textOf("BT /F1 12 Tf (\\200 \\223caf\\351\\224 \\227) Tj ET")).toBe("€ “café” —");
  });

  it("decodes a Type0 font through its ToUnicode CMap (bfchar, bfrange, arrays, ligatures)", async () => {
    const cmap =
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n" +
      "1 begincodespacerange <0000> <FFFF> endcodespacerange\n" +
      "2 beginbfchar <0001> <041F> <0007> <00660069> endbfchar\n" +
      "2 beginbfrange <0002> <0004> <0440> <0005> <0006> [<0438> <0432>] endbfrange\n" +
      "endcmap CMapName currentdict /CMap defineresource pop end end";
    // 0001=П, 0002..0004 = р с т, 0005=и, 0006=в, 0007 = "fi"
    const text = await textOf(
      "BT /F2 12 Tf <0001000200050006000500040007> Tj ET",
      "<< /Font << /F2 6 0 R >> >>",
      {
        6: "<< /Type /Font /Subtype /Type0 /BaseFont /Arial /Encoding /Identity-H /ToUnicode 7 0 R >>",
        7: streamObj(cmap),
      },
    );
    expect(text).toBe("Привитfi");
  });

  it("reads a Flate-compressed ToUnicode stream and content stream", async () => {
    const cmap =
      "begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <0416> endbfchar";
    const content = new Uint8Array(deflateSync(Buffer.from("BT /F3 12 Tf (AA) Tj ET", "latin1")));
    const pdf = makePdf([{ content, filter: "FlateDecode" }], "<< /Font << /F3 8 0 R >> >>", {
      8: "<< /Type /Font /Subtype /TrueType /ToUnicode 9 0 R >>",
      9: streamObj(new Uint8Array(deflateSync(Buffer.from(cmap))), " /Filter /FlateDecode"),
    });
    expect((await extractPdfText(pdf, inflate)).pages).toEqual(["ЖЖ"]);
  });

  it("returns nothing for a Type0 font without ToUnicode", async () => {
    expect(
      await textOf("BT /F2 12 Tf <00010002> Tj ET", "<< /Font << /F2 6 0 R >> >>", {
        6: "<< /Type /Font /Subtype /Type0 /Encoding /Identity-H >>",
      }),
    ).toBe("");
  });

  it("concatenates a Contents array", async () => {
    const pdf = makePdf([{ contentsValue: "[11 0 R 12 0 R]" }], undefined, {
      11: streamObj("BT /F1 12 Tf 0 700 Td (first) Tj"),
      12: streamObj("0 -14 Td (second) Tj ET"),
    });
    expect((await extractPdfText(pdf, inflate)).pages).toEqual(["first\nsecond"]);
  });

  it("extracts text placed through a Form XObject", async () => {
    const pdf = makePdf(
      [{ content: "q /Fm0 Do Q" }],
      "<< /Font << /F1 5 0 R >> /XObject << /Fm0 6 0 R >> >>",
      {
        6: streamObj(
          "BT /F1 12 Tf (inside form) Tj ET",
          " /Type /XObject /Subtype /Form /BBox [0 0 100 100]",
        ),
      },
    );
    expect((await extractPdfText(pdf, inflate)).pages).toEqual(["inside form"]);
  });

  it("does not follow a form that draws itself", async () => {
    const pdf = makePdf(
      [{ content: "/Fm0 Do" }],
      "<< /Font << /F1 5 0 R >> /XObject << /Fm0 6 0 R >> >>",
      {
        6: streamObj(
          "BT /F1 12 Tf (loop) Tj ET /Fm0 Do",
          " /Type /XObject /Subtype /Form /Resources << /Font << /F1 5 0 R >> /XObject << /Fm0 6 0 R >> >>",
        ),
      },
    );
    expect((await extractPdfText(pdf, inflate)).pages).toEqual(["loop"]);
  });
});

describe("extractPdfText — errors", () => {
  it("rejects empty, non-PDF, corrupt, encrypted and page-less files", async () => {
    expect(await extractPdfText(new Uint8Array(), inflate)).toEqual({
      ok: false,
      error: "empty file",
      pages: [],
    });
    expect((await extractPdfText(latin1("PK\x03\x04"), inflate)).error).toBe("not a PDF file");
    expect((await extractPdfText(latin1("%PDF-1.4\n"), inflate)).error).toMatch(/corrupt/);
    const enc = latin1(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 3 0 R >>\n",
    );
    expect((await extractPdfText(enc, inflate)).error).toMatch(/password/);
    const noPages = latin1("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    expect((await extractPdfText(noPages, inflate)).error).toBe("no pages found");
  });

  it("keeps going when a page has no content or the content cannot be inflated", async () => {
    const pdf = makePdf([
      { contentsValue: "null" },
      { content: "not zlib", filter: "FlateDecode" },
      { content: "BT /F1 12 Tf (ok) Tj ET" },
    ]);
    expect((await extractPdfText(pdf, inflate)).pages).toEqual(["", "", "ok"]);
  });
});

describe("pdfToWord", () => {
  it("writes a .docx with one paragraph per line and a page break between pages", async () => {
    const pdf = makePdf([
      { content: "BT /F1 12 Tf 0 700 Td (Tom & Jerry <3) Tj 0 -14 Td (line two) Tj ET" },
      { content: "BT /F1 12 Tf (page two) Tj ET" },
    ]);
    const r = await pdfToWord(pdf, inflate);
    expect(r.ok).toBe(true);
    expect(r.pageCount).toBe(2);
    // words: Tom & Jerry <3 line two page two = 8; chars without whitespace: 24
    expect(r.wordCount).toBe(8);
    expect(r.charCount).toBe("Tom&Jerry<3linetwopagetwo".length);

    const files = readStoredZip(r.docx);
    expect([...files.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/app.xml",
      "docProps/core.xml",
      "word/document.xml",
    ]);
    const xml = new TextDecoder().decode(files.get("word/document.xml"));
    const paras = [...xml.matchAll(/<w:p>(.*?)<\/w:p>|<w:p\/>/g)].map((m) => m[0]);
    expect(paras).toEqual([
      '<w:p><w:r><w:t xml:space="preserve">Tom &amp; Jerry &lt;3</w:t></w:r></w:p>',
      '<w:p><w:r><w:t xml:space="preserve">line two</w:t></w:r></w:p>',
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
      '<w:p><w:r><w:t xml:space="preserve">page two</w:t></w:r></w:p>',
    ]);
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
  });

  it("leaves the author and application out of the properties unless given", async () => {
    const pdf = makePdf([{ content: "BT /F1 12 Tf (hello) Tj ET" }]);
    const plain = readStoredZip((await pdfToWord(pdf, inflate)).docx);
    const core = new TextDecoder().decode(plain.get("docProps/core.xml"));
    const app = new TextDecoder().decode(plain.get("docProps/app.xml"));
    expect(core).toContain("<dc:title>Converted from PDF</dc:title>");
    expect(core).not.toContain("dc:creator");
    expect(app).not.toContain("<Application>");
    expect(app).toMatch(/<Properties [^>]*><\/Properties>$/);

    const named = readStoredZip(
      (await pdfToWord(pdf, inflate, { creator: "A & B", application: "Tool <1>" })).docx,
    );
    expect(new TextDecoder().decode(named.get("docProps/core.xml"))).toContain(
      "<dc:creator>A &amp; B</dc:creator>",
    );
    expect(new TextDecoder().decode(named.get("docProps/app.xml"))).toContain(
      "<Application>Tool &lt;1&gt;</Application>",
    );
  });

  it("reads past a content stream whose predictor parameters are unusable", async () => {
    const packed = new Uint8Array(deflateSync(Buffer.from("BT /F1 12 Tf (x) Tj ET")));
    for (const columns of ["99999999999999", "0", "-4"]) {
      const r = await extractPdfText(
        makePdf([
          {
            content: packed,
            filter: `FlateDecode /DecodeParms << /Predictor 12 /Columns ${columns} >>`,
          },
          { content: "BT /F1 12 Tf (second) Tj ET" },
        ]),
        inflate,
      );
      expect(r.ok, columns).toBe(true);
      expect(r.pages, columns).toEqual(["", "second"]);
    }
  });

  it("keeps Cyrillic text intact as UTF-8", async () => {
    const pdf = makePdf([{ content: "BT /F2 12 Tf <0001> Tj ET" }], "<< /Font << /F2 6 0 R >> >>", {
      6: "<< /Type /Font /Subtype /Type0 /ToUnicode 7 0 R >>",
      7: streamObj("1 beginbfchar <0001> <0416> endbfchar"),
    });
    const r = await pdfToWord(pdf, inflate);
    const xml = new TextDecoder().decode(readStoredZip(r.docx).get("word/document.xml"));
    expect(xml).toContain(">Ж</w:t>");
  });

  it("reports an image-only PDF", async () => {
    const r = await pdfToWord(makePdf([{ content: "q 100 0 0 100 0 0 cm /Im0 Do Q" }]), inflate);
    expect(r).toMatchObject({ ok: false, pageCount: 1, wordCount: 0 });
    expect(r.error).toMatch(/scanned or image-only/);
    expect(r.docx).toHaveLength(0);
  });

  it("passes on read errors", async () => {
    expect((await pdfToWord(new Uint8Array(), inflate)).error).toBe("empty file");
  });
});

describe("formatFileSize", () => {
  it("formats sizes", () => {
    expect(formatFileSize(-1)).toBe("0 B");
    expect(formatFileSize(1000)).toBe("1000 B");
    expect(formatFileSize(10 * 1024)).toBe("10.0 KB");
  });
});
