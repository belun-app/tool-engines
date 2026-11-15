import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  type PVal,
  type PdfDocument,
  buildPdf,
  decodeStream,
  dictOf,
  formatFileSize,
  intOf,
  nameOf,
  normalizeAngle,
  pageBox,
  pageRotation,
  parseDocument,
  parsePageRanges,
  sanitizeWinAnsi,
  serialize,
  standardCharWidth,
  standardTextWidth,
  viewTransform,
  winAnsiHex,
} from "./_pdf-lib.js";

type PStream = Extract<PVal, { k: "stream" }>;

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");

/**
 * Hand-written PDF from object bodies keyed by object number, with an exact xref table.
 * Written independently of the library's own writer so the parser is cross-checked.
 */
function pdfFrom(bodies: Record<number, string>, trailer = "/Root 1 0 R", header = "%PDF-1.4\n") {
  const nums = Object.keys(bodies)
    .map(Number)
    .sort((a, b) => a - b);
  let out = header;
  const offsets = new Map<number, number>();
  for (const n of nums) {
    offsets.set(n, out.length);
    out += `${n} 0 obj\n${bodies[n]}\nendobj\n`;
  }
  const size = Math.max(...nums) + 1;
  const xrefAt = out.length;
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    const off = offsets.get(n);
    out +=
      off === undefined ? "0000000000 65535 f \n" : `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${size} ${trailer} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return latin1(out);
}

const stream = (content: string, extra = "") =>
  `<< /Length ${content.length}${extra} >>\nstream\n${content}\nendstream`;

/** Two-page document: page 3 (A4, own box) and page 5 (inherits Letter box + Rotate 90). */
function twoPagePdf() {
  return pdfFrom({
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /MediaBox [0 0 612 792] /Rotate 90 /Resources << /Font << /F1 7 0 R >> >> >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate 0 /Contents 4 0 R >>",
    4: stream("BT /F1 12 Tf (one) Tj ET"),
    5: "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
    6: stream("BT /F1 12 Tf (two) Tj ET"),
    7: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  });
}

async function parse(bytes: Uint8Array): Promise<PdfDocument> {
  const { doc, error } = await parseDocument(bytes, inflate);
  if (!doc) throw new Error(error);
  return doc;
}

function contentText(doc: PdfDocument, v: PVal | undefined): string {
  const s = v?.k === "ref" ? doc.objects.get(v.n) : v;
  return s?.k === "stream" ? text(s.raw) : "";
}

/* ------------------------------------------------------------------ */

describe("parseDocument — errors", () => {
  it("rejects data without a %PDF- header in the first 2 KB", async () => {
    expect((await parseDocument(latin1("hello"), inflate)).error).toBe("not a PDF file");
    const late = latin1(`${" ".repeat(2100)}%PDF-1.4\n1 0 obj\n<<>>\nendobj\n`);
    expect((await parseDocument(late, inflate)).error).toBe("not a PDF file");
  });

  it("accepts a header preceded by junk (within 2 KB)", async () => {
    const bytes = new Uint8Array([...latin1("JUNKJUNK\n"), ...twoPagePdf()]);
    expect((await parse(bytes)).pages).toHaveLength(2);
  });

  it("reports a file with a header but no objects as corrupt", async () => {
    expect((await parseDocument(latin1("%PDF-1.4\nnothing here"), inflate)).error).toMatch(
      /no PDF objects/,
    );
  });

  it("refuses encrypted files (trailer /Encrypt or XRef stream /Encrypt)", async () => {
    const viaTrailer = pdfFrom(
      { 1: "<< /Type /Catalog /Pages 2 0 R >>", 2: "<< /Type /Pages /Kids [] /Count 0 >>" },
      "/Root 1 0 R /Encrypt 9 0 R",
    );
    expect((await parseDocument(viaTrailer, inflate)).error).toMatch(/password-protected/);

    const viaXref = latin1(
      `%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n9 0 obj\n${stream("", " /Type /XRef /Root 1 0 R /Encrypt 8 0 R")}\nendobj\n`,
    );
    expect((await parseDocument(viaXref, inflate)).error).toMatch(/password-protected/);
  });

  it("reports an empty page tree", async () => {
    const r = await parseDocument(
      pdfFrom({ 1: "<< /Type /Catalog /Pages 2 0 R >>", 2: "<< /Type /Pages /Kids [] >>" }),
      inflate,
    );
    expect(r).toEqual({ doc: null, error: "no pages found" });
  });

  it("survives truncated and garbage input without throwing", async () => {
    const full = twoPagePdf();
    for (const cut of [10, 60, 150, full.length - 40]) {
      const r = await parseDocument(full.subarray(0, cut), inflate);
      expect(r.doc === null || r.doc.pages.length >= 0).toBe(true);
    }
    const noise = new Uint8Array(3000);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 73 + 11) & 0xff;
    noise.set(latin1("%PDF-1.7\n"), 0);
    await expect(parseDocument(noise, inflate)).resolves.toBeDefined();
  });
});

describe("parseDocument — structure", () => {
  it("walks the page tree in Kids order and resolves inherited attributes", async () => {
    const doc = await parse(twoPagePdf());
    expect(doc.pages.map((p) => p.num)).toEqual([3, 5]);
    const [p1, p2] = doc.pages;
    expect(pageBox(doc, p1)).toEqual({ x0: 0, y0: 0, width: 595, height: 842 });
    expect(pageRotation(p1)).toBe(0); // own /Rotate 0 beats the inherited 90
    expect(pageBox(doc, p2)).toEqual({ x0: 0, y0: 0, width: 612, height: 792 });
    expect(pageRotation(p2)).toBe(90);
    expect(p2.inherited.get("Resources")?.k).toBe("dict");
    expect(contentText(doc, p1.dict.v.get("Contents"))).toBe("BT /F1 12 Tf (one) Tj ET");
  });

  it("finds the catalog by /Type when the trailer is missing", async () => {
    const bytes = latin1(
      "%PDF-1.4\n1 0 obj\n<< /Type /Pages /Kids [2 0 R] >>\nendobj\n2 0 obj\n<< /Type /Page /Parent 1 0 R >>\nendobj\n9 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\n",
    );
    expect((await parse(bytes)).pages.map((p) => p.num)).toEqual([2]);
  });

  it("falls back to loose /Type /Page objects in object-number order", async () => {
    const bytes = latin1(
      "%PDF-1.4\n7 0 obj\n<< /Type /Page >>\nendobj\n5 0 obj\n<< /Type /Page >>\nendobj\n",
    );
    expect((await parse(bytes)).pages.map((p) => p.num)).toEqual([5, 7]);
  });

  it("does not loop on a page tree that references itself", async () => {
    const bytes = pdfFrom({
      1: "<< /Type /Catalog /Pages 2 0 R >>",
      2: "<< /Type /Pages /Kids [2 0 R 3 0 R 3 0 R] >>",
      3: "<< /Type /Page /Parent 2 0 R >>",
    });
    // The duplicate kid is listed once.
    expect((await parse(bytes)).pages.map((p) => p.num)).toEqual([3]);
  });

  it("lets a later definition of an object win (incremental update)", async () => {
    const base = text(twoPagePdf());
    const update =
      "4 0 obj\n<< /Length 7 >>\nstream\nupdated\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";
    const doc = await parse(latin1(base + update));
    expect(contentText(doc, doc.pages[0].dict.v.get("Contents"))).toBe("updated");
  });

  it("reads objects packed into a compressed object stream, direct objects win", async () => {
    // Object 3 (the page) only exists in the ObjStm; object 4 exists both ways.
    const header = "3 0 4 74 ";
    const body =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /Contents 4 0 R >>   " +
      "<< /Bogus true >>";
    expect(body.indexOf("<< /Bogus")).toBe(74);
    const packed = deflateSync(Buffer.from(header + body, "latin1"));
    const content = "BT (objstm) Tj ET";
    const pre = `%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n4 0 obj\n${stream(content)}\nendobj\n5 0 obj\n<< /Type /ObjStm /N 2 /First ${header.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`;
    const bytes = new Uint8Array([
      ...latin1(pre),
      ...packed,
      ...latin1("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"),
    ]);
    const doc = await parse(bytes);
    expect(doc.pages).toHaveLength(1);
    expect(pageBox(doc, doc.pages[0])).toEqual({ x0: 0, y0: 0, width: 100, height: 200 });
    expect(doc.objects.get(4)?.k).toBe("stream");
    expect(contentText(doc, doc.pages[0].dict.v.get("Contents"))).toBe(content);
  });

  it("skips an object stream it cannot inflate instead of failing", async () => {
    const pre = `%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\n5 0 obj\n${stream("garbage", " /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode")}\nendobj\n`;
    expect((await parse(latin1(pre))).pages).toHaveLength(1);
  });
});

describe("parser value syntax (via parsed objects)", () => {
  async function obj10(body: string): Promise<PVal | undefined> {
    const doc = await parse(
      pdfFrom({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] >>",
        3: "<< /Type /Page >>",
        10: body,
      }),
    );
    return doc.objects.get(10);
  }

  it("decodes literal string escapes, octal codes and balanced parentheses", async () => {
    // \( \) \\ \n, \101 = "A", \061 = "1" followed by a literal "2", nested (y)
    const v = await obj10("[(a\\(b\\)c\\\\d\\n\\101\\0612) (x(y)z) (line\\\ncont)]");
    expect(v?.k).toBe("arr");
    if (v?.k !== "arr") return;
    const strs = v.v.map((s) => (s.k === "str" ? text(s.v) : "?"));
    expect(strs).toEqual(["a(b)c\\d\nA12", "x(y)z", "linecont"]);
  });

  it("decodes hex strings, padding an odd digit count with 0", async () => {
    const v = await obj10("<48 65 6C6C 6F7>");
    expect(v?.k === "str" && text(v.v)).toBe("Hellop");
  });

  it("decodes #xx escapes in names and every scalar type", async () => {
    const v = await obj10(
      "<< /A#20B 1 /Real -.5 /Int 42 /Dot 3. /T true /F false /N null /R 12 0 R /Num 12 0 >>",
    );
    const d = dictOf(v);
    expect(d).not.toBeNull();
    expect(intOf(d, "A B")).toBe(1);
    expect(intOf(d, "Real")).toBe(-0.5);
    expect(intOf(d, "Int")).toBe(42);
    expect(intOf(d, "Dot")).toBe(3);
    expect(d?.v.get("T")).toEqual({ k: "bool", v: true });
    expect(d?.v.get("F")).toEqual({ k: "bool", v: false });
    expect(d?.v.get("N")).toEqual({ k: "null" });
    expect(d?.v.get("R")).toEqual({ k: "ref", n: 12 });
    // "12 0" not followed by R stays a number; the 0 is then dropped as a stray value.
    expect(intOf(d, "Num")).toBe(12);
  });

  it("uses /Length when it is right, even if the data contains 'endstream'", async () => {
    const v = await obj10(stream("(endstream) Tj"));
    expect(v?.k === "stream" && text(v.raw)).toBe("(endstream) Tj");
  });

  it("falls back to scanning for endstream when /Length is wrong", async () => {
    const v = await obj10("<< /Length 999 >>\nstream\r\nBT (x) Tj ET\r\nendstream");
    expect(v?.k === "stream" && text(v.raw)).toBe("BT (x) Tj ET");
  });

  it("nameOf / intOf / dictOf return null for the wrong kinds", () => {
    const d = { k: "dict", v: new Map<string, PVal>([["X", { k: "num", v: 1 }]]) } as const;
    expect(nameOf(d, "X")).toBeNull();
    expect(intOf(d, "Missing")).toBeNull();
    expect(dictOf({ k: "num", v: 1 })).toBeNull();
    expect(dictOf(undefined)).toBeNull();
    expect(nameOf(null, "X")).toBeNull();
  });
});

describe("decodeStream", () => {
  const mk = (entries: Array<[string, PVal]>, raw: Uint8Array): PStream => ({
    k: "stream",
    d: { k: "dict", v: new Map(entries) },
    raw,
  });
  const name = (v: string): PVal => ({ k: "name", v });
  const num = (v: number): PVal => ({ k: "num", v });
  const parms = (p: Record<string, number>): PVal => ({
    k: "dict",
    v: new Map(Object.entries(p).map(([k, v]) => [k, num(v)])),
  });

  it("returns raw bytes when there is no filter", async () => {
    const raw = latin1("abc");
    expect(await decodeStream(mk([], raw), inflate)).toBe(raw);
  });

  it("inflates FlateDecode (and the abbreviated /Fl)", async () => {
    const packed = new Uint8Array(deflateSync(Buffer.from("hello")));
    for (const f of ["FlateDecode", "Fl"]) {
      const out = await decodeStream(mk([["Filter", name(f)]], packed), inflate);
      expect(out && text(out)).toBe("hello");
    }
    const arr: PVal = { k: "arr", v: [name("FlateDecode")] };
    expect(
      text((await decodeStream(mk([["Filter", arr]], packed), inflate)) ?? new Uint8Array()),
    ).toBe("hello");
  });

  it("returns null for unsupported or chained filters and inflate failures", async () => {
    expect(
      await decodeStream(mk([["Filter", name("DCTDecode")]], latin1("x")), inflate),
    ).toBeNull();
    const two: PVal = { k: "arr", v: [name("ASCII85Decode"), name("FlateDecode")] };
    expect(await decodeStream(mk([["Filter", two]], latin1("x")), inflate)).toBeNull();
    expect(
      await decodeStream(mk([["Filter", name("FlateDecode")]], latin1("not zlib")), inflate),
    ).toBeNull();
  });

  it("undoes PNG predictors (None, Sub, Up, Average, Paeth)", async () => {
    // 1 colour, 8 bpc, 3 columns. Rows (tag + 3 bytes):
    // tag 0 [1,2,3]          -> 1 2 3
    // tag 2 Up [1,1,1]       -> 2 3 4
    // tag 1 Sub [5,5,5]      -> 5 10 15
    // tag 3 Avg [2,2,2]      -> left 0/up 5: 2+2=4; left 4/up 10: 2+7=9; left 9/up 15: 2+12=14
    // tag 4 Paeth [1,1,1]    -> i0: a=0,b=4,c=0 -> p=4, pa=4,pb=0 -> up 4 -> 5
    //                           i1: a=5,b=9,c=4 -> p=10,pa=5,pb=1,pc=6 -> up 9 -> 10
    //                           i2: a=10,b=14,c=9 -> p=15,pa=5,pb=1,pc=6 -> up 14 -> 15
    const rows = [0, 1, 2, 3, 2, 1, 1, 1, 1, 5, 5, 5, 3, 2, 2, 2, 4, 1, 1, 1];
    const packed = new Uint8Array(deflateSync(Buffer.from(rows)));
    const s = mk(
      [
        ["Filter", name("FlateDecode")],
        ["DecodeParms", parms({ Predictor: 12, Columns: 3 })],
      ],
      packed,
    );
    expect([...((await decodeStream(s, inflate)) ?? [])]).toEqual([
      1, 2, 3, 2, 3, 4, 5, 10, 15, 4, 9, 14, 5, 10, 15,
    ]);
  });

  it("rejects unusable predictor parameters instead of allocating from them", async () => {
    const packed = new Uint8Array(deflateSync(Buffer.from([0, 1, 2, 3])));
    const withParms = (p: Record<string, number>) =>
      decodeStream(
        mk(
          [
            ["Filter", name("FlateDecode")],
            ["DecodeParms", parms({ Predictor: 12, ...p })],
          ],
          packed,
        ),
        inflate,
      );
    for (const bad of [
      { Columns: 0 } as Record<string, number>,
      { Columns: -3 },
      { Columns: 2.5 },
      { Colors: 0 },
      { Colors: 1e9 },
      { BitsPerComponent: 3 },
      { BitsPerComponent: 0 },
    ]) {
      expect(await withParms(bad)).toBeNull();
    }
    // A row longer than the data (here ~2^40 bytes) decodes to nothing, without allocating it.
    expect(await withParms({ Columns: 2 ** 40 })).toEqual(new Uint8Array(0));
    expect([...((await withParms({ Columns: 3 })) ?? [])]).toEqual([1, 2, 3]);
  });
});

describe("normalizeAngle / pageRotation", () => {
  it("snaps to the nearest quarter turn in 0..270", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(90)).toBe(90);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(-540)).toBe(180);
    expect(normalizeAngle(44)).toBe(0);
    expect(normalizeAngle(46)).toBe(90);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(Number.NaN)).toBe(0);
    expect(normalizeAngle(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("normalises a page's own odd /Rotate value", () => {
    const page = {
      num: 1,
      dict: { k: "dict" as const, v: new Map<string, PVal>([["Rotate", { k: "num", v: -270 }]]) },
      inherited: new Map<string, PVal>(),
    };
    expect(pageRotation(page)).toBe(90);
    page.dict.v.clear();
    expect(pageRotation(page)).toBe(0);
  });
});

describe("pageBox", () => {
  async function boxOf(mediaBox: string, extra: Record<number, string> = {}) {
    const doc = await parse(
      pdfFrom({
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R] >>",
        3: `<< /Type /Page ${mediaBox} >>`,
        ...extra,
      }),
    );
    return pageBox(doc, doc.pages[0]);
  }

  it("normalises corners written in the wrong order", async () => {
    expect(await boxOf("/MediaBox [612 792 0 0]")).toEqual({
      x0: 0,
      y0: 0,
      width: 612,
      height: 792,
    });
    expect(await boxOf("/MediaBox [100 50 300 450]")).toEqual({
      x0: 100,
      y0: 50,
      width: 200,
      height: 400,
    });
  });

  it("resolves an indirect box and indirect numbers", async () => {
    expect(await boxOf("/MediaBox 9 0 R", { 9: "[0 0 8 0 R 200]", 8: "300" })).toEqual({
      x0: 0,
      y0: 0,
      width: 300,
      height: 200,
    });
  });

  it("falls back to US Letter for missing, short or degenerate boxes", async () => {
    const letter = { x0: 0, y0: 0, width: 612, height: 792 };
    expect(await boxOf("")).toEqual(letter);
    expect(await boxOf("/MediaBox [0 0 100]")).toEqual(letter);
    expect(await boxOf("/MediaBox [0 0 0.5 100]")).toEqual(letter);
  });
});

describe("viewTransform", () => {
  const apply = (m: number[], x: number, y: number) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
  const box = { x0: 10, y0: 20, width: 200, height: 100 };

  it("maps the viewer's corners to the right page corners for each rotation", () => {
    // Rotation 0: identity offset by the box origin.
    let t = viewTransform(0, box);
    expect([t.viewWidth, t.viewHeight]).toEqual([200, 100]);
    expect(apply(t.matrix, 0, 0)).toEqual([10, 20]);

    // Rotation 90 (shown a quarter turn clockwise): the page's bottom-right corner is the
    // viewer's bottom-left, and the page's bottom-left is the viewer's top-left.
    t = viewTransform(90, box);
    expect([t.viewWidth, t.viewHeight]).toEqual([100, 200]);
    expect(apply(t.matrix, 0, 0)).toEqual([210, 20]);
    expect(apply(t.matrix, 0, 200)).toEqual([10, 20]);

    // Rotation 180: viewer bottom-left is the page's top-right.
    t = viewTransform(180, box);
    expect(apply(t.matrix, 0, 0)).toEqual([210, 120]);

    // Rotation 270: viewer bottom-left is the page's top-left.
    t = viewTransform(270, box);
    expect([t.viewWidth, t.viewHeight]).toEqual([100, 200]);
    expect(apply(t.matrix, 0, 0)).toEqual([10, 120]);
  });
});

describe("core font metrics", () => {
  it("returns the Adobe AFM widths", () => {
    // Helvetica: H 722, e 556, l 222, o 556, space 278, W 944; Times-Roman: A 722
    expect(standardCharWidth(72, "Helvetica")).toBe(722);
    expect(standardCharWidth(32, "Helvetica")).toBe(278);
    expect(standardCharWidth(87, "Helvetica")).toBe(944);
    expect(standardCharWidth(65, "Times-Roman")).toBe(722);
    expect(standardCharWidth(65, "Helvetica-Bold")).toBe(722);
    expect(standardCharWidth(105, "Courier-BoldOblique")).toBe(600);
  });

  it("folds accented Latin-1 letters and falls back for the rest", () => {
    expect(standardCharWidth(0xe9, "Helvetica")).toBe(556); // é -> e
    expect(standardCharWidth(0xc0, "Times-Roman")).toBe(722); // À -> A
    expect(standardCharWidth(0xd7, "Helvetica")).toBe(500); // × has no twin
    expect(standardCharWidth(0x2014, "Courier")).toBe(600);
    expect(standardCharWidth(65, "NoSuchFont")).toBe(667); // unknown -> Helvetica table
  });

  it("measures strings in points", () => {
    // "Hello" = 722+556+222+222+556 = 2278 units -> 22.78 pt at 10 pt
    expect(standardTextWidth("Hello", "Helvetica", 10)).toBeCloseTo(22.78, 10);
    expect(standardTextWidth("", "Helvetica", 10)).toBe(0);
    expect(standardTextWidth("abc", "Courier", 12)).toBeCloseTo(21.6, 10);
  });
});

describe("sanitizeWinAnsi / winAnsiHex", () => {
  it("keeps printable ASCII and Latin-1, turns tabs into spaces", () => {
    expect(sanitizeWinAnsi("café\tÀ")).toEqual({ text: "café À", dropped: false });
  });

  it("drops Cyrillic, emoji, C1 control codes and control characters", () => {
    expect(sanitizeWinAnsi("Привет")).toEqual({ text: "", dropped: true });
    expect(sanitizeWinAnsi("a😀b€\n\u0085")).toEqual({ text: "ab€", dropped: true });
    expect(sanitizeWinAnsi("")).toEqual({ text: "", dropped: false });
  });

  it("keeps the WinAnsi typographic characters (dashes, curly quotes, euro)", () => {
    expect(sanitizeWinAnsi("— – ‘’ “” … € ™")).toEqual({
      text: "— – ‘’ “” … € ™",
      dropped: false,
    });
  });

  it("hex-encodes Latin-1 bytes and maps typographic characters to WinAnsi 0x80–0x9f", () => {
    expect(winAnsiHex("Aé ")).toBe("41e920");
    expect(winAnsiHex("—–“”€")).toBe("9796939480");
    expect(winAnsiHex("")).toBe("");
  });

  it("measures an em dash at a full em in Helvetica and Times", () => {
    expect(standardTextWidth("—", "Helvetica", 10)).toBe(10);
    expect(standardTextWidth("—", "Times-Roman", 10)).toBe(10);
    expect(standardTextWidth("—", "Courier", 10)).toBe(6);
  });
});

describe("serialize", () => {
  it("writes a header, objects and a byte-exact xref table", async () => {
    const objects: Array<PVal | null> = [
      {
        k: "dict",
        v: new Map<string, PVal>([
          ["Type", { k: "name", v: "Catalog" }],
          ["Pages", { k: "ref", n: 2 }],
        ]),
      },
      {
        k: "dict",
        v: new Map<string, PVal>([
          ["Type", { k: "name", v: "Pages" }],
          ["Kids", { k: "arr", v: [{ k: "ref", n: 3 }] }],
        ]),
      },
      {
        k: "dict",
        v: new Map<string, PVal>([
          ["Type", { k: "name", v: "Page" }],
          ["Odd Name", { k: "str", v: latin1("(x)") }],
          ["Small", { k: "num", v: -1e-7 }],
          ["Frac", { k: "num", v: 1.5 }],
          ["Inf", { k: "num", v: Number.POSITIVE_INFINITY }],
        ]),
      },
      null,
    ];
    const out = serialize(objects);
    const s = text(out);
    expect(s.startsWith("%PDF-1.7\n")).toBe(true);
    // Strings are written as hex, names escape the space, tiny/infinite numbers become 0.
    expect(s).toContain("/Odd#20Name <287829>");
    expect(s).toContain("/Small 0 ");
    expect(s).toContain("/Frac 1.5 ");
    expect(s).toContain("/Inf 0 ");
    expect(s).toContain("4 0 obj\nnull\nendobj");

    const startxref = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    expect(s.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...s.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(4);
    entries.forEach((off, i) => expect(s.slice(off, off + 8)).toBe(`${i + 1} 0 obj\n`));

    const doc = await parse(out);
    expect(doc.pages).toHaveLength(1);
    const page = doc.pages[0].dict;
    const str = page.v.get("Odd Name");
    expect(str?.k === "str" && text(str.v)).toBe("(x)");
  });
});

describe("buildPdf", () => {
  async function richDoc() {
    return parse(
      pdfFrom({
        1: "<< /Type /Catalog /Pages 2 0 R /Outlines 99 0 R >>",
        2: "<< /Type /Pages /Kids [3 0 R 5 0 R 8 0 R] /Count 3 /Resources << /Font << /F1 7 0 R >> >> >>",
        3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Annots [<< /Dest [5 0 R /Fit] >>] >>",
        4: stream("BT /F1 12 Tf (one) Tj ET"),
        5: "<< /Type /Page /Parent 2 0 R /Rotate 90 /Contents 6 0 R >>",
        6: stream("BT /F1 12 Tf (two) Tj ET"),
        7: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        8: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 50 60] /Contents [9 0 R 10 0 R] >>",
        9: stream("q"),
        10: stream("Q"),
      }),
    );
  }

  it("writes the selected pages in order with a fresh catalog and page tree", async () => {
    const src = await richDoc();
    const out = await parse(buildPdf(src, [{ index: 2 }, { index: 0 }, { index: 7 }]));
    expect(out.pages).toHaveLength(2); // index 7 does not exist and is skipped
    expect(pageBox(out, out.pages[0])).toEqual({ x0: 0, y0: 0, width: 50, height: 60 });
    expect(pageBox(out, out.pages[1])).toEqual({ x0: 0, y0: 0, width: 300, height: 400 });
    const root = dictOf(out.objects.get(1));
    expect(nameOf(root, "Type")).toBe("Catalog");
    expect(root?.v.has("Outlines")).toBe(false);
    const tree = dictOf(out.objects.get(2));
    expect(intOf(tree, "Count")).toBe(2);
  });

  it("copies inherited attributes onto each page and adds a Letter box when none exists", async () => {
    const src = await richDoc();
    const out = await parse(buildPdf(src, [{ index: 1 }]));
    const page = out.pages[0];
    expect(page.dict.v.get("Resources")?.k).toBe("dict");
    expect(pageRotation(page)).toBe(90);
    expect(pageBox(out, page)).toEqual({ x0: 0, y0: 0, width: 612, height: 792 });
    expect(contentText(out, page.dict.v.get("Contents"))).toBe("BT /F1 12 Tf (two) Tj ET");
  });

  it("forces an absolute rotation when asked, normalised", async () => {
    const src = await richDoc();
    const out = await parse(
      buildPdf(src, [
        { index: 1, rotate: -90 },
        { index: 0, rotate: 450 },
      ]),
    );
    expect(out.pages.map(pageRotation)).toEqual([270, 90]);
  });

  it("drops references to pages that were not selected and shares common objects", async () => {
    const src = await richDoc();
    const out = await parse(buildPdf(src, [{ index: 0 }, { index: 1 }]));
    // Both pages use font 7 (inherited) — it is copied once.
    const fonts = [...out.objects.values()].filter(
      (v) => nameOf(dictOf(v), "BaseFont") === "Helvetica",
    );
    expect(fonts).toHaveLength(1);

    const only = await parse(buildPdf(src, [{ index: 0 }]));
    const annots = only.pages[0].dict.v.get("Annots");
    const dest = annots?.k === "arr" ? dictOf(annots.v[0])?.v.get("Dest") : undefined;
    // The link target (page 5) is not in the output, so the reference becomes null.
    expect(dest?.k === "arr" && dest.v[0]).toEqual({ k: "null" });
  });

  it("wraps an overlay as [q] + original contents + [Q + stamp] and registers its font once", async () => {
    const src = await richDoc();
    const overlay = {
      content: "BT /Stamp 9 Tf (s) Tj ET",
      fonts: [{ name: "Stamp", baseFont: "Courier" }],
    };
    const out = await parse(
      buildPdf(src, [
        { index: 0, overlay },
        { index: 2, overlay },
      ]),
    );
    const [p1, p2] = out.pages;
    const c1 = p1.dict.v.get("Contents");
    const c2 = p2.dict.v.get("Contents");
    expect(c1?.k === "arr" && c1.v.map((v) => contentText(out, v))).toEqual([
      "q\n",
      "BT /F1 12 Tf (one) Tj ET",
      "Q\nBT /Stamp 9 Tf (s) Tj ET",
    ]);
    // An existing Contents array is spliced in, not nested.
    expect(c2?.k === "arr" && c2.v.map((v) => contentText(out, v))).toEqual([
      "q\n",
      "q",
      "Q",
      "Q\nBT /Stamp 9 Tf (s) Tj ET",
    ]);
    const fontsOf = (p: (typeof out.pages)[number]) =>
      dictOf(dictOf(p.dict.v.get("Resources"))?.v.get("Font"));
    // The page's own font survives next to the stamp font.
    expect([...(fontsOf(p1)?.v.keys() ?? [])].sort()).toEqual(["F1", "Stamp"]);
    const s1 = fontsOf(p1)?.v.get("Stamp");
    const s2 = fontsOf(p2)?.v.get("Stamp");
    expect(s1).toEqual(s2);
    const courier = s1?.k === "ref" ? dictOf(out.objects.get(s1.n)) : null;
    expect(nameOf(courier, "BaseFont")).toBe("Courier");
    expect(nameOf(courier, "Encoding")).toBe("WinAnsiEncoding");
  });

  it("gives the overlay font a free name when the page already uses the requested one", async () => {
    const src = await richDoc();
    const out = await parse(
      buildPdf(src, [
        {
          index: 0,
          overlay: {
            content: "BT /F1 9 Tf (s) Tj /F1x 1 Tf ET",
            fonts: [{ name: "F1", baseFont: "Courier" }],
          },
        },
      ]),
    );
    const page = out.pages[0];
    const contents = page.dict.v.get("Contents");
    const parts = contents?.k === "arr" ? contents.v.map((v) => contentText(out, v)) : [];
    // The page's own text still uses /F1 (Helvetica); the stamp uses /F12 (Courier), and a
    // longer name that merely starts with F1 is left alone.
    expect(parts).toEqual([
      "q\n",
      "BT /F1 12 Tf (one) Tj ET",
      "Q\nBT /F12 9 Tf (s) Tj /F1x 1 Tf ET",
    ]);
    const fonts = dictOf(dictOf(page.dict.v.get("Resources"))?.v.get("Font"));
    const base = (key: string) => {
      const ref = fonts?.v.get(key);
      return nameOf(ref?.k === "ref" ? dictOf(out.objects.get(ref.n)) : null, "BaseFont");
    };
    expect(base("F1")).toBe("Helvetica");
    expect(base("F12")).toBe("Courier");
  });

  it("writes an empty page tree for an empty selection", async () => {
    const src = await richDoc();
    const r = await parseDocument(buildPdf(src, []), inflate);
    expect(r.error).toBe("no pages found");
  });
});

describe("parsePageRanges", () => {
  it("parses lists, ranges, reversed and open-ended ranges", () => {
    expect(parsePageRanges("1-3, 5", 10)).toEqual({ ok: true, pages: [1, 2, 3, 5] });
    expect(parsePageRanges("3-1", 10).pages).toEqual([1, 2, 3]);
    expect(parsePageRanges("8-", 10).pages).toEqual([8, 9, 10]);
    expect(parsePageRanges("-2", 10).pages).toEqual([1, 2]);
    expect(parsePageRanges("1–3", 10).pages).toEqual([1, 2, 3]); // en dash
    expect(parsePageRanges("5,5 5", 10).pages).toEqual([5]);
    expect(parsePageRanges(" 2 ,, 4 ", 10).pages).toEqual([2, 4]);
  });

  it("clamps to the document and ignores pages outside it", () => {
    expect(parsePageRanges("9-20", 10).pages).toEqual([9, 10]);
    expect(parsePageRanges("0, 11", 10)).toEqual({
      ok: false,
      error: "no pages in range (this PDF has 10)",
      pages: [],
    });
  });

  it("reports empty input, junk and an empty document", () => {
    expect(parsePageRanges("  ", 5).error).toBe("enter which pages you want");
    expect(parsePageRanges("abc", 5).error).toBe('"abc" is not a page number or range');
    expect(parsePageRanges("1.5", 5).ok).toBe(false);
    expect(parsePageRanges("1-2-3", 5).ok).toBe(false);
    expect(parsePageRanges("1", 0).error).toBe("the PDF has no pages");
  });

  it("accepts spaces around the hyphen", () => {
    expect(parsePageRanges("2 - 4", 10).pages).toEqual([2, 3, 4]);
    expect(parsePageRanges("1, 3 – 5, 8 -", 10).pages).toEqual([1, 3, 4, 5, 8, 9, 10]);
  });

  it("clamps an absurdly large range end to the page count instead of iterating to it", () => {
    // 2^53 - 1 pages: a loop up to the written end could never finish, so returning at all
    // shows the end was clamped before iterating.
    expect(parsePageRanges("1-9007199254740991", 10).pages).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(parsePageRanges("99999999999-99999999990", 10).ok).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("formats bytes, KB and MB with one decimal", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(-5)).toBe("0 B");
    expect(formatFileSize(Number.NaN)).toBe("0 B");
    expect(formatFileSize(1023)).toBe("1023 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(5.25 * 1024 * 1024)).toBe("5.3 MB");
  });
});
