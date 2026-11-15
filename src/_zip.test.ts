import { describe, expect, it } from "vitest";
import { buildZip, safeZipPath, zipEntryNames } from "./_zip.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Minimal independent ZIP reader: walks the EOCD -> central directory -> local headers. */
function readZip(zip: Uint8Array) {
  const v = dv(zip);
  const eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  expect(cdOffset + cdSize).toBe(eocd);

  const entries: Array<{ name: string; crc: number; data: Uint8Array; flags: number }> = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    expect(v.getUint32(p + 24, true)).toBe(size); // stored: compressed == uncompressed
    expect(method).toBe(0);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const localOffset = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));

    // Local header must agree with the central record.
    expect(v.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(v.getUint32(localOffset + 14, true)).toBe(crc);
    expect(v.getUint32(localOffset + 18, true)).toBe(size);
    const lNameLen = v.getUint16(localOffset + 26, true);
    expect(lNameLen).toBe(nameLen);
    const dataStart = localOffset + 30 + lNameLen + v.getUint16(localOffset + 28, true);
    entries.push({ name, crc, flags, data: zip.subarray(dataStart, dataStart + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  expect(p).toBe(cdOffset + cdSize);
  return entries;
}

describe("buildZip", () => {
  it("writes an empty archive as a lone end-of-central-directory record", () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it('stores the standard CRC-32 check value for "123456789" (0xCBF43926)', () => {
    const [entry] = readZip(buildZip([{ name: "check.txt", data: enc("123456789") }]));
    expect(entry.crc).toBe(0xcbf43926);
  });

  it("uses CRC 0 for an empty file and known CRCs for short strings", () => {
    const entries = readZip(
      buildZip([
        { name: "empty", data: new Uint8Array() },
        { name: "a", data: enc("a") },
      ]),
    );
    expect(entries[0].crc).toBe(0);
    // CRC-32("a") = 0xE8B7BE43
    expect(entries[1].crc).toBe(0xe8b7be43);
  });

  it("round-trips several entries with consistent offsets and UTF-8 names", () => {
    const files = [
      { name: "page-1.jpg", data: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]) },
      { name: "папка/страница 2.txt", data: enc("Привет") },
      { name: "z.bin", data: Uint8Array.from({ length: 300 }, (_, i) => i & 0xff) },
    ];
    const entries = readZip(buildZip(files));
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    entries.forEach((e, i) => {
      expect(Array.from(e.data)).toEqual(Array.from(files[i].data));
      expect(e.flags & 0x0800).toBe(0x0800); // UTF-8 name flag
    });
  });
});

describe("entry names", () => {
  it("keeps ordinary relative paths as they are", () => {
    for (const name of ["a.txt", "[Content_Types].xml", "_rels/.rels", "docs/v1.2/readme"]) {
      expect(safeZipPath(name)).toBe(name);
    }
  });

  it("makes paths that would escape the extraction folder relative", () => {
    expect(safeZipPath("../evil.txt")).toBe("evil.txt");
    expect(safeZipPath("a/../../b/./c.txt")).toBe("a/b/c.txt");
    expect(safeZipPath("/etc/passwd")).toBe("etc/passwd");
    expect(safeZipPath("C:\\Windows\\x.dll")).toBe("Windows/x.dll");
    expect(safeZipPath("..\\..\\x")).toBe("x");
    expect(safeZipPath("a\u0000b\n.txt")).toBe("ab.txt");
    expect(safeZipPath("../..")).toBe("file");
    expect(safeZipPath("")).toBe("file");
  });

  it("numbers later duplicates before the extension, ignoring case", () => {
    expect(
      zipEntryNames(["a.txt", "a.txt", "A.TXT", "a (2).txt", "dir/.rels", "dir/.rels", "x", "x"]),
    ).toEqual([
      "a.txt",
      "a (2).txt",
      "A (3).TXT",
      "a (2) (2).txt",
      "dir/.rels",
      "dir/.rels (2)",
      "x",
      "x (2)",
    ]);
    expect(zipEntryNames(["v1.2/readme", "v1.2/readme"])).toEqual([
      "v1.2/readme",
      "v1.2/readme (2)",
    ]);
  });

  it("writes the safe, de-duplicated names into the archive", () => {
    const data = enc("x");
    const names = readZip(
      buildZip([
        { name: "../up.txt", data },
        { name: "up.txt", data },
        { name: "page.jpg", data },
      ]),
    ).map((e) => e.name);
    expect(names).toEqual(["up.txt", "up (2).txt", "page.jpg"]);
  });
});
