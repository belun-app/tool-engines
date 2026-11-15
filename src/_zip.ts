/**
 * ZIP writer (stored / uncompressed). It sits at the root of the package because both
 * the PDF core and the image tools bundle many output files into one download, and
 * neither should have to pull in the other's parser just to get a valid archive.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * A relative, forward-slash path that cannot escape the folder it is extracted into:
 * backslashes become "/", a drive letter ("C:") and leading slashes are dropped, "." and ".."
 * segments and empty segments are removed, and control characters are stripped. A name with
 * nothing left becomes "file".
 */
export function safeZipPath(name: string): string {
  const segments = String(name)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this strips
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:/, "")
    .split("/")
    .filter((s) => s !== "" && s !== "." && s !== "..");
  return segments.length ? segments.join("/") : "file";
}

/**
 * Entry names as they will be written: each made safe with {@link safeZipPath}, then a later
 * entry whose path equals an earlier one (ignoring case, as Windows and macOS do on extract)
 * gets " (2)", " (3)", … before its extension, so no file overwrites another.
 */
export function zipEntryNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((raw) => {
    const path = safeZipPath(raw);
    let candidate = path;
    if (taken.has(candidate.toLowerCase())) {
      const slash = path.lastIndexOf("/");
      const dot = path.lastIndexOf(".");
      // "a.txt" -> "a" + ".txt"; ".rels" and "dir.v2/readme" have no extension to keep.
      const cut = dot > slash + 1 ? dot : path.length;
      for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
        candidate = `${path.slice(0, cut)} (${n})${path.slice(cut)}`;
      }
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Packs entries into a valid ZIP with no compression (stored). Names are written through
 * {@link zipEntryNames}: unsafe paths ("../x", "/etc/x", "C:\\x") are made relative and
 * duplicates are numbered, so extracting the archive never writes outside its folder or
 * replaces one entry with another.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) =>
    Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  const names = zipEntryNames(entries.map((e) => e.name));
  for (const [index, entry] of entries.entries()) {
    const nameBytes = utf8(names[index]);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local: Uint8Array[] = [
      u32(0x04034b50),
      u16(20), // version needed
      u16(0x0800), // UTF-8 filename flag
      u16(0), // method: stored
      u16(0), // mod time
      u16(0x21), // mod date (1980-01-01)
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      entry.data,
    ];
    for (const part of local) chunks.push(part);

    central.push(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0x21),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    );

    offset += 30 + nameBytes.length + size;
  }

  let centralSize = 0;
  for (const part of central) centralSize += part.length;
  const centralOffset = offset;

  const end: Uint8Array[] = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0),
  ];

  const all = [...chunks, ...central, ...end];
  let total = 0;
  for (const part of all) total += part.length;
  const result = new Uint8Array(total);
  let at = 0;
  for (const part of all) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
