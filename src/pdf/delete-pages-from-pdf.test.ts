import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./_pdf-lib.js";
import {
  deletePdfPages,
  formatPageList,
  planDeletion,
  presetPages,
  readPdfInfo,
} from "./delete-pages-from-pdf.js";

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

describe("presetPages", () => {
  it("expands all / none / odd / even", () => {
    expect(presetPages("all", 4)).toEqual([1, 2, 3, 4]);
    expect(presetPages("none", 4)).toEqual([]);
    expect(presetPages("odd", 5)).toEqual([1, 3, 5]);
    expect(presetPages("even", 5)).toEqual([2, 4]);
  });

  it("returns nothing for an empty or invalid page count", () => {
    expect(presetPages("all", 0)).toEqual([]);
    expect(presetPages("all", -2)).toEqual([]);
    expect(presetPages("all", Number.NaN)).toEqual([]);
    expect(presetPages("even", 1)).toEqual([]);
  });
});

describe("formatPageList", () => {
  it("compacts runs into ranges", () => {
    expect(formatPageList([1, 2, 3, 7, 9, 10])).toBe("1-3, 7, 9-10");
    expect(formatPageList([5])).toBe("5");
    expect(formatPageList([2, 4, 6])).toBe("2, 4, 6");
  });

  it("tolerates duplicates, disorder and junk", () => {
    expect(formatPageList([3, 1, 2, 2])).toBe("1-3");
    expect(formatPageList([0, -1, Number.NaN, 4])).toBe("4");
    expect(formatPageList([])).toBe("");
  });

  it("round-trips through planDeletion", () => {
    const pages = [1, 2, 3, 7, 9, 10];
    expect(planDeletion(formatPageList(pages), 12).deleted).toEqual(pages);
  });
});

describe("planDeletion", () => {
  it("splits pages into deleted and kept", () => {
    expect(planDeletion("2, 5-7", 8)).toEqual({
      ok: true,
      deleted: [2, 5, 6, 7],
      kept: [1, 3, 4, 8],
    });
    expect(planDeletion("10-", 12)).toEqual({
      ok: true,
      deleted: [10, 11, 12],
      kept: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    });
  });

  it("refuses to delete every page", () => {
    const r = planDeletion("1-3", 3);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/removes every page/);
    expect(r.deleted).toEqual([1, 2, 3]);
    expect(r.kept).toEqual([]);
  });

  it("reports empty, invalid and out-of-range specs", () => {
    expect(planDeletion("  ", 5).error).toBe("enter which pages to remove");
    expect(planDeletion("two", 5).error).toBe('"two" is not a page number or range');
    expect(planDeletion("9", 5).error).toBe("no pages in range (this PDF has 5)");
    expect(planDeletion("1", 0).error).toBe("the PDF has no pages");
    expect(planDeletion("1", Number.NaN).error).toBe("the PDF has no pages");
  });

  it("accepts spaces around the hyphen", () => {
    expect(planDeletion("2 - 3", 5)).toEqual({ ok: true, deleted: [2, 3], kept: [1, 4, 5] });
  });
});

describe("readPdfInfo", () => {
  it("counts pages and rejects empty input", async () => {
    expect(await readPdfInfo(nPages(3), inflate)).toEqual({ ok: true, pageCount: 3 });
    expect((await readPdfInfo(new Uint8Array(), inflate)).error).toBe("empty file");
  });
});

describe("deletePdfPages", () => {
  it("removes the requested pages and keeps the rest in order", async () => {
    const r = await deletePdfPages(nPages(6), { pages: "1, 4-5", baseName: "scan.pdf" }, inflate);
    expect(r.ok).toBe(true);
    expect(r.name).toBe("scan-pages-removed.pdf");
    expect(r.originalPages).toBe(6);
    expect(r.deletedCount).toBe(3);
    expect(r.keptCount).toBe(3);
    expect(r.sizeBytes).toBe(r.bytes.length);
    expect(await texts(r.bytes)).toEqual(["p2", "p3", "p6"]);
  });

  it("keeps a Cyrillic base name readable", async () => {
    const r = await deletePdfPages(nPages(3), { pages: "2", baseName: "Скан.pdf" }, inflate);
    expect(r.name).toBe("Скан-pages-removed.pdf");
  });

  it("uses 'document' when there is no usable base name", async () => {
    const r = await deletePdfPages(nPages(2), { pages: "2" }, inflate);
    expect(r.name).toBe("document-pages-removed.pdf");
  });

  it("returns plan errors with the original page count", async () => {
    const r = await deletePdfPages(nPages(2), { pages: "1-2" }, inflate);
    expect(r.ok).toBe(false);
    expect(r.originalPages).toBe(2);
    expect(r.bytes).toHaveLength(0);
    expect(r.error).toMatch(/every page/);
  });

  it("returns an error for empty and unreadable files", async () => {
    expect((await deletePdfPages(new Uint8Array(), { pages: "1" }, inflate)).error).toBe(
      "add a PDF first",
    );
    expect((await deletePdfPages(latin1("nope"), { pages: "1" }, inflate)).error).toBe(
      "not a PDF file",
    );
  });
});
