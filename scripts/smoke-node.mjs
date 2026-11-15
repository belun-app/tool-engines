#!/usr/bin/env node
// Smoke test of the built package in plain Node (20+), through its own exports map:
// every universal subpath must import, the root entry must list them, and the README
// examples must give the documented results. Run `npm run build` first.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const pkg = readJson("../package.json");
// Subpaths that call browser-only APIs (written by the export from what each module calls).
const browserOnly = new Set(readJson("./browser-only.json"));

let imported = 0;
for (const key of Object.keys(pkg.exports)) {
  if (key === "." || key === "./package.json" || browserOnly.has(key)) continue;
  const mod = await import(`${pkg.name}/${key.slice(2)}`);
  assert.ok(Object.keys(mod).length > 0, `${key} has no exports`);
  imported++;
}

const { arabicToRoman, romanToArabic } = await import(
  `${pkg.name}/convert/roman-numeral-converter`
);
assert.equal(arabicToRoman(2024).roman, "MMXXIV");
assert.equal(romanToArabic("mcmxcix").arabic, 1999);
assert.deepEqual(romanToArabic("IIII").suggestion, { roman: "IV", arabic: 4 });

const { numberToWords } = await import(`${pkg.name}/convert/number-to-words-converter`);
const words = numberToWords("1234.56", { currency: "usd" });
assert.equal(words.words, "one thousand two hundred thirty-four point five six");
assert.equal(
  words.currencyWords,
  "one thousand two hundred thirty-four dollars and fifty-six cents",
);
assert.equal(words.cheque, "one thousand two hundred thirty-four dollars and 56/100");
assert.equal(numberToWords("21", { lang: "ru" }).words, "двадцать один");

const { convertUnits } = await import(`${pkg.name}/convert/unit-converter`);
assert.equal(convertUnits("length", "mi", 1).find((r) => r.unitId === "km").amount, 1.609344);
assert.equal(convertUnits("temperature", "c", 100).find((r) => r.unitId === "f").amount, 212);

const { buildZip } = await import(`${pkg.name}/zip`);
const enc = new TextEncoder();
const zip = buildZip([
  { name: "hello.txt", data: enc.encode("Hello") },
  { name: "docs/readme.md", data: enc.encode("# Readme") },
]);
assert.equal(String.fromCharCode(...zip.subarray(0, 4)), "PK\x03\x04");

// Two hand-written one-page PDFs, merged into one two-page PDF.
function onePagePdf(text) {
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(out);
}
const { mergePdfs, readPdfInfo } = await import(`${pkg.name}/file/pdf-merger`);
const inflate = async (data) => new Uint8Array(inflateSync(data));
const merged = await mergePdfs(
  [
    { name: "a.pdf", data: onePagePdf("A") },
    { name: "b.pdf", data: onePagePdf("B") },
  ],
  inflate,
);
assert.ok(merged.ok, merged.error);
assert.equal(merged.pageCount, 2);
assert.equal((await readPdfInfo(merged.bytes, inflate)).pageCount, 2);

const index = await import(pkg.name);
assert.equal(index.version, pkg.version);
assert.deepEqual(
  [...index.modules].sort(),
  Object.keys(pkg.exports)
    .filter((k) => k !== "." && k !== "./package.json")
    .map((k) => k.slice(2))
    .sort(),
);

const { generateUuids } = await import(`${pkg.name}/dev/uuid-generator`);
assert.match(generateUuids(1, false).uuids[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);

console.log(
  `smoke: ${imported} subpaths imported, README examples OK (Node ${process.versions.node})`,
);
