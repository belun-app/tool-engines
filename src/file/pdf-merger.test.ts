import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pageBox, pageRotation, parseDocument } from "../pdf/_pdf-lib.js";
import { formatFileSize, mergePdfs, readPdfInfo } from "./pdf-merger.js";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

interface TestPage {
  /** Own MediaBox; omitted pages inherit the one on the page tree (if any). */
  box?: [number, number];
  rotate?: number;
  text: string;
}

/**
 * Hand-written minimal PDF: 1 = catalog, 2 = page tree, then a page + content stream pair per
 * page. Offsets in the xref table are computed exactly.
 */
function makePdf(pages: TestPage[], tree: { box?: [number, number]; rotate?: number } = {}) {
  const bodies: string[] = [];
  const kids: string[] = [];
  pages.forEach((p, i) => {
    const pageNum = 3 + i * 2;
    const contentNum = pageNum + 1;
    kids.push(`${pageNum} 0 R`);
    const box = p.box ? ` /MediaBox [0 0 ${p.box[0]} ${p.box[1]}]` : "";
    const rot = p.rotate !== undefined ? ` /Rotate ${p.rotate}` : "";
    bodies[pageNum] = `<< /Type /Page /Parent 2 0 R${box}${rot} /Contents ${contentNum} 0 R >>`;
    const stream = `BT /F1 12 Tf (${p.text}) Tj ET`;
    bodies[contentNum] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  const treeBox = tree.box ? ` /MediaBox [0 0 ${tree.box[0]} ${tree.box[1]}]` : "";
  const treeRot = tree.rotate !== undefined ? ` /Rotate ${tree.rotate}` : "";
  bodies[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  bodies[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length}${treeBox}${treeRot} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < bodies.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${bodies[n]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${bodies.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < bodies.length; n++) {
    out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${bodies.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return latin1(out);
}

/** PDF 1.5 file whose page dictionary lives inside a Flate-compressed object stream. */
function makeObjStmPdf(): Uint8Array {
  const pageDict = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /Contents 4 0 R >>";
  const header = "3 0 ";
  const packed = deflateSync(Buffer.from(header + pageDict, "latin1"));
  const content = "BT (objstm) Tj ET";
  const parts = [
    "%PDF-1.5\n",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    `5 0 obj\n<< /Type /ObjStm /N 1 /First ${header.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
  ];
  const tail = "\nendstream\nendobj\ntrailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF\n";
  return Uint8Array.from([...latin1(parts.join("")), ...packed, ...latin1(tail)]);
}

async function inspect(bytes: Uint8Array) {
  const { doc, error } = await parseDocument(bytes, inflate);
  if (!doc) throw new Error(error);
  return doc.pages.map((p) => {
    const contents = p.dict.v.get("Contents");
    const stream = contents?.k === "ref" ? doc.objects.get(contents.n) : undefined;
    const text = stream?.k === "stream" ? Buffer.from(stream.raw).toString("latin1") : "";
    return {
      box: pageBox(doc, p),
      rotation: pageRotation(p),
      text: /\((.*)\)/.exec(text)?.[1] ?? "",
    };
  });
}

describe("readPdfInfo", () => {
  it("counts pages of a valid PDF", async () => {
    expect(await readPdfInfo(makePdf([{ text: "a" }, { text: "b" }]), inflate)).toEqual({
      ok: true,
      pageCount: 2,
    });
  });

  it("reads pages stored in a compressed object stream", async () => {
    expect((await readPdfInfo(makeObjStmPdf(), inflate)).pageCount).toBe(1);
  });

  it("rejects empty and non-PDF data", async () => {
    expect(await readPdfInfo(new Uint8Array(), inflate)).toEqual({
      ok: false,
      error: "empty file",
      pageCount: 0,
    });
    const r = await readPdfInfo(latin1("hello world"), inflate);
    expect(r.ok).toBe(false);
    expect(r.pageCount).toBe(0);
  });

  it("rejects encrypted PDFs", async () => {
    const enc = latin1(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 3 0 R >>\n%%EOF",
    );
    const r = await readPdfInfo(enc, inflate);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/password/);
  });
});

describe("mergePdfs", () => {
  it("asks for at least one file", async () => {
    const r = await mergePdfs([], inflate);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("add at least one PDF");
  });

  it("names the file that could not be read", async () => {
    const r = await mergePdfs(
      [
        { name: "ok.pdf", data: makePdf([{ text: "a" }]) },
        { name: "broken.pdf", data: latin1("not a pdf") },
      ],
      inflate,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^broken\.pdf: /);
    expect(r.bytes.length).toBe(0);
  });

  it("concatenates pages in file order, keeping size, rotation and content", async () => {
    const a = makePdf([
      { box: [200, 300], text: "A1" },
      { box: [300, 200], rotate: 90, text: "A2" },
    ]);
    const b = makePdf([{ box: [595, 842], text: "B1" }]);
    const r = await mergePdfs(
      [
        { name: "a.pdf", data: a },
        { name: "b.pdf", data: b },
      ],
      inflate,
    );
    expect(r.ok).toBe(true);
    expect(r.pageCount).toBe(3);
    expect(r.fileCount).toBe(2);
    expect(r.sizeBytes).toBe(r.bytes.length);
    expect(await inspect(r.bytes)).toEqual([
      { box: { x0: 0, y0: 0, width: 200, height: 300 }, rotation: 0, text: "A1" },
      { box: { x0: 0, y0: 0, width: 300, height: 200 }, rotation: 90, text: "A2" },
      { box: { x0: 0, y0: 0, width: 595, height: 842 }, rotation: 0, text: "B1" },
    ]);
  });

  it("materialises attributes inherited from the source page tree", async () => {
    const src = makePdf([{ text: "X" }], { box: [400, 500], rotate: 180 });
    const r = await mergePdfs([{ name: "x.pdf", data: src }], inflate);
    expect(await inspect(r.bytes)).toEqual([
      { box: { x0: 0, y0: 0, width: 400, height: 500 }, rotation: 180, text: "X" },
    ]);
  });

  it("falls back to US Letter when no MediaBox exists anywhere", async () => {
    const r = await mergePdfs([{ name: "x.pdf", data: makePdf([{ text: "X" }]) }], inflate);
    expect((await inspect(r.bytes))[0].box).toEqual({ x0: 0, y0: 0, width: 612, height: 792 });
  });

  it("merges a file with itself and a PDF 1.5 object-stream file", async () => {
    const a = makePdf([{ box: [10, 20], text: "A" }]);
    const r = await mergePdfs(
      [
        { name: "a.pdf", data: a },
        { name: "a.pdf", data: a },
        { name: "c.pdf", data: makeObjStmPdf() },
      ],
      inflate,
    );
    expect(r.pageCount).toBe(3);
    expect((await inspect(r.bytes)).map((p) => p.text)).toEqual(["A", "A", "objstm"]);
  });

  it("writes a document whose header and trailer are well formed", async () => {
    const r = await mergePdfs([{ name: "a.pdf", data: makePdf([{ text: "A" }]) }], inflate);
    const text = Buffer.from(r.bytes).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toMatch(/startxref\s+\d+/);
  });
});

/* ------------------------------------------------------------------ *
 * Hand-built documents for the parser edge cases
 * ------------------------------------------------------------------ */

const HEAD = "%PDF-1.4\n";
const TRAILER = "trailer\n<< /Root 1 0 R >>\n%%EOF\n";
const CATALOG = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";

const obj = (n: number, body: string) => `${n} 0 obj\n${body}\nendobj\n`;
const tree = (kids: number[]) =>
  obj(
    2,
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`,
  );
const contentObj = (n: number, text: string) => {
  const s = `BT (${text}) Tj ET`;
  return obj(n, `<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
};

/** Concatenates latin1 strings and raw byte chunks into one file. */
function pdf(...parts: Array<string | Uint8Array>): Uint8Array {
  const chunks = parts.map((p) => (typeof p === "string" ? latin1(p) : p));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A one-page document whose page (object 3) has the given extra dictionary entries. */
function onePage(extra: string, ...more: string[]): Uint8Array {
  return pdf(
    HEAD,
    CATALOG,
    tree([3]),
    obj(3, `<< /Type /Page /Parent 2 0 R ${extra} /Contents 4 0 R >>`),
    contentObj(4, "x"),
    ...more,
    TRAILER,
  );
}

/** Merges a single file and returns the output as latin1 text, failing loudly on error. */
async function mergedText(data: Uint8Array): Promise<string> {
  const r = await mergePdfs([{ name: "t.pdf", data }], inflate);
  if (!r.ok) throw new Error(r.error);
  return Buffer.from(r.bytes).toString("latin1");
}

/** Raw bytes of each output page's content stream, read back with the shared PDF parser. */
async function contents(bytes: Uint8Array): Promise<string[]> {
  const { doc, error } = await parseDocument(bytes, inflate);
  if (!doc) throw new Error(error);
  return doc.pages.map((p) => {
    const c = p.dict.v.get("Contents");
    const s = c?.k === "ref" ? doc.objects.get(c.n) : undefined;
    return s?.k === "stream" ? Buffer.from(s.raw).toString("latin1") : "";
  });
}

const PAGE_IN_OBJSTM = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /Contents 4 0 R >>";
const OBJSTM_HEADER = "3 0 ";

/** A PDF whose page (object 3) lives in object stream 5 with the given dictionary entries. */
function objStmPdf(streamDict: string, payload: Uint8Array): Uint8Array {
  return pdf(
    "%PDF-1.5\n",
    CATALOG,
    tree([3]),
    contentObj(4, "packed"),
    `5 0 obj\n<< /Type /ObjStm /N 1 /First ${OBJSTM_HEADER.length} ${streamDict} /Length ${payload.length} >>\nstream\n`,
    payload,
    "\nendstream\nendobj\n",
    TRAILER,
  );
}

/** PNG-predictor encoder (the inverse of what PDF readers apply), one filter type per row. */
function pngPredict(data: Uint8Array, rowLen: number, bpp: number, tags: number[]): Uint8Array {
  const rows = Math.ceil(data.length / rowLen);
  const padded = new Uint8Array(rows * rowLen).fill(0x20); // trailing spaces are harmless
  padded.set(data);
  const out: number[] = [];
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const tag = tags[r % tags.length];
    const row = padded.subarray(r * rowLen, (r + 1) * rowLen);
    out.push(tag);
    for (let i = 0; i < rowLen; i++) {
      const left = i >= bpp ? row[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      let pred = 0;
      if (tag === 1) pred = left;
      else if (tag === 2) pred = up;
      else if (tag === 3) pred = (left + up) >> 1;
      else if (tag === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out.push((row[i] - pred) & 0xff);
    }
    prev = row;
  }
  return Uint8Array.from(out);
}

describe("PDF lexer (observed through the merged output)", () => {
  it("decodes every literal-string escape", async () => {
    const src =
      "(a\\(b\\) \\n\\r\\t\\b\\f \\101\\60x\\1011\\377 \\\\ \\q (nested) end\\\nline\\\r\nx)";
    const expected = latin1("a(b) \n\r\t\b\f A0xA1\xff \\ q (nested) endlinex");
    const text = await mergedText(onePage(`/T ${src}`));
    expect(text).toContain(`/T <${Buffer.from(expected).toString("hex")}>`);
  });

  it("reads hex strings with whitespace, mixed case and an odd digit count", async () => {
    const text = await mergedText(onePage("/H <48 65 6c 6C\n6F 7> /E <>"));
    // The odd final digit is padded with 0 ("7" -> 0x70).
    expect(text).toContain("/H <48656c6c6f70>");
    expect(text).toContain("/E <>");
  });

  it("decodes #xx escapes in names and re-encodes unsafe characters on output", async () => {
    const text = await mergedText(
      onePage("/N /A#20B /M /C#2fD /Bad /x#zz /Key#41 1 /Accent /caf#e9"),
    );
    expect(text).toContain("/N /A#20B ");
    expect(text).toContain("/M /C#2fD ");
    // "#zz" is not an escape, so the "#" is literal and gets escaped on output.
    expect(text).toContain("/Bad /x#23zz ");
    expect(text).toContain("/KeyA 1 ");
    expect(text).toContain("/Accent /caf#e9 ");
  });

  it("reads real numbers, signs, booleans, null and unknown keywords", async () => {
    const text = await mergedText(
      onePage("/Nums [-.5 +3 1.250 -0.0000001 7.] /B true /F false /Z null /U bogus"),
    );
    expect(text).toContain("/Nums [-0.5 3 1.25 0 7] ");
    expect(text).toContain("/B true ");
    expect(text).toContain("/F false ");
    expect(text).toContain("/Z null ");
    expect(text).toContain("/U null ");
  });

  it("keeps fractional page sizes", async () => {
    const r = await mergePdfs(
      [{ name: "a.pdf", data: onePage("/MediaBox [0 0 595.5 842.25]") }],
      inflate,
    );
    expect((await inspect(r.bytes))[0].box).toEqual({ x0: 0, y0: 0, width: 595.5, height: 842.25 });
  });

  it("skips comments between tokens", async () => {
    const data = onePage("% a comment /Rotate 90\n/MediaBox [0 0 % inline comment\n300 400]");
    const [page] = await inspect((await mergePdfs([{ name: "c.pdf", data }], inflate)).bytes);
    expect(page.box).toEqual({ x0: 0, y0: 0, width: 300, height: 400 });
    expect(page.rotation).toBe(0);
  });

  it("recovers from junk in dictionaries and stray delimiters in arrays", async () => {
    const text = await mergedText(onePage("junk 12 /A [1 ) 2 } 3 { >] /MediaBox [0 0 50 60]"));
    expect(text).toContain("/A [1 null 2 null 3 null null] ");
    expect(text).toContain("/MediaBox [0 0 50 60] ");
  });

  it("survives absurdly deep nesting without losing the keys after it", async () => {
    const deep = `${"[".repeat(150)}1${"]".repeat(150)}`;
    const r = await mergePdfs(
      [{ name: "d.pdf", data: onePage(`/Deep ${deep} /MediaBox [0 0 70 80]`) }],
      inflate,
    );
    expect(r.ok).toBe(true);
    expect((await inspect(r.bytes))[0].box).toEqual({ x0: 0, y0: 0, width: 70, height: 80 });
  });

  it("copies inline dictionaries and the objects they reference", async () => {
    const data = onePage(
      "/Resources << /Font << /F1 5 0 R >> /ProcSet [/PDF /Text] >>",
      obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    );
    const r = await mergePdfs([{ name: "f.pdf", data }], inflate);
    const { doc } = await parseDocument(r.bytes, inflate);
    const page = doc?.pages[0].dict;
    const res = page?.v.get("Resources");
    const font = res?.k === "dict" ? res.v.get("Font") : undefined;
    const f1 = font?.k === "dict" ? font.v.get("F1") : undefined;
    expect(f1?.k).toBe("ref");
    const fontObj = f1?.k === "ref" ? doc?.objects.get(f1.n) : undefined;
    expect(fontObj?.k === "dict" && fontObj.v.get("BaseFont")).toEqual({
      k: "name",
      v: "Helvetica",
    });
  });
});

describe("stream boundaries", () => {
  const variants: Array<[string, string]> = [
    ["a Length that runs past endstream", "<< /Length 999 >>\nstream\nBT (s) Tj ET\nendstream"],
    ["a Length that is too short", "<< /Length 3 >>\nstream\nBT (s) Tj ET\nendstream"],
    ["no Length at all", "<< >>\nstream\nBT (s) Tj ET\nendstream"],
    [
      "CR LF line endings around the data",
      "<< /Length 2 >>\r\nstream\r\nBT (s) Tj ET\r\nendstream",
    ],
  ];

  it.each(variants)("finds the data when the stream has %s", async (_label, body) => {
    const data = pdf(
      HEAD,
      CATALOG,
      tree([3]),
      obj(3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"),
      obj(4, body),
      TRAILER,
    );
    const r = await mergePdfs([{ name: "s.pdf", data }], inflate);
    expect(await contents(r.bytes)).toEqual(["BT (s) Tj ET"]);
  });

  it("keeps the rest of a truncated file as stream data and still finds the catalog", async () => {
    // No endstream, no trailer: the catalog is found by its /Type.
    const data = pdf(
      HEAD,
      CATALOG,
      tree([3]),
      obj(3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"),
      "4 0 obj\n<< /Length 500 >>\nstream\nBT (cut) Tj ET",
    );
    expect(await readPdfInfo(data, inflate)).toEqual({ ok: true, pageCount: 1 });
    const r = await mergePdfs([{ name: "t.pdf", data }], inflate);
    expect(await contents(r.bytes)).toEqual(["BT (cut) Tj ET"]);
  });
});

describe("object scanning", () => {
  it("ignores text that only looks like an object header", async () => {
    // Each fake header would redefine the page (object 3) if it were accepted.
    const data = pdf(
      HEAD,
      CATALOG,
      tree([3]),
      obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 20] >>"),
      "% x3 0 obj (fake)\n% 3 0 objection (fake)\n% z 3 obj (fake)\n",
      TRAILER,
    );
    expect(await readPdfInfo(data, inflate)).toEqual({ ok: true, pageCount: 1 });
  });

  it("lets a later definition of an object win, as incremental updates require", async () => {
    const original = makePdf([{ box: [100, 100], text: "old" }]);
    const update = obj(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R >>",
    );
    const data = pdf(original, update, TRAILER);
    const r = await mergePdfs([{ name: "u.pdf", data }], inflate);
    expect((await inspect(r.bytes))[0]).toEqual({
      box: { x0: 0, y0: 0, width: 300, height: 400 },
      rotation: 0,
      text: "old",
    });
  });
});

describe("document structure", () => {
  const twoTrees = (xrefStream: string) =>
    pdf(
      "%PDF-1.5\n",
      CATALOG,
      tree([3]),
      obj(3, "<< /Type /Page /Parent 2 0 R >>"),
      obj(7, "<< /Type /Catalog /Pages 8 0 R >>"),
      obj(8, "<< /Type /Pages /Kids [9 0 R 10 0 R] /Count 2 >>"),
      obj(9, "<< /Type /Page /Parent 8 0 R >>"),
      obj(10, "<< /Type /Page /Parent 8 0 R >>"),
      `11 0 obj\n<< ${xrefStream} /Length 0 >>\nstream\n\nendstream\nendobj\n`,
      "startxref\n0\n%%EOF\n",
    );

  it("takes /Root from a cross-reference stream when there is no trailer", async () => {
    // Without the xref stream the first catalog (one page) would be picked.
    expect(
      (await readPdfInfo(twoTrees("/Type /XRef /Size 12 /Root 7 0 R"), inflate)).pageCount,
    ).toBe(2);
    expect((await readPdfInfo(twoTrees("/Type /Other /Root 7 0 R"), inflate)).pageCount).toBe(1);
  });

  it("rejects a file whose cross-reference stream declares encryption", async () => {
    const r = await readPdfInfo(twoTrees("/Type /XRef /Root 7 0 R /Encrypt 12 0 R"), inflate);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/password/);
  });

  it("prefers the trailer's /Root over a cross-reference stream", async () => {
    const data = pdf(twoTrees("/Type /XRef /Root 7 0 R"), TRAILER);
    expect((await readPdfInfo(data, inflate)).pageCount).toBe(1);
  });

  it("falls back to every /Page object in number order when the page tree is unusable", async () => {
    const data = pdf(
      HEAD,
      CATALOG,
      obj(2, "42"), // /Pages points at a number, not a dictionary
      obj(5, "<< /Type /Page /Contents 6 0 R >>"),
      contentObj(6, "second"),
      obj(3, "<< /Type /Page /Contents 4 0 R >>"),
      contentObj(4, "first"),
      TRAILER,
    );
    const r = await mergePdfs([{ name: "l.pdf", data }], inflate);
    expect(r.pageCount).toBe(2);
    expect((await inspect(r.bytes)).map((p) => p.text)).toEqual(["first", "second"]);
  });

  it("reports a file without any objects as corrupt", async () => {
    const r = await readPdfInfo(latin1("%PDF-1.4\nnothing to see here\n%%EOF"), inflate);
    expect(r).toEqual({
      ok: false,
      error: "no PDF objects found — the file looks corrupt",
      pageCount: 0,
    });
  });

  it("returns an error instead of throwing when given something other than bytes", async () => {
    const notBytes = [0x25, 0x50, 0x44, 0x46] as unknown as Uint8Array;
    expect(await readPdfInfo(notBytes, inflate)).toEqual({
      ok: false,
      error: "could not read this PDF",
      pageCount: 0,
    });
    const r = await mergePdfs([{ name: "odd.pdf", data: notBytes }], inflate);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("odd.pdf: could not be read");
  });
});

describe("object streams", () => {
  const plain = latin1(OBJSTM_HEADER + PAGE_IN_OBJSTM);

  it("reads an uncompressed object stream", async () => {
    expect(await readPdfInfo(objStmPdf("", plain), inflate)).toEqual({ ok: true, pageCount: 1 });
  });

  it("accepts the filter and its parameters as one-element arrays, with a PNG predictor", async () => {
    const predicted = pngPredict(plain, 8, 1, [0, 1, 2, 3, 4, 5]);
    const data = objStmPdf(
      "/Filter [/FlateDecode] /DecodeParms [<< /Predictor 12 /Columns 8 >>]",
      new Uint8Array(deflateSync(predicted)),
    );
    const r = await mergePdfs([{ name: "p.pdf", data }], inflate);
    expect(r.ok).toBe(true);
    expect((await inspect(r.bytes))[0]).toEqual({
      box: { x0: 0, y0: 0, width: 100, height: 200 },
      rotation: 0,
      text: "packed",
    });
  });

  it("undoes the predictor for multi-byte pixels under abbreviated keys", async () => {
    // Colors 3 x 8 bits: each pixel is 3 bytes, so "left" is 3 bytes back.
    const predicted = pngPredict(plain, 12, 3, [4, 3, 1, 2]);
    const data = objStmPdf(
      "/Filter /Fl /DP << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 4 >>",
      new Uint8Array(deflateSync(predicted)),
    );
    expect(await readPdfInfo(data, inflate)).toEqual({ ok: true, pageCount: 1 });
  });

  it("treats a stream with unusable predictor parameters as unreadable", async () => {
    const packed = new Uint8Array(deflateSync(pngPredict(plain, 8, 1, [0])));
    for (const parms of [
      "/Columns 0",
      "/Columns -8",
      "/Columns 1e12",
      "/Columns 99999999999999",
      "/Colors 0 /Columns 8",
      "/BitsPerComponent 7 /Columns 8",
    ]) {
      const data = objStmPdf(
        `/Filter /FlateDecode /DecodeParms << /Predictor 12 ${parms} >>`,
        packed,
      );
      expect(await readPdfInfo(data, inflate), parms).toEqual({
        ok: false,
        error: "no pages found",
        pageCount: 0,
      });
    }
  });

  it("cannot see pages inside streams with unsupported or chained filters", async () => {
    const hex = latin1(`${Buffer.from(plain).toString("hex")}>`);
    for (const filter of ["/ASCIIHexDecode", "[/ASCIIHexDecode /FlateDecode]"]) {
      const r = await readPdfInfo(objStmPdf(`/Filter ${filter}`, hex), inflate);
      expect(r, filter).toEqual({ ok: false, error: "no pages found", pageCount: 0 });
    }
  });

  it("treats an object stream that fails to inflate as unreadable, not as a crash", async () => {
    const data = objStmPdf("/Filter /FlateDecode", latin1("this is not deflate data"));
    expect(await readPdfInfo(data, inflate)).toEqual({
      ok: false,
      error: "no pages found",
      pageCount: 0,
    });
    const rejecting = async () => {
      throw new Error("boom");
    };
    const ok = objStmPdf("/Filter /FlateDecode", new Uint8Array(deflateSync(plain)));
    expect((await readPdfInfo(ok, rejecting)).error).toBe("no pages found");
  });
});

describe("formatFileSize", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(-3)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
