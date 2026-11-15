import { describe, expect, it } from "vitest";
import {
  FAVICON_SIZES,
  ICO_SIZES,
  OPAQUE_SIZES,
  buildFaviconBundle,
  buildFaviconHtml,
  buildIco,
  buildWebManifest,
  buildZip,
  getInitials,
  pickTextColor,
  shortName,
} from "./favicon-generator.js";

// Canvas rasterisation (drawing text/images at each size and encoding PNGs) lives in
// the browser UI layer and needs a DOM canvas; it is not tested here. These tests cover the pure
// byte/string assembly: initials, contrast, ICO packing, ZIP writer, HTML and manifest.

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const fakePng = (n: number, fill: number) => new Uint8Array(n).fill(fill);

/** Minimal reader for the stored ZIPs produced by buildZip. */
function readZip(zip: Uint8Array) {
  const eocd = zip.length - 22;
  expect(u32(zip, eocd)).toBe(0x06054b50);
  const count = u16(zip, eocd + 10);
  const cdSize = u32(zip, eocd + 12);
  const cdOffset = u32(zip, eocd + 16);
  expect(cdOffset + cdSize).toBe(eocd);
  const files: Array<{ name: string; crc: number; data: Uint8Array }> = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(u32(zip, p)).toBe(0x02014b50);
    const crc = u32(zip, p + 16);
    const size = u32(zip, p + 20);
    const nameLen = u16(zip, p + 28);
    const localOffset = u32(zip, p + 42);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    // local header must agree with the central directory
    expect(u32(zip, localOffset)).toBe(0x04034b50);
    expect(u32(zip, localOffset + 14)).toBe(crc);
    expect(u16(zip, localOffset + 26)).toBe(nameLen);
    const dataAt = localOffset + 30 + nameLen;
    files.push({ name, crc, data: zip.subarray(dataAt, dataAt + size) });
    p += 46 + nameLen;
  }
  return files;
}

describe("getInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(getInitials("My Cool Site")).toBe("MC");
    expect(getInitials("snake_case-name")).toBe("SC");
  });

  it("shows a single short token whole, up to two characters", () => {
    expect(getInitials("42")).toBe("42");
    expect(getInitials("go")).toBe("GO");
    expect(getInitials("x")).toBe("X");
  });

  it("handles Cyrillic", () => {
    expect(getInitials("мой сайт")).toBe("МС");
  });

  it("returns empty for empty/whitespace and falls back for separators only", () => {
    expect(getInitials("")).toBe("");
    expect(getInitials("   ")).toBe("");
    expect(getInitials("...")).toBe("..");
  });

  it("matches its documented example for a domain name", () => {
    expect(getInitials("belun.app")).toBe("BE");
  });

  it("keeps an emoji whole and draws it alone (no broken surrogate, tone or flag)", () => {
    expect(getInitials("🚀 Rocket")).toBe("🚀");
    expect(getInitials("👍🏽")).toBe("👍🏽");
    expect(getInitials("🇧🇾")).toBe("🇧🇾");
    expect(getInitials("👨\u200d👩\u200d👧 family")).toBe("👨\u200d👩\u200d👧");
  });

  it("never cuts a combining accent off its letter", () => {
    const e = `e${String.fromCodePoint(0x301)}`;
    expect(getInitials(`${e}cole Arts`)).toBe(`${e.toUpperCase()}A`);
    expect(getInitials(`${e}t`)).toBe(`${e}t`.toUpperCase());
  });
});

describe("pickTextColor", () => {
  it("uses dark text on bright backgrounds and white on dark ones (BT.601 > 0.6)", () => {
    expect(pickTextColor("#ffffff")).toBe("#111111");
    expect(pickTextColor("#fff")).toBe("#111111");
    expect(pickTextColor("#000000")).toBe("#ffffff");
    // yellow: (0.299*255 + 0.587*255)/255 = 0.886 -> dark text
    expect(pickTextColor("#ffff00")).toBe("#111111");
    // blue: 0.114 -> white text
    expect(pickTextColor("#0000ff")).toBe("#ffffff");
    // pure red: 0.299 -> white text; pure green: 0.587 -> still white (threshold 0.6)
    expect(pickTextColor("#ff0000")).toBe("#ffffff");
    expect(pickTextColor("#00ff00")).toBe("#ffffff");
  });

  it("does not throw on garbage and treats it as black", () => {
    expect(pickTextColor("")).toBe("#ffffff");
    expect(pickTextColor("zzz")).toBe("#ffffff");
  });
});

describe("buildIco", () => {
  it("writes ICONDIR + one 16-byte entry per PNG with sizes, lengths and offsets", () => {
    const a = fakePng(10, 1);
    const b = fakePng(20, 2);
    const ico = buildIco([
      { size: 16, png: a },
      { size: 32, png: b },
    ]);
    // 6 header + 2*16 directory + 30 data
    expect(ico.length).toBe(6 + 32 + 30);
    expect(u16(ico, 0)).toBe(0); // reserved
    expect(u16(ico, 2)).toBe(1); // type icon
    expect(u16(ico, 4)).toBe(2); // count
    // entry 0
    expect(ico[6]).toBe(16);
    expect(ico[7]).toBe(16);
    expect(u16(ico, 10)).toBe(1); // planes
    expect(u16(ico, 12)).toBe(32); // bpp
    expect(u32(ico, 14)).toBe(10);
    expect(u32(ico, 18)).toBe(38);
    // entry 1
    expect(ico[22]).toBe(32);
    expect(u32(ico, 30)).toBe(20);
    expect(u32(ico, 34)).toBe(48);
    expect(ico[38]).toBe(1);
    expect(ico[48]).toBe(2);
    expect(ico[67]).toBe(2);
  });

  it("encodes 256px (and larger) as 0 in the width/height byte", () => {
    const ico = buildIco([{ size: 256, png: fakePng(4, 9) }]);
    expect(ico[6]).toBe(0);
    expect(ico[7]).toBe(0);
  });

  it("skips empty PNGs and yields a bare header for no images", () => {
    const ico = buildIco([{ size: 16, png: new Uint8Array(0) }]);
    expect(ico.length).toBe(6);
    expect(u16(ico, 4)).toBe(0);
    expect(buildIco([]).length).toBe(6);
  });
});

describe("buildZip", () => {
  it("produces a valid stored ZIP with correct CRC-32 (known vector)", () => {
    // CRC-32("123456789") = 0xCBF43926 (standard check value)
    const data = new TextEncoder().encode("123456789");
    const files = readZip(buildZip([{ name: "check.txt", data }]));
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("check.txt");
    expect(files[0].crc).toBe(0xcbf43926);
    expect(new TextDecoder().decode(files[0].data)).toBe("123456789");
  });

  it("keeps several entries and UTF-8 names in order", () => {
    const files = readZip(
      buildZip([
        { name: "a.txt", data: new Uint8Array([1]) },
        { name: "папка/б.txt", data: new Uint8Array(0) },
      ]),
    );
    expect(files.map((f) => f.name)).toEqual(["a.txt", "папка/б.txt"]);
    // CRC of an empty file is 0
    expect(files[1].crc).toBe(0);
  });

  it("writes only the end record for an empty archive", () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toHaveLength(0);
  });
});

describe("buildFaviconHtml / buildWebManifest", () => {
  it("links every file the bundle ships", () => {
    const html = buildFaviconHtml();
    // Regression: sizes="any" on the .ico made Chrome prefer it over an SVG icon.
    expect(html).toContain('href="/favicon.ico" sizes="32x32"');
    expect(html).not.toContain('sizes="any"');
    expect(html).toContain('sizes="180x180" href="/apple-touch-icon.png"');
    expect(html).toContain('href="/site.webmanifest"');
    for (const href of html.match(/href="\/([^"]+)"/g) ?? []) {
      const file = href.slice(7, -1);
      const shipped =
        file === "favicon.ico" ||
        file === "site.webmanifest" ||
        FAVICON_SIZES.some((s) => s.filename === file);
      expect(shipped, file).toBe(true);
    }
  });

  it("builds a manifest with the 192/512 Android icons", () => {
    const m = JSON.parse(buildWebManifest("Shop"));
    expect(m.name).toBe("Shop");
    expect(m.short_name).toBe("Shop");
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["192x192", "512x512"]);
    expect(m.display).toBe("standalone");
  });

  // Regression: short_name became the favicon initials ("belun.app tools" -> "BA").
  it("shortens names longer than 12 chars at a word boundary and defaults empty to My Site", () => {
    expect(JSON.parse(buildWebManifest("My Wonderful Website")).short_name).toBe("My Wonderful");
    expect(JSON.parse(buildWebManifest("belun.app tools")).short_name).toBe("belun.app");
    expect(JSON.parse(buildWebManifest("Shop")).short_name).toBe("Shop");
    expect(shortName("Supercalifragilistic")).toBe("Supercalifra");
    expect(shortName("Интернет-магазин обуви")).toBe("Интернет-маг");
    expect(JSON.parse(buildWebManifest("   ")).name).toBe("My Site");
  });

  // Regression: one 512 icon was declared "any maskable" with transparent rounded corners.
  it("declares separate any and maskable icons and uses the chosen colour", () => {
    const m = JSON.parse(buildWebManifest("Shop", "#2563eb"));
    expect(m.icons.map((i: { purpose: string }) => i.purpose)).toEqual(["any", "maskable"]);
    expect(
      m.icons.some((i: { purpose: string }) => /any/.test(i.purpose) && /maskable/.test(i.purpose)),
    ).toBe(false);
    expect(m.theme_color).toBe("#2563eb");
    expect(m.background_color).toBe("#2563eb");
    expect(OPAQUE_SIZES).toEqual([180, 512]);
  });

  it("escapes quotes in the site name (valid JSON)", () => {
    expect(JSON.parse(buildWebManifest('Bob "the" Site')).name).toBe('Bob "the" Site');
  });
});

describe("constants and bundle", () => {
  it("lists the expected sizes and ICO sizes", () => {
    expect(FAVICON_SIZES.map((s) => s.size)).toEqual([
      16, 32, 48, 64, 96, 120, 128, 180, 192, 256, 512,
    ]);
    expect(ICO_SIZES).toEqual([16, 32, 48]);
    expect(FAVICON_SIZES.find((s) => s.size === 180)?.filename).toBe("apple-touch-icon.png");
  });

  it("assembles ico + PNGs + manifest + snippet into the zip, skipping missing sizes", () => {
    const pngs = new Map<number, Uint8Array>([
      [16, fakePng(3, 16)],
      [32, fakePng(3, 32)],
      [192, fakePng(3, 192)],
    ]);
    const bundle = buildFaviconBundle(pngs, "Test");
    expect(bundle.files).toEqual([
      "favicon.ico",
      "favicon-16x16.png",
      "favicon-32x32.png",
      "android-chrome-192x192.png",
      "site.webmanifest",
      "favicon-html-snippet.txt",
    ]);
    // ICO holds only the 16 and 32 images (48 missing)
    expect(u16(bundle.ico, 4)).toBe(2);
    const files = readZip(bundle.zip);
    expect(files.map((f) => f.name)).toEqual(bundle.files);
    expect(Array.from(files[0].data)).toEqual(Array.from(bundle.ico));
    expect(new TextDecoder().decode(files[5].data)).toBe(bundle.html);
  });
});
