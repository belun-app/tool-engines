import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./_pdf-lib.js";
import {
  describeOrder,
  formatOrder,
  identityOrder,
  interleaveHalvesOrder,
  isIdentityOrder,
  movePage,
  parseOrder,
  readPdfInfo,
  reorderPdfPages,
  reverseOrder,
  rotateOrder,
  swapPages,
} from "./reorder-pdf-pages.js";

const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d));
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

function nPages(n: number) {
  const bodies: string[] = [];
  const kids: string[] = [];
  for (let i = 0; i < n; i++) {
    const pageNum = 3 + i * 2;
    kids.push(`${pageNum} 0 R`);
    bodies[pageNum] = `<< /Type /Page /Parent 2 0 R /Contents ${pageNum + 1} 0 R >>`;
    const s = `BT (p${i + 1}) Tj ET`;
    bodies[pageNum + 1] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  }
  bodies[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  bodies[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${n} >>`;
  let out = "%PDF-1.4\n";
  for (let k = 1; k < bodies.length; k++) out += `${k} 0 obj\n${bodies[k]}\nendobj\n`;
  out += "trailer\n<< /Root 1 0 R >>\n%%EOF\n";
  return latin1(out);
}

async function texts(bytes: Uint8Array) {
  const { doc, error } = await parseDocument(bytes, inflate);
  if (!doc) throw new Error(error);
  return doc.pages.map((p) => {
    const c = p.dict.v.get("Contents");
    const s = c?.k === "ref" ? doc.objects.get(c.n) : undefined;
    return /\((.*)\)/.exec(s?.k === "stream" ? Buffer.from(s.raw).toString("latin1") : "")?.[1];
  });
}

describe("order presets", () => {
  it("identity and reverse", () => {
    expect(identityOrder(4)).toEqual([1, 2, 3, 4]);
    expect(identityOrder(3.7)).toEqual([1, 2, 3]);
    expect(identityOrder(0)).toEqual([]);
    expect(identityOrder(-1)).toEqual([]);
    expect(identityOrder(Number.NaN)).toEqual([]);
    expect(reverseOrder(4)).toEqual([4, 3, 2, 1]);
    expect(reverseOrder(0)).toEqual([]);
  });

  it("interleaves fronts and backs (docstring examples)", () => {
    expect(interleaveHalvesOrder(6)).toEqual([1, 4, 2, 5, 3, 6]);
    expect(interleaveHalvesOrder(6, true)).toEqual([1, 6, 2, 5, 3, 4]);
    // Odd count: fronts 1-3, backs 4-5, the extra front stays last.
    expect(interleaveHalvesOrder(5)).toEqual([1, 4, 2, 5, 3]);
    expect(interleaveHalvesOrder(1)).toEqual([1]);
    expect(interleaveHalvesOrder(0)).toEqual([]);
  });

  it("rotates so a chosen page comes first", () => {
    expect(rotateOrder(5, 3)).toEqual([3, 4, 5, 1, 2]);
    expect(rotateOrder(5, 5)).toEqual([5, 1, 2, 3, 4]);
    for (const start of [1, 0, 6, -2, Number.NaN]) {
      expect(rotateOrder(5, start)).toEqual([1, 2, 3, 4, 5]);
    }
    expect(rotateOrder(0, 2)).toEqual([]);
  });
});

describe("movePage / swapPages", () => {
  it("moves an entry and shifts the rest", () => {
    expect(movePage([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(movePage([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(movePage([1, 2, 3, 4], 1, 99)).toEqual([1, 3, 4, 2]);
    expect(movePage([1, 2, 3, 4], 2, -5)).toEqual([3, 1, 2, 4]);
  });

  it("returns an unchanged copy for no-op or invalid moves", () => {
    const order = [1, 2, 3];
    const same = movePage(order, 1, 1);
    expect(same).toEqual(order);
    expect(same).not.toBe(order);
    expect(movePage(order, 5, 0)).toEqual(order);
    expect(movePage(order, -1, 0)).toEqual(order);
  });

  it("swaps two positions, ignoring out-of-range ones", () => {
    expect(swapPages([1, 2, 3], 0, 2)).toEqual([3, 2, 1]);
    expect(swapPages([1, 2, 3], 0, 3)).toEqual([1, 2, 3]);
    expect(swapPages([1, 2, 3], -1, 0)).toEqual([1, 2, 3]);
  });
});

describe("formatOrder", () => {
  it("collapses ascending and descending runs (docstring example)", () => {
    expect(formatOrder([1, 2, 3, 9, 8, 7])).toBe("1-3, 9-7");
    expect(formatOrder([1, 3, 5])).toBe("1, 3, 5");
    expect(formatOrder([2, 1])).toBe("2-1");
    expect(formatOrder([1, 2, 1])).toBe("1-2, 1");
    expect(formatOrder([5])).toBe("5");
    expect(formatOrder([])).toBe("");
    expect(formatOrder([0, Number.NaN])).toBe("");
  });

  it("round-trips through parseOrder", () => {
    for (const order of [
      [3, 1, 2],
      [1, 2, 3, 9, 8, 7, 4, 5, 6],
      [2, 2, 1],
    ]) {
      expect(parseOrder(formatOrder(order), 9).order).toEqual(order);
    }
  });
});

describe("parseOrder", () => {
  it("reads lists and ranges in the order written", () => {
    expect(parseOrder("3, 1, 2", 3)).toEqual({
      ok: true,
      order: [3, 1, 2],
      omitted: [],
      duplicated: [],
    });
    expect(parseOrder("4-6, 1-3", 6).order).toEqual([4, 5, 6, 1, 2, 3]);
    expect(parseOrder("12-1", 12).order).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(parseOrder("2–1", 2).order).toEqual([2, 1]); // en dash
  });

  it("accepts spaces around the hyphen", () => {
    expect(parseOrder("4 - 6, 1 – 3", 6).order).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it("reports omitted and duplicated pages", () => {
    expect(parseOrder("1, 1, 3", 4)).toEqual({
      ok: true,
      order: [1, 1, 3],
      omitted: [2, 4],
      duplicated: [1],
    });
  });

  it("rejects pages outside the document and junk", () => {
    expect(parseOrder("0", 3).error).toBe("page 0 doesn't exist — this PDF has 3");
    expect(parseOrder("1-9", 3).error).toBe("page 9 doesn't exist — this PDF has 3");
    expect(parseOrder("2, x", 3).error).toBe('"x" is not a page number or range');
    expect(parseOrder("3-", 3).ok).toBe(false);
    expect(parseOrder("   ", 3).error).toBe("enter a page order, e.g. 3, 1, 2");
    expect(parseOrder(",,", 3).error).toBe("enter a page order, e.g. 3, 1, 2");
    expect(parseOrder("1", 0).error).toBe("the PDF has no pages");
  });
});

describe("describeOrder / isIdentityOrder", () => {
  it("describes an order list", () => {
    expect(describeOrder([2, 2, 5, 5, 5], 5)).toEqual({
      order: [2, 2, 5, 5, 5],
      omitted: [1, 3, 4],
      duplicated: [2, 5],
    });
  });

  it("recognises the untouched order only", () => {
    expect(isIdentityOrder([1, 2, 3], 3)).toBe(true);
    expect(isIdentityOrder([1, 2], 3)).toBe(false);
    expect(isIdentityOrder([1, 3, 2], 3)).toBe(false);
    expect(isIdentityOrder([], 0)).toBe(true);
  });
});

describe("reorderPdfPages", () => {
  it("writes the pages in the requested order", async () => {
    const r = await reorderPdfPages(nPages(3), { order: [3, 1, 2], baseName: "deck.PDF" }, inflate);
    expect(r.ok).toBe(true);
    expect(r.name).toBe("deck-reordered.pdf");
    expect(r.originalPages).toBe(3);
    expect(r.outputPages).toBe(3);
    expect(r.unchanged).toBe(false);
    expect(r.sizeBytes).toBe(r.bytes.length);
    expect(await texts(r.bytes)).toEqual(["p3", "p1", "p2"]);
  });

  it("keeps a Cyrillic base name readable", async () => {
    const r = await reorderPdfPages(nPages(2), { order: [2, 1], baseName: "Отчёт.pdf" }, inflate);
    expect(r.name).toBe("Отчёт-reordered.pdf");
  });

  it("copies a repeated page and drops omitted ones", async () => {
    const r = await reorderPdfPages(nPages(3), { order: [2, 2] }, inflate);
    expect(r.outputPages).toBe(2);
    expect(await texts(r.bytes)).toEqual(["p2", "p2"]);
  });

  it("flags the identity order as unchanged", async () => {
    const r = await reorderPdfPages(nPages(2), { order: [1, 2] }, inflate);
    expect(r.unchanged).toBe(true);
  });

  it("filters out non-integer and out-of-range entries", async () => {
    const r = await reorderPdfPages(nPages(3), { order: [0, 2, 1.5, 9, -1, 1] }, inflate);
    expect(await texts(r.bytes)).toEqual(["p2", "p1"]);
    const none = await reorderPdfPages(nPages(3), { order: [0, 7] }, inflate);
    expect(none.ok).toBe(false);
    expect(none.error).toBe("no pages left in the order");
    expect(none.originalPages).toBe(3);
  });

  it("returns errors for empty and unreadable input", async () => {
    expect((await reorderPdfPages(new Uint8Array(), { order: [1] }, inflate)).error).toBe(
      "add a PDF first",
    );
    expect((await reorderPdfPages(latin1("<html>"), { order: [1] }, inflate)).ok).toBe(false);
    expect((await readPdfInfo(nPages(4), inflate)).pageCount).toBe(4);
  });
});
