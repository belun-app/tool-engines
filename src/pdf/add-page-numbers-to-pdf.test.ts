import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { type PdfDocument, dictOf, nameOf, parseDocument } from "./_pdf-lib.js";
import { addPageNumbers, pageNumberLabel, readPdfInfo } from "./add-page-numbers-to-pdf.js";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

interface TestPage {
  box?: [number, number];
  rotate?: number;
}

function makePdf(pages: TestPage[]) {
  const bodies: string[] = [];
  const kids: string[] = [];
  pages.forEach((p, i) => {
    const pageNum = 3 + i * 2;
    kids.push(`${pageNum} 0 R`);
    const box = ` /MediaBox [0 0 ${p.box?.[0] ?? 612} ${p.box?.[1] ?? 792}]`;
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

const nPages = (n: number) => makePdf(Array.from({ length: n }, () => ({})));

/** The stamp stream of each page (last element of its Contents array), or null if unstamped. */
async function stamps(
  bytes: Uint8Array,
): Promise<{ doc: PdfDocument; stamps: Array<string | null> }> {
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

const hex = (s: string) => Buffer.from(s, "latin1").toString("hex");

describe("pageNumberLabel", () => {
  it("fills {n} and {total}", () => {
    expect(pageNumberLabel({}, 0, 5)).toBe("1");
    expect(pageNumberLabel({ format: "Page {n} of {total}" }, 2, 12)).toBe("Page 3 of 12");
    expect(pageNumberLabel({ format: "{n}/{n}" }, 0, 1)).toBe("1/1");
    expect(pageNumberLabel({ format: "- {n} -", startNumber: 10 }, 1, 3)).toBe("- 11 -");
  });

  it("renders roman numerals, falling back to digits outside 1..3999", () => {
    expect(pageNumberLabel({ style: "roman-lower" }, 3, 1)).toBe("iv");
    expect(pageNumberLabel({ style: "roman-upper", startNumber: 1994 }, 0, 1)).toBe("MCMXCIV");
    expect(pageNumberLabel({ style: "roman-upper", startNumber: 3999 }, 0, 1)).toBe("MMMCMXCIX");
    expect(pageNumberLabel({ style: "roman-upper", startNumber: 3999 }, 1, 2)).toBe("4000");
    expect(pageNumberLabel({ style: "roman-lower", startNumber: 0 }, 0, 1)).toBe("0");
  });

  it("renders spreadsheet-style letters", () => {
    // 26 -> z, 27 -> aa, 52 -> az, 53 -> ba, 702 -> zz, 703 -> aaa
    const alpha = (n: number) => pageNumberLabel({ style: "alpha-lower", startNumber: n }, 0, 1);
    expect([1, 26, 27, 52, 53, 702, 703].map(alpha)).toEqual([
      "a",
      "z",
      "aa",
      "az",
      "ba",
      "zz",
      "aaa",
    ]);
    expect(pageNumberLabel({ style: "alpha-upper", startNumber: 28 }, 0, 1)).toBe("AB");
    expect(pageNumberLabel({ style: "alpha-lower", startNumber: 0 }, 0, 1)).toBe("0");
  });

  it("normalises the start number (rounded, clamped to 0..99999, NaN -> 1)", () => {
    expect(pageNumberLabel({ startNumber: Number.NaN }, 0, 1)).toBe("1");
    expect(pageNumberLabel({ startNumber: -5 }, 0, 1)).toBe("0");
    expect(pageNumberLabel({ startNumber: 2.6 }, 0, 1)).toBe("3");
    expect(pageNumberLabel({ startNumber: 1e9 }, 0, 1)).toBe("99999");
  });

  it("keeps an em dash, which WinAnsi fonts can draw", () => {
    expect(pageNumberLabel({ format: "— {n} —", startNumber: 10 }, 1, 3)).toBe("— 11 —");
  });

  it("strips characters the built-in fonts cannot draw", () => {
    expect(pageNumberLabel({ format: "Стр. {n}" }, 0, 1)).toBe(". 1");
  });
});

describe("readPdfInfo", () => {
  it("counts pages and rejects empty input", async () => {
    expect(await readPdfInfo(nPages(2), inflate)).toEqual({ ok: true, pageCount: 2 });
    expect((await readPdfInfo(new Uint8Array(), inflate)).ok).toBe(false);
  });
});

describe("addPageNumbers", () => {
  it("stamps every page by default, bottom centre, Helvetica 11 pt, 36 pt margin", async () => {
    const r = await addPageNumbers(nPages(3), {}, inflate);
    expect(r.ok).toBe(true);
    expect(r.numberedCount).toBe(3);
    expect([r.firstLabel, r.lastLabel]).toEqual(["1", "3"]);
    expect(r.warning).toBeUndefined();
    expect(r.sizeBytes).toBe(r.bytes.length);
    const { doc, stamps: s } = await stamps(r.bytes);
    // "1" is 556/1000 em -> 6.116 pt wide at 11 pt; x = (612 - 6.116) / 2 = 302.942
    expect(s[0]).toBe(
      `Q\nq\n1 0 0 1 0 0 cm\nBT\n/PageNumberFont 11 Tf\n0 g\n302.94 36 Td\n<${hex("1")}> Tj\nET\nQ\n`,
    );
    expect(s[2]).toContain(`<${hex("3")}> Tj`);
    const font = dictOf(dictOf(doc.pages[0].dict.v.get("Resources"))?.v.get("Font"))?.v.get(
      "PageNumberFont",
    );
    const fontDict = font?.k === "ref" ? dictOf(doc.objects.get(font.n)) : null;
    expect(nameOf(fontDict, "BaseFont")).toBe("Helvetica");
  });

  it("places the stamp at each position", async () => {
    const td = async (
      position: Parameters<typeof addPageNumbers>[1]["position"],
      font?: "courier",
    ) => {
      const r = await addPageNumbers(nPages(1), { position, font }, inflate);
      return /\n([\d.-]+ [\d.-]+) Td/.exec((await stamps(r.bytes)).stamps[0] ?? "")?.[1];
    };
    // Helvetica "1" = 6.116 pt. right: 612 - 36 - 6.116 = 569.884; top: 792 - 36 - 11 = 745
    expect(await td("bottom-left")).toBe("36 36");
    expect(await td("bottom-right")).toBe("569.88 36");
    expect(await td("top-left")).toBe("36 745");
    expect(await td("top-center")).toBe("302.94 745");
    expect(await td("top-right")).toBe("569.88 745");
    // Courier "1" = 600/1000 em -> 6.6 pt: right = 612 - 36 - 6.6 = 569.4 (written with 2 decimals)
    expect(await td("bottom-right", "courier")).toBe("569.40 36");
  });

  it("works in the viewer's orientation on a rotated page", async () => {
    const r = await addPageNumbers(makePdf([{ rotate: 90 }]), {}, inflate);
    const s = (await stamps(r.bytes)).stamps[0] ?? "";
    // Viewed 792 wide: x = (792 - 6.116) / 2 = 392.942; matrix maps view space onto the page.
    expect(s).toContain("0 1 -1 0 612 0 cm");
    expect(s).toContain("392.94 36 Td");
  });

  it("clamps size and margin, and keeps the stamp on a tiny page", async () => {
    const r = await addPageNumbers(
      makePdf([{ box: [100, 100] }]),
      { fontSize: 1000, margin: 500, position: "bottom-left" },
      inflate,
    );
    const s = (await stamps(r.bytes)).stamps[0] ?? "";
    // fontSize clamps to 72 and margin to 200; "1" is then 40.032 pt wide, so x = 200 is pulled
    // back to 100 - 40.032 and y = 200 to 100 - 72.
    expect(s).toContain("/PageNumberFont 72 Tf");
    expect(s).toContain("59.97 28 Td");
    const small = await addPageNumbers(nPages(1), { fontSize: 1 }, inflate);
    expect((await stamps(small.bytes)).stamps[0]).toContain("/PageNumberFont 4 Tf");
  });

  it("numbers only the selected pages, counting from the first selected one", async () => {
    const r = await addPageNumbers(nPages(4), { ranges: "2-", format: "{n} of {total}" }, inflate);
    expect(r.numberedCount).toBe(3);
    expect([r.firstLabel, r.lastLabel]).toEqual(["1 of 3", "3 of 3"]);
    const s = (await stamps(r.bytes)).stamps;
    expect(s[0]).toBeNull();
    expect(s[1]).toContain(`<${hex("1 of 3")}>`);
  });

  it("advances numbers with the physical page across gaps", async () => {
    const r = await addPageNumbers(nPages(5), { ranges: "1, 3, 5", startNumber: 10 }, inflate);
    expect(r.numberedCount).toBe(3);
    expect([r.firstLabel, r.lastLabel]).toEqual(["10", "14"]);
    const s = (await stamps(r.bytes)).stamps;
    expect(s[1]).toBeNull();
    expect(s[2]).toContain(`<${hex("12")}>`);
  });

  it("warns when characters had to be dropped", async () => {
    const r = await addPageNumbers(nPages(1), { format: "Страница {n}" }, inflate);
    expect(r.ok).toBe(true);
    expect(r.firstLabel).toBe(" 1");
    expect(r.warning).toMatch(/Latin alphabet/);
  });

  it("rejects a format without {n}, empty input, bad ranges and broken files", async () => {
    expect((await addPageNumbers(nPages(1), { format: "Page" }, inflate)).error).toMatch(/\{n\}/);
    expect((await addPageNumbers(new Uint8Array(), {}, inflate)).error).toBe("add a PDF first");
    const bad = await addPageNumbers(nPages(2), { ranges: "5-9" }, inflate);
    expect(bad.error).toBe("no pages in range (this PDF has 2)");
    expect(bad.pageCount).toBe(2);
    expect((await addPageNumbers(latin1("%PDF-1.7 nothing"), {}, inflate)).ok).toBe(false);
  });
});
