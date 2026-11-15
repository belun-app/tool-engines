import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dictOf, nameOf, parseDocument } from "./_pdf-lib.js";
import {
  type SignPdfOptions,
  cleanSignatureText,
  hasSignature,
  inkBounds,
  readPdfInfo,
  signPdf,
  signatureAspect,
  stampGeometry,
} from "./sign-pdf.js";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

function makePdf(pages: Array<{ box?: [number, number]; rotate?: number }>) {
  const bodies: string[] = [];
  const kids: string[] = [];
  pages.forEach((p, i) => {
    const pageNum = 3 + i * 2;
    kids.push(`${pageNum} 0 R`);
    const box = ` /MediaBox [0 0 ${p.box?.[0] ?? 600} ${p.box?.[1] ?? 800}]`;
    const rot = p.rotate !== undefined ? ` /Rotate ${p.rotate}` : "";
    bodies[pageNum] = `<< /Type /Page /Parent 2 0 R${box}${rot} /Contents ${pageNum + 1} 0 R >>`;
    const s = `BT (p${i + 1}) Tj ET`;
    bodies[pageNum + 1] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  });
  bodies[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  bodies[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n";
  for (let n = 1; n < bodies.length; n++) out += `${n} 0 obj\n${bodies[n]}\nendobj\n`;
  out += "trailer\n<< /Root 1 0 R >>\n%%EOF\n";
  return latin1(out);
}

/** The stamp stream per page (last Contents element), null for untouched pages. */
async function stamps(bytes: Uint8Array) {
  const { doc, error } = await parseDocument(bytes, inflate);
  if (!doc) throw new Error(error);
  return {
    doc,
    stamps: doc.pages.map((p) => {
      const c = p.dict.v.get("Contents");
      if (c?.k !== "arr") return null;
      const last = c.v[c.v.length - 1];
      const s = last.k === "ref" ? doc.objects.get(last.n) : undefined;
      return s?.k === "stream" ? Buffer.from(s.raw).toString("latin1") : null;
    }),
  };
}

const typed = (over: Partial<SignPdfOptions> = {}): SignPdfOptions => ({
  mode: "type",
  text: "Hi",
  placement: { x: 0.5, y: 0.5, width: 0.2 },
  page: 1,
  ...over,
});

const drawn = (over: Partial<SignPdfOptions> = {}): SignPdfOptions => ({
  mode: "draw",
  strokes: [
    {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      width: 2,
    },
  ],
  placement: { x: 0, y: 0, width: 0.51 },
  page: 1,
  ...over,
});

describe("inkBounds", () => {
  it("is empty without points", () => {
    const empty = { x: 0, y: 0, width: 0, height: 0, empty: true };
    expect(inkBounds(undefined)).toEqual(empty);
    expect(inkBounds([])).toEqual(empty);
    expect(inkBounds([{ points: [], width: 3 }])).toEqual(empty);
    expect(inkBounds([{ points: [{ x: Number.NaN, y: 1 }], width: 3 }])).toEqual(empty);
  });

  it("grows the box by half the pen width", () => {
    // points (10,20) and (30,60), pen 4 -> x 8..32, y 18..62
    expect(
      inkBounds([
        {
          points: [
            { x: 10, y: 20 },
            { x: 30, y: 60 },
          ],
          width: 4,
        },
      ]),
    ).toEqual({ x: 8, y: 18, width: 24, height: 44, empty: false });
  });

  it("spans several strokes, skips bad points and keeps a 1 px minimum size", () => {
    const b = inkBounds([
      { points: [{ x: 5, y: 5 }], width: Number.NaN },
      {
        points: [
          { x: 15, y: 5 },
          { x: Number.POSITIVE_INFINITY, y: 0 },
        ],
        width: 0,
      },
    ]);
    expect(b).toEqual({ x: 5, y: 5, width: 10, height: 1, empty: false });
  });
});

describe("cleanSignatureText / hasSignature", () => {
  it("collapses whitespace and keeps Latin-1", () => {
    expect(cleanSignatureText("  José   García \t")).toEqual({
      text: "José García",
      dropped: false,
    });
    expect(cleanSignatureText(undefined)).toEqual({ text: "", dropped: false });
  });

  it("drops what the built-in fonts cannot draw and caps at 60 characters", () => {
    expect(cleanSignatureText("Иван")).toEqual({ text: "", dropped: true });
    expect(cleanSignatureText("Ivan Иванов")).toEqual({ text: "Ivan", dropped: true });
    expect(cleanSignatureText("x".repeat(70)).text).toHaveLength(60);
  });

  it("knows when there is something to stamp", () => {
    expect(hasSignature(typed())).toBe(true);
    expect(hasSignature(typed({ text: "  " }))).toBe(false);
    expect(hasSignature(typed({ text: "Пётр" }))).toBe(false);
    expect(hasSignature(drawn())).toBe(true);
    expect(hasSignature(drawn({ strokes: [] }))).toBe(false);
  });
});

describe("signatureAspect", () => {
  it("is one em tall over the typed width", () => {
    // Times-Italic: H 722 + i 278 = 1000/1000 em wide -> height/width = 1
    expect(signatureAspect(typed({ text: "Hi" }))).toBeCloseTo(1, 10);
    // Courier is 600/1000 per glyph: "ab" = 1.2 em -> 1/1.2
    expect(signatureAspect(typed({ text: "ab", font: "courier" }))).toBeCloseTo(1 / 1.2, 10);
    expect(signatureAspect(typed({ text: "" }))).toBe(0.25);
  });

  it("follows the ink's bounding box, clamped to 0.02..20", () => {
    // Stroke 0..100 x 0..50 with pen 2 -> 102 x 52
    expect(signatureAspect(drawn())).toBeCloseTo(52 / 102, 10);
    expect(signatureAspect(drawn({ strokes: [] }))).toBe(0.4);
    const flat = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
        ],
        width: 0,
      },
    ];
    expect(signatureAspect(drawn({ strokes: flat }))).toBe(0.02);
    const tall = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 1000 },
        ],
        width: 0,
      },
    ];
    expect(signatureAspect(drawn({ strokes: tall }))).toBe(20);
  });
});

describe("stampGeometry", () => {
  const ink = (w: number, h: number) => [
    {
      points: [
        { x: 0, y: 0 },
        { x: w, y: h },
      ],
      width: 0,
    },
  ];

  it("sizes the stamp from the placement fractions", () => {
    // 600x800 page, width 0.2 -> 120, aspect 0.5 -> 60 tall, at (0.5, 0.5)
    expect(
      stampGeometry(
        drawn({ strokes: ink(100, 50), placement: { x: 0.5, y: 0.5, width: 0.2 } }),
        600,
        800,
      ),
    ).toEqual({ left: 300, top: 400, width: 120, height: 60 });
  });

  it("keeps the stamp fully on the page", () => {
    const g = stampGeometry(
      drawn({ strokes: ink(100, 50), placement: { x: 0.95, y: 0.99, width: 0.2 } }),
      600,
      800,
    );
    expect(g).toEqual({ left: 480, top: 740, width: 120, height: 60 });
  });

  it("clamps the width fraction and shrinks a stamp taller than the page", () => {
    expect(
      stampGeometry(drawn({ strokes: ink(100, 50), placement: { x: 0, y: 0, width: 5 } }), 600, 800)
        .width,
    ).toBe(600);
    expect(
      stampGeometry(drawn({ strokes: ink(100, 50), placement: { x: 0, y: 0, width: 0 } }), 600, 800)
        .width,
    ).toBeCloseTo(18, 10);
    // aspect 20, width 600 -> 12000 tall: shrink to 800 tall, 40 wide
    expect(
      stampGeometry(drawn({ strokes: ink(0, 100), placement: { x: 0, y: 0, width: 1 } }), 600, 800),
    ).toEqual({
      left: 0,
      top: 0,
      width: 40,
      height: 800,
    });
  });

  it("falls back to the defaults (x 0.55, y 0.8, width 0.3) for non-finite input", () => {
    const g = stampGeometry(
      drawn({
        strokes: ink(100, 50),
        placement: { x: Number.NaN, y: Number.NaN, width: Number.NaN },
      }),
      1000,
      1000,
    );
    expect(g).toEqual({ left: 550, top: 800, width: 300, height: 150 });
  });
});

describe("signPdf", () => {
  it("stamps a typed name on the chosen page only", async () => {
    const r = await signPdf(makePdf([{}, {}, {}]), typed({ page: 2, color: "#ff0000" }), inflate);
    expect(r.ok).toBe(true);
    expect(r.pageCount).toBe(3);
    expect(r.signedCount).toBe(1);
    expect(r.sizeBytes).toBe(r.bytes.length);
    const { doc, stamps: s } = await stamps(r.bytes);
    expect(s[0]).toBeNull();
    expect(s[2]).toBeNull();
    // 600x800 page, width 0.2 -> 120 pt; "Hi" is 1 em -> size 120; x = 300,
    // baseline y = 800 - 400 - 120 * 0.78 = 306.4
    expect(s[1]).toBe(
      "Q\nq\n1 0 0 1 0 0 cm\nBT\n/SignatureFont 120 Tf\n1 0 0 rg\n300 306.4 Td\n<4869> Tj\nET\nQ\n",
    );
    const font = dictOf(dictOf(doc.pages[1].dict.v.get("Resources"))?.v.get("Font"))?.v.get(
      "SignatureFont",
    );
    expect(nameOf(font?.k === "ref" ? dictOf(doc.objects.get(font.n)) : null, "BaseFont")).toBe(
      "Times-Italic",
    );
  });

  it("parses #rgb colours and falls back to blue-black ink", async () => {
    const color = async (c: string | undefined) => {
      const r = await signPdf(makePdf([{}]), typed({ color: c }), inflate);
      return /\n([\d. ]+) rg\n/.exec((await stamps(r.bytes)).stamps[0] ?? "")?.[1];
    };
    expect(await color("#0f0")).toBe("0 1 0");
    expect(await color("  #336699 ")).toBe("0.2 0.4 0.6");
    expect(await color("blue")).toBe("0.086 0.129 0.243");
    expect(await color(undefined)).toBe("0.086 0.129 0.243");
  });

  it("clamps the page number and can sign every page", async () => {
    const pdf = makePdf([{}, {}]);
    expect((await stamps((await signPdf(pdf, typed({ page: 99 }), inflate)).bytes)).stamps).toEqual(
      [null, expect.any(String)],
    );
    expect(
      (await stamps((await signPdf(pdf, typed({ page: 0 }), inflate)).bytes)).stamps[0],
    ).not.toBeNull();
    expect(
      (await stamps((await signPdf(pdf, typed({ page: Number.NaN }), inflate)).bytes)).stamps[0],
    ).not.toBeNull();
    const all = await signPdf(pdf, typed({ everyPage: true }), inflate);
    expect(all.signedCount).toBe(2);
    expect((await stamps(all.bytes)).stamps.every((s) => s !== null)).toBe(true);
  });

  it("draws ink as scaled paths in page space", async () => {
    const r = await signPdf(makePdf([{}]), drawn(), inflate);
    const s = (await stamps(r.bytes)).stamps[0] ?? "";
    // Bounds -1..101 x -1..51 (102 x 52). Width 0.51 * 600 = 306 -> scale 3, at the top-left
    // corner (left 0, top 0 -> y origin 800). Pen 2 * 3 = 6.
    // (0,0) -> (0 + 1*3, 800 - 1*3) = (3, 797); (100,50) -> (303, 800 - 51*3) = (303, 647)
    expect(s).toContain("1 J 1 j");
    expect(s).toContain("6 w\n3 797 m\n303 647 l\nS");
    expect(s).not.toContain("Tf");
  });

  it("smooths three or more points into cubic curves and turns a tap into a dot", async () => {
    const curve = drawn({
      strokes: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          width: 0,
        },
        { points: [{ x: 5, y: 5 }], width: 0 },
      ],
      placement: { x: 0, y: 0, width: 10 / 600 },
    });
    const s = (await stamps((await signPdf(makePdf([{}]), curve, inflate)).bytes)).stamps[0] ?? "";
    // Width fraction clamps to 0.03 -> 18 pt for a 10 px box -> scale 1.8.
    // (0,0)->(0,800), ctrl (10,0)->(18,800), end mid (10,5)->(18,791), last (10,10)->(18,782)
    // c1 = 0 + 2/3*(18-0) = 12, 800; c2 = 18 + 2/3*(18-18) = 18, 791 + 2/3*(800-791) = 797
    expect(s).toContain("0 800 m\n12 800 18 797 18 791 c\n18 782 l");
    // The tap at (5,5) -> (9, 791): a 0.01 pt segment.
    expect(s).toContain("9 791 m\n9.01 791 l");
    // Pen width never drops below 0.2 pt.
    expect(s).toContain("0.2 w");
  });

  it("maps the stamp through /Rotate so it lands where the reader sees it", async () => {
    const r = await signPdf(makePdf([{ rotate: 90 }]), typed(), inflate);
    expect((await stamps(r.bytes)).stamps[0]).toContain("0 1 -1 0 600 0 cm");
  });

  it("warns when part of a typed name was dropped", async () => {
    const r = await signPdf(makePdf([{}]), typed({ text: "Ivan Иванов" }), inflate);
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/Latin alphabet/);
  });

  it("explains what is missing instead of producing a file", async () => {
    const pdf = makePdf([{}]);
    expect((await signPdf(new Uint8Array(), typed(), inflate)).error).toBe("add a PDF first");
    expect((await signPdf(pdf, typed({ text: "" }), inflate)).error).toBe(
      "type a name to sign with",
    );
    expect((await signPdf(pdf, typed({ text: "Иван" }), inflate)).error).toMatch(/no glyphs/);
    expect((await signPdf(pdf, drawn({ strokes: [] }), inflate)).error).toBe(
      "draw a signature on the pad first",
    );
    expect((await signPdf(latin1("not a pdf"), typed(), inflate)).error).toBe("not a PDF file");
  });

  it("readPdfInfo counts pages", async () => {
    expect(await readPdfInfo(makePdf([{}, {}]), inflate)).toEqual({ ok: true, pageCount: 2 });
    expect((await readPdfInfo(new Uint8Array(), inflate)).error).toBe("empty file");
  });
});
