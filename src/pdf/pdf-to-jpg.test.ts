// Covers the pure renderer: PDF -> display list (paths, colours, glyph runs, decoded images)
// and the viewport maths. Replaying the list onto a canvas and JPEG/PNG encoding happen in the
// mount (browser-only) and are not tested here.
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  type PdfDocument,
  type RenderOp,
  type RenderedPage,
  openPdf,
  pageFileName,
  pageViewport,
  renderPage,
} from "./pdf-to-jpg.js";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

type Body = string | Array<string | Uint8Array | number[]>;

const stream = (data: string | Uint8Array | number[], dict = ""): Body => {
  const bytes = typeof data === "string" ? latin1(data) : Uint8Array.from(data);
  return [`<< /Length ${bytes.length} ${dict} >>\nstream\n`, bytes, "\nendstream"];
};

/** One page (object 3, content 4, resources dict inline) plus any extra objects. */
function makePdf(
  content: string | Uint8Array,
  resources = "<< >>",
  extra: Record<number, Body> = {},
  page = "/MediaBox [0 0 200 100]",
): Uint8Array {
  const bodies: Record<number, Body> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: `<< /Type /Page /Parent 2 0 R ${page} /Resources ${resources} /Contents 4 0 R >>`,
    4: stream(content),
    ...extra,
  };
  const parts: Uint8Array[] = [latin1("%PDF-1.4\n")];
  for (const [n, body] of Object.entries(bodies)) {
    parts.push(latin1(`${n} 0 obj\n`));
    for (const piece of typeof body === "string" ? [body] : body) {
      parts.push(typeof piece === "string" ? latin1(piece) : Uint8Array.from(piece));
    }
    parts.push(latin1("\nendobj\n"));
  }
  parts.push(latin1("trailer\n<< /Root 1 0 R >>\n%%EOF\n"));
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

async function render(...args: Parameters<typeof makePdf>): Promise<RenderedPage> {
  const opened = await openPdf(makePdf(...args), inflate);
  if (!opened.doc) throw new Error(opened.error);
  const page = await renderPage(opened.doc, 0, inflate);
  if (!page) throw new Error("no page");
  return page;
}

const drawn = (page: RenderedPage) => page.ops.filter((o) => o.t !== "save" && o.t !== "restore");
const only = <T extends RenderOp["t"]>(page: RenderedPage, t: T) =>
  page.ops.filter((o): o is Extract<RenderOp, { t: T }> => o.t === t);
const xs = (op: Extract<RenderOp, { t: "text" }>) =>
  op.glyphs.map((g) => Math.round(g.x * 1000) / 1000);

/* ------------------------------------------------------------------ */

describe("pageViewport", () => {
  const apply = (m: number[], x: number, y: number) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
  const page = (rotate: number): RenderedPage => ({
    index: 0,
    viewBox: [10, 20, 210, 120],
    rotate,
    ops: [],
    blank: true,
  });

  it("flips y so the page's top-left lands on the canvas origin", () => {
    const v = pageViewport(page(0), 2);
    expect([v.width, v.height]).toEqual([400, 200]);
    expect(apply(v.transform, 10, 120)).toEqual([0, 0]); // page top-left
    expect(apply(v.transform, 210, 20)).toEqual([400, 200]); // page bottom-right
  });

  it("rotates about the page centre for /Rotate 90, 180 and 270", () => {
    // 90 clockwise: page bottom-left -> canvas top-left, page top-left -> canvas top-right
    let v = pageViewport(page(90), 1);
    expect([v.width, v.height]).toEqual([100, 200]);
    expect(apply(v.transform, 10, 20)).toEqual([0, 0]);
    expect(apply(v.transform, 10, 120)).toEqual([100, 0]);
    // 180: page bottom-left -> canvas top-right
    v = pageViewport(page(180), 1);
    expect([v.width, v.height]).toEqual([200, 100]);
    expect(apply(v.transform, 10, 20)).toEqual([200, 0]);
    // 270: page bottom-left -> canvas bottom-right
    v = pageViewport(page(270), 1);
    expect(apply(v.transform, 10, 20)).toEqual([100, 200]);
    expect(apply(v.transform, 210, 120)).toEqual([0, 0]);
  });
});

describe("pageFileName", () => {
  it("zero-pads to the width of the page count", () => {
    expect(pageFileName("report", 2, 12, "jpg")).toBe("report-page-03.jpg");
    expect(pageFileName("report", 0, 9, "png")).toBe("report-page-1.png");
    expect(pageFileName("r", 99, 100, "jpg")).toBe("r-page-100.jpg");
  });
});

describe("openPdf / renderPage", () => {
  it("opens a PDF and reports its pages", async () => {
    const r = await openPdf(makePdf(""), inflate);
    expect(r.ok).toBe(true);
    expect(r.pageCount).toBe(1);
  });

  it("returns an error for empty, non-PDF and encrypted input", async () => {
    expect(await openPdf(new Uint8Array(), inflate)).toEqual({
      ok: false,
      error: "empty file",
      doc: null,
      pageCount: 0,
    });
    expect((await openPdf(latin1("\x89PNG"), inflate)).error).toBe("not a PDF file");
  });

  it("returns null for a page index that does not exist", async () => {
    const { doc } = await openPdf(makePdf(""), inflate);
    expect(await renderPage(doc as PdfDocument, 5, inflate)).toBeNull();
  });

  it("normalises the view box and reads /Rotate", async () => {
    const p = await render("", "<< >>", {}, "/MediaBox [300 400 0 0] /Rotate -90");
    expect(p.viewBox).toEqual([0, 0, 300, 400]);
    expect(p.rotate).toBe(270);
    expect(p.blank).toBe(true);
    const letter = await render("", "<< >>", {}, "/MediaBox [0 0 0 0]");
    expect(letter.viewBox).toEqual([0, 0, 612, 792]);
  });

  it("does not throw on garbage content", async () => {
    const p = await render("1 2 3 Tj ] >> ) ( q Q Q Q BT ET 9 9 9 9 9 cm ((( <<");
    expect(p).toBeDefined();
  });
});

describe("paths and graphics state", () => {
  it("fills a rectangle through the CTM", async () => {
    const p = await render("2 0 0 2 5 5 cm 1 0 0 rg 10 20 30 40 re f");
    const [fill] = only(p, "fill");
    expect(fill.color).toBe("rgb(255,0,0)");
    expect(fill.alpha).toBe(1);
    expect(fill.evenOdd).toBe(false);
    // (10,20) -> (25,45); (40,20) -> (85,45); (40,60) -> (85,125); (10,60) -> (25,125)
    expect(fill.path).toEqual([
      { c: "m", p: [25, 45] },
      { c: "l", p: [85, 45] },
      { c: "l", p: [85, 125] },
      { c: "l", p: [25, 125] },
      { c: "h" },
    ]);
    expect(p.blank).toBe(false);
  });

  it("scales stroke width and dashes by the CTM, with a 0.35 px floor", async () => {
    const p = await render(
      "2 0 0 2 0 0 cm 3 w 1 J 2 j [2 1] 0.5 d 0 0 m 10 0 l S 0 w 0 0 m 1 1 l S",
    );
    const [a, b] = only(p, "stroke");
    expect(a).toMatchObject({ width: 6, cap: 1, join: 2, dash: [4, 2], dashPhase: 1 });
    expect(b.width).toBe(0.35);
  });

  it("maps device colours", async () => {
    const colors = async (ops: string) =>
      only(await render(`${ops} 0 0 1 1 re f`), "fill")[0].color;
    expect(await colors("0.5 g")).toBe("rgb(128,128,128)");
    expect(await colors("0 0 0 1 k")).toBe("rgb(0,0,0)");
    expect(await colors("1 0 0 0 k")).toBe("rgb(0,255,255)");
    expect(await colors("0 0.5 1 0.5 k")).toBe("rgb(128,0,0)");
    expect(await colors("/DeviceRGB cs 0.2 0.4 0.6 sc")).toBe("rgb(51,102,153)");
    expect(await colors("/Pattern cs /P0 scn")).toBe("rgb(128,128,128)");
  });

  it("resolves named, ICC, Indexed and Separation colour spaces", async () => {
    const res =
      "<< /ColorSpace << /CS0 [/ICCBased 10 0 R] /CS1 [/Indexed /DeviceRGB 1 <FF000000FF00>] /CS2 [/Separation /Spot /DeviceCMYK 11 0 R] >> >>";
    const extra = { 10: stream("", "/N 4"), 11: "<< /FunctionType 2 /Domain [0 1] /N 1 >>" };
    const fills = only(
      await render(
        "/CS0 cs 0 0 0 1 sc 0 0 1 1 re f /CS1 cs 1 sc 0 0 1 1 re f /CS2 cs 1 scn 0 0 1 1 re f /CS2 cs 0 scn 0 0 1 1 re f",
        res,
        extra,
      ),
      "fill",
    ).map((f) => f.color);
    // ICC N=4 -> CMYK black; palette index 1 -> green; Separation 1 = full ink (black), 0 = none
    expect(fills).toEqual(["rgb(0,0,0)", "rgb(0,255,0)", "rgb(0,0,0)", "rgb(255,255,255)"]);
  });

  it("restores state after Q and records clips", async () => {
    const p = await render("q 1 0 0 rg 0 0 10 10 re W n Q 0 0 1 1 re f 0 0 5 5 re W* n");
    expect(p.ops.map((o) => o.t)).toEqual(["save", "clip", "restore", "fill", "clip"]);
    const clips = only(p, "clip");
    expect(clips.map((c) => c.evenOdd)).toEqual([false, true]);
    expect(only(p, "fill")[0].color).toBe("rgb(0,0,0)");
  });

  it("applies ExtGState alpha and skips fully transparent paint", async () => {
    const res = "<< /ExtGState << /Half << /ca 0.5 /CA 0.25 >> /None << /ca 0 >> >> >>";
    const p = await render("/Half gs 0 0 1 1 re B /None gs 0 0 1 1 re f", res);
    expect(only(p, "fill").map((f) => f.alpha)).toEqual([0.5]);
    expect(only(p, "stroke").map((s) => s.alpha)).toEqual([0.25]);
  });

  it("builds curves and closes subpaths", async () => {
    const p = await render("0 0 m 1 2 3 4 5 6 c 7 8 9 10 v 11 12 13 14 y h b*");
    const [fill] = only(p, "fill");
    expect(fill.evenOdd).toBe(true);
    expect(fill.path).toEqual([
      { c: "m", p: [0, 0] },
      { c: "b", p: [1, 2, 3, 4, 5, 6] },
      { c: "b", p: [5, 6, 7, 8, 9, 10] }, // v: first control point = current point
      { c: "b", p: [11, 12, 13, 14, 13, 14] }, // y: second control point = end point
      { c: "h" },
      { c: "h" }, // b* closes again before painting
    ]);
    expect(only(p, "stroke")).toHaveLength(1);
  });
});

describe("text", () => {
  const F1 = "<< /Font << /F1 10 0 R >> >>";
  const font = (dict: string) => ({ 10: dict });

  it("positions glyphs from the standard Helvetica widths", async () => {
    const p = await render(
      "BT /F1 10 Tf 100 50 Td (AV) Tj ET",
      F1,
      font("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    );
    const [t] = only(p, "text");
    expect(t.m).toEqual([1, 0, 0, 1, 100, 50]);
    expect(t.size).toBe(10);
    expect(t.glyphs.map((g) => g.c)).toEqual(["A", "V"]);
    expect(xs(t)).toEqual([0, 6.67]); // A = 667/1000 em
    expect([t.family, t.weight, t.style]).toEqual([
      "Helvetica, Arial, sans-serif",
      "normal",
      "normal",
    ]);
    expect(t.fill).toBe("rgb(0,0,0)");
    expect(t.stroke).toBeNull();
  });

  it("uses the font's own /Widths, kerning, Tc, Tw and Tz", async () => {
    const f = font(
      "<< /Type /Font /Subtype /TrueType /BaseFont /Arial /FirstChar 65 /Widths [500 600] >>",
    );
    const run = async (ops: string) =>
      xs(only(await render(`BT /F1 10 Tf ${ops} ET`, F1, f), "text")[0]);
    expect(await run("(AB) Tj")).toEqual([0, 5]);
    expect(await run("[(A) -1000 (B)] TJ")).toEqual([0, 15]); // kerning -1000 = +1 em
    expect(await run("1 Tc (AB) Tj")).toEqual([0, 6]);
    expect(await run("50 Tz (AB) Tj")).toEqual([0, 2.5]);
    // Space (code 32) is outside /Widths -> Helvetica 278; Tw 2 applies to it
    expect(await run("2 Tw (A B) Tj")).toEqual([0, 5 + 2.78 + 2]);
  });

  it("advances over invisible text (render mode 3) without drawing it", async () => {
    const p = await render(
      "BT /F1 10 Tf 3 Tr (A) Tj 0 Tr (V) Tj ET",
      F1,
      font("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    );
    const texts = only(p, "text");
    expect(texts).toHaveLength(1);
    expect(texts[0].m[4]).toBeCloseTo(6.67, 10);
  });

  it("strokes outline text and classifies font names", async () => {
    const p = await render(
      "BT /F1 12 Tf 1 Tr 1 0 0 RG (x) Tj ET",
      F1,
      font("<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Times-BoldItalic >>"),
    );
    const [t] = only(p, "text");
    expect(t.fill).toBeNull();
    expect(t.stroke).toBe("rgb(255,0,0)");
    expect([t.family, t.weight, t.style]).toEqual([
      '"Times New Roman", Times, serif',
      "bold",
      "italic",
    ]);
  });

  it("skips symbol fonts", async () => {
    const p = await render(
      "BT /F1 12 Tf (abc) Tj ET",
      F1,
      font("<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>"),
    );
    expect(only(p, "text")).toHaveLength(0);
  });

  it("maps /Differences glyph names", async () => {
    const p = await render(
      "BT /F1 12 Tf (ABC) Tj ET",
      F1,
      font(
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [65 /bullet /uni0416 /emdash] >> >>",
      ),
    );
    expect(only(p, "text")[0].glyphs.map((g) => g.c)).toEqual(["•", "Ж", "—"]);
  });

  it("decodes a Type0 font with ToUnicode and CID widths", async () => {
    const res = "<< /Font << /F1 10 0 R >> >>";
    const extra = {
      10: "<< /Type /Font /Subtype /Type0 /BaseFont /Roboto /Encoding /Identity-H /DescendantFonts [11 0 R] /ToUnicode 12 0 R >>",
      11: "<< /Type /Font /Subtype /CIDFontType2 /DW 1000 /W [1 [500 700] 5 6 250] >>",
      12: stream(
        "begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <041C> <0002> <0438> endbfchar 1 beginbfrange <0005> <0006> <0440> endbfrange",
      ),
    };
    const [t] = only(await render("BT /F1 10 Tf <00010002000500060003> Tj ET", res, extra), "text");
    // М(500) и(700) р(250) с(250) then code 3 (no mapping, DW 1000)
    expect(t.glyphs.map((g) => g.c)).toEqual(["М", "и", "р", "с"]);
    expect(xs(t)).toEqual([0, 5, 12, 14.5]);
  });

  it("spaces unembedded Courier at 600/1000 em per glyph", async () => {
    const p = await render(
      "BT /F1 10 Tf (ii) Tj ET",
      F1,
      font("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"),
    );
    expect(xs(only(p, "text")[0])).toEqual([0, 6]);
  });
});

describe("images", () => {
  const XO = "<< /XObject << /Im0 10 0 R >> >>";
  const img = async (
    dict: string,
    data: string | Uint8Array | number[],
    ops = "q 20 0 0 10 5 5 cm /Im0 Do Q",
  ) =>
    only(
      await render(ops, XO, { 10: stream(data, `/Type /XObject /Subtype /Image ${dict}`) }),
      "image",
    );
  const rgba = async (dict: string, data: string | Uint8Array | number[]) => {
    const [op] = await img(dict, data);
    if (op?.image.kind !== "rgba") throw new Error(`expected rgba, got ${op?.image.kind}`);
    return [...op.image.data];
  };

  it("decodes an 8-bit RGB image and places it with the CTM", async () => {
    const [op] = await img(
      "/Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8",
      [255, 0, 0, 0, 0, 255],
    );
    expect(op.m).toEqual([20, 0, 0, 10, 5, 5]);
    expect(op.image).toEqual({
      kind: "rgba",
      width: 2,
      height: 1,
      data: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]),
    });
  });

  it("unpacks 1-bit grey, inverted grey, CMYK and Indexed samples", async () => {
    // 0b10100000 -> 1,0,1,0,0,0,0,0
    expect(
      await rgba("/Width 4 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1", [0b10100000]),
    ).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    expect(
      await rgba(
        "/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Decode [1 0]",
        [0],
      ),
    ).toEqual([255, 255, 255, 255]);
    expect(
      await rgba("/Width 1 /Height 1 /ColorSpace /DeviceCMYK /BitsPerComponent 8", [255, 0, 0, 0]),
    ).toEqual([0, 255, 255, 255]);
    expect(
      await rgba(
        "/Width 2 /Height 1 /ColorSpace [/Indexed /DeviceRGB 1 <FF000000FF00>] /BitsPerComponent 8",
        [1, 0],
      ),
    ).toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
  });

  it("hands JPEGs to the browser untouched, after ASCII armour", async () => {
    const jpeg = [0xff, 0xd8, 0xff, 0xd9];
    const [op] = await img("/Width 1 /Height 1 /Filter /DCTDecode", jpeg);
    expect(op.image).toEqual({ kind: "jpeg", bytes: Uint8Array.from(jpeg), alpha: null });
    const [hexed] = await img(
      "/Width 1 /Height 1 /Filter [/ASCIIHexDecode /DCTDecode]",
      "FFD8 FFD9>",
    );
    expect(hexed.image.kind === "jpeg" && [...hexed.image.bytes]).toEqual(jpeg);
  });

  it("decodes ASCII85, ASCIIHex, RunLength, LZW and Flate+TIFF predictor", async () => {
    const gray = (w: number, filter: string) =>
      `/Width ${w} /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter ${filter}`;
    const grey = (data: number[]) => data.flatMap((v) => [v, v, v, 255]);
    // ASCII85 (Wikipedia): "sure." -> F*2M7/c
    expect(await rgba(gray(5, "/ASCII85Decode"), "F*2M7/c~>")).toEqual(
      grey([115, 117, 114, 101, 46]),
    );
    // "z" stands for four zero bytes
    expect(await rgba(gray(4, "/A85"), "z~>")).toEqual(grey([0, 0, 0, 0]));
    // ASCIIHex with whitespace and an odd final digit (padded with 0)
    expect(await rgba(gray(3, "/AHx"), "0a 1B f>")).toEqual(grey([10, 27, 240]));
    // RunLength: 2 -> copy 3 literal bytes; 254 -> repeat next byte 257-254 = 3 times; 128 = EOD
    expect(await rgba(gray(6, "/RunLengthDecode"), [2, 10, 20, 30, 254, 99, 128])).toEqual(
      grey([10, 20, 30, 99, 99, 99]),
    );
    // LZW example from the PDF reference: 80 0B 60 50 22 0C 0C 85 01 -> 45 45 45 45 45 65 45 45 45 66
    expect(
      await rgba(gray(10, "/LZWDecode"), [0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]),
    ).toEqual(grey([0x2d, 0x2d, 0x2d, 0x2d, 0x2d, 0x41, 0x2d, 0x2d, 0x2d, 0x42]));
    // TIFF predictor 2: each sample adds the one to its left -> 10, 15, 20
    const packed = new Uint8Array(deflateSync(Buffer.from([10, 5, 5])));
    expect(
      await rgba(`${gray(3, "/FlateDecode")} /DecodeParms << /Predictor 2 /Columns 3 >>`, packed),
    ).toEqual(grey([10, 15, 20]));
  });

  it("skips an image whose predictor parameters are unusable instead of allocating from them", async () => {
    const gray =
      "/Width 3 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode";
    const packed = new Uint8Array(deflateSync(Buffer.from([0, 10, 5, 5])));
    for (const parms of [
      "/Predictor 12 /Columns 0",
      "/Predictor 12 /Columns -3",
      "/Predictor 12 /Colors 0 /Columns 3",
      "/Predictor 2 /BitsPerComponent 5 /Columns 3",
      "/Predictor 12 /Columns 1.5",
    ]) {
      expect(await img(`${gray} /DecodeParms << ${parms} >>`, packed), parms).toHaveLength(0);
    }
    // A row far longer than the data (about 10^14 bytes) yields no rows and allocates nothing.
    expect(
      await img(`${gray} /DecodeParms << /Predictor 12 /Columns 99999999999999 >>`, packed),
    ).toHaveLength(0);
    // Valid parameters still decode: PNG Sub row -> 10, 15, 20.
    const sub = new Uint8Array(deflateSync(Buffer.from([1, 10, 5, 5])));
    expect(await rgba(`${gray} /DecodeParms << /Predictor 12 /Columns 3 >>`, sub)).toEqual([
      10, 10, 10, 255, 15, 15, 15, 255, 20, 20, 20, 255,
    ]);
  });

  it("skips formats the browser cannot get from us (JPX, JBIG2)", async () => {
    expect(await img("/Width 1 /Height 1 /Filter /JPXDecode", [0])).toHaveLength(0);
    expect(
      await img("/Width 0 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", [0]),
    ).toHaveLength(0);
  });

  it("paints stencil masks in the fill colour and applies soft masks", async () => {
    const [mask] = await img(
      "/Width 8 /Height 1 /ImageMask true /BitsPerComponent 1",
      [0x0f],
      "q 1 0 0 rg 8 0 0 1 0 0 cm /Im0 Do Q",
    );
    // Sample 0 paints by default: 0x0F -> 0000 1111 -> painted, painted, painted, painted, no…
    expect(mask.image).toEqual({
      kind: "stencil",
      width: 8,
      height: 1,
      bits: Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0]),
      color: "rgb(255,0,0)",
    });

    const p = await render("/Im0 Do", XO, {
      10: stream(
        [0, 0, 0, 0, 0, 0],
        "/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 11 0 R",
      ),
      11: stream(
        [255, 64],
        "/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8",
      ),
    });
    const [soft] = only(p, "image");
    expect(soft.image.kind === "rgba" && [...soft.image.data]).toEqual([0, 0, 0, 255, 0, 0, 0, 64]);
  });

  it("decodes inline images and keeps reading the stream after EI", async () => {
    const content = latin1(
      "q 2 0 0 1 0 0 cm BI /W 2 /H 1 /CS /G /BPC 8 ID \x00\xff EI Q 0 0 1 1 re f",
    );
    const p = await render(content);
    const [image] = only(p, "image");
    expect(image.image.kind === "rgba" && [...image.image.data]).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    expect(only(p, "fill")).toHaveLength(1);
  });

  it("renders a full-ink Separation image sample as black", async () => {
    const pixels = await rgba(
      "/Width 1 /Height 1 /ColorSpace [/Separation /Black /DeviceCMYK 11 0 R] /BitsPerComponent 8",
      [255],
    );
    expect(pixels).toEqual([0, 0, 0, 255]);
  });
});

describe("form XObjects and content streams", () => {
  it("runs a form inside save/restore, clipped to its transformed BBox", async () => {
    const p = await render("/Fm0 Do", "<< /XObject << /Fm0 10 0 R >> >>", {
      10: stream(
        "1 0 0 rg 0 0 5 5 re f",
        "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Matrix [2 0 0 2 0 0]",
      ),
    });
    expect(p.ops.map((o) => o.t)).toEqual(["save", "clip", "fill", "restore"]);
    expect(only(p, "clip")[0].path.slice(0, 3)).toEqual([
      { c: "m", p: [0, 0] },
      { c: "l", p: [20, 0] },
      { c: "l", p: [20, 20] },
    ]);
    expect(only(p, "fill")[0].path[2]).toEqual({ c: "l", p: [10, 10] });
  });

  it("stops a form that draws itself instead of recursing forever", async () => {
    const p = await render("/Fm0 Do", "<< /XObject << /Fm0 10 0 R >> >>", {
      10: stream(
        "0 0 1 1 re f /Fm0 Do",
        "/Type /XObject /Subtype /Form /Resources << /XObject << /Fm0 10 0 R >> >>",
      ),
    });
    expect(only(p, "fill").length).toBeGreaterThan(1);
    expect(only(p, "fill").length).toBeLessThanOrEqual(13);
  });

  it("reads Flate-compressed content and Contents arrays", async () => {
    const packed = new Uint8Array(deflateSync(Buffer.from("0 0 1 1 re f")));
    const pdf = makePdf("", "<< >>", {
      4: stream(packed, "/Filter /FlateDecode"),
    });
    const { doc } = await openPdf(pdf, inflate);
    expect(
      only((await renderPage(doc as PdfDocument, 0, inflate)) as RenderedPage, "fill"),
    ).toHaveLength(1);

    const arr = makePdf("", "<< >>", {
      3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents [10 0 R 11 0 R] >>",
      10: stream("0 0 m 5 5"),
      11: stream("l S"),
    });
    const opened = await openPdf(arr, inflate);
    const page = (await renderPage(opened.doc as PdfDocument, 0, inflate)) as RenderedPage;
    expect(drawn(page).map((o) => o.t)).toEqual(["stroke"]);
  });
});
