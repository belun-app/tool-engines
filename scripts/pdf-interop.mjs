#!/usr/bin/env node
// PDF interoperability check of the built package: pdf-lib (a dev dependency) writes fixture
// PDFs in three layouts — classic xref table, xref + object streams, and an incremental update
// appended to an existing file — then the page tools merge, split, rotate, delete, reorder and
// number them. Every output is re-opened with pdf-lib here and written to a folder for an
// external validator (CI runs `qpdf --check` on each file).
//
//   npm run build && node scripts/pdf-interop.mjs [out-dir]     (default: ./interop-out)
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import pdfLib from "pdf-lib";

const { PDFDocument, PDFName, StandardFonts, degrees } = pdfLib;
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const load = (subpath) => import(`${pkg.name}/${subpath}`);

const { mergePdfs } = await load("file/pdf-merger");
const { splitPdf } = await load("pdf/pdf-splitter");
const { rotatePdf } = await load("pdf/pdf-page-rotator");
const { deletePdfPages } = await load("pdf/delete-pages-from-pdf");
const { reorderPdfPages } = await load("pdf/reorder-pdf-pages");
const { addPageNumbers } = await load("pdf/add-page-numbers-to-pdf");

const inflate = async (data) => new Uint8Array(inflateSync(data));
const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");

async function baseDoc() {
  const doc = await PDFDocument.create();
  doc.setProducer("fixture");
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const sizes = [
    [595, 842],
    [612, 792],
    [300, 400],
  ];
  sizes.forEach(([w, h], i) => {
    const page = doc.addPage([w, h]);
    page.drawText(`Page ${i + 1}`, {
      x: 40,
      y: h - 60,
      size: 18,
      font: i === 2 ? times : helvetica,
    });
    if (i === 1) page.setRotation(degrees(90));
  });
  return doc;
}

/** Appends a second revision: page 1 replaced, a fourth page added, xref with /Prev. */
async function incrementalUpdate(original) {
  const doc = await PDFDocument.load(original);
  const text = latin1(original);
  const prevXref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1]);
  const pagesRef = doc.catalog.get(PDFName.of("Pages"));
  const pageRefs = doc.getPages().map((p) => p.ref);
  const rootRef = doc.context.trailerInfo.Root;
  let next = doc.context.largestObjectNumber + 1;
  const font = next++;
  const content1 = next++;
  const content4 = next++;
  const page4 = next++;
  const ref = (n) => `${n} 0 R`;
  const stream = (s) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  const pageDict = (contents, box) =>
    `<< /Type /Page /Parent ${pagesRef} /MediaBox ${box} /Contents ${ref(contents)} /Resources << /Font << /F9 ${ref(font)} >> >> >>`;
  const objects = [
    [font, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"],
    [content1, stream("BT /F9 12 Tf 20 20 Td (Revised page 1) Tj ET")],
    [content4, stream("BT /F9 12 Tf 20 20 Td (Added page 4) Tj ET")],
    [pageRefs[0].objectNumber, pageDict(content1, "[0 0 200 200]")],
    [page4, pageDict(content4, "[0 0 250 150]")],
    [
      pagesRef.objectNumber,
      `<< /Type /Pages /Kids [${[...pageRefs.map(String), ref(page4)].join(" ")}] /Count 4 >>`,
    ],
  ];
  let out = text.endsWith("\n") ? text : `${text}\n`;
  const offsets = new Map();
  for (const [num, body] of objects) {
    offsets.set(num, out.length);
    out += `${num} 0 obj\n${body}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += "xref\n0 1\n0000000000 65535 f \n";
  for (const num of [...offsets.keys()].sort((a, b) => a - b)) {
    out += `${num} 1\n${String(offsets.get(num)).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${next} /Root ${rootRef} /Prev ${prevXref} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(out, "latin1"));
}

const pageCount = async (bytes) =>
  (
    await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false })
  ).getPageCount();

function ok(result, what) {
  assert.ok(result.ok, `${what}: ${result.error}`);
  return result;
}

const outDir = resolve(process.argv[2] ?? "interop-out");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const written = [];
async function save(name, bytes, expectedPages) {
  assert.equal(await pageCount(bytes), expectedPages, `${name}: page count`);
  writeFileSync(join(outDir, name), bytes);
  written.push(name);
}

const classic = await (await baseDoc()).save({ useObjectStreams: false });
const fixtures = {
  classic,
  "object-streams": await (await baseDoc()).save({ useObjectStreams: true }),
  incremental: await incrementalUpdate(classic),
};

for (const [kind, data] of Object.entries(fixtures)) {
  const n = await pageCount(data);
  await save(`${kind}-source.pdf`, data, n);
  const merged = ok(
    await mergePdfs(
      [
        { name: "a.pdf", data },
        { name: "b.pdf", data },
      ],
      inflate,
    ),
    `${kind} merge`,
  );
  await save(`${kind}-merged.pdf`, merged.bytes, 2 * n);
  const split = ok(
    await splitPdf(data, { mode: "each", baseName: kind }, inflate),
    `${kind} split`,
  );
  for (const [i, file] of split.files.entries())
    await save(`${kind}-split-${i + 1}.pdf`, file.bytes, 1);
  const rotated = ok(
    await rotatePdf(data, { angle: 90, ranges: "1-2" }, inflate),
    `${kind} rotate`,
  );
  await save(`${kind}-rotated.pdf`, rotated.bytes, n);
  const deleted = ok(await deletePdfPages(data, { pages: "2" }, inflate), `${kind} delete`);
  await save(`${kind}-deleted.pdf`, deleted.bytes, n - 1);
  const order = Array.from({ length: n }, (_, i) => n - i);
  const reordered = ok(await reorderPdfPages(data, { order }, inflate), `${kind} reorder`);
  await save(`${kind}-reordered.pdf`, reordered.bytes, n);
  const numbered = ok(await addPageNumbers(data, {}, inflate), `${kind} page numbers`);
  await save(`${kind}-numbered.pdf`, numbered.bytes, n);
}

console.log(`pdf-interop: ${written.length} files in ${outDir}`);
for (const name of written) console.log(name);
