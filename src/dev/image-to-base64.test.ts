import { describe, expect, it } from "vitest";
import {
  base64Bytes,
  buildOutputs,
  encodedLength,
  formatBytes,
  parseDataUri,
  sizeIncreasePercent,
} from "./image-to-base64.js";

// Reading the File via FileReader happens in the browser UI layer (DOM); these tests cover the pure helpers.

describe("parseDataUri", () => {
  it("splits MIME type and payload", () => {
    expect(parseDataUri("data:image/png;base64,iVBORw0KGgo=")).toEqual({
      mime: "image/png",
      base64: "iVBORw0KGgo=",
    });
  });

  it("accepts a charset parameter and surrounding whitespace", () => {
    expect(parseDataUri("  data:image/svg+xml;charset=utf-8;base64,PHN2Zz4=\n")).toEqual({
      mime: "image/svg+xml",
      base64: "PHN2Zz4=",
    });
  });

  it("defaults a missing MIME type to application/octet-stream", () => {
    expect(parseDataUri("data:;base64,AAAA")?.mime).toBe("application/octet-stream");
  });

  it("returns null for non-base64 or malformed URIs", () => {
    expect(parseDataUri("")).toBeNull();
    expect(parseDataUri("data:text/plain,hello")).toBeNull();
    expect(parseDataUri("https://example.com/a.png")).toBeNull();
  });
});

describe("base64Bytes / encodedLength / sizeIncreasePercent", () => {
  it("computes decoded size accounting for padding", () => {
    // "Zg==" -> "f" (1 byte), "Zm8=" -> 2, "Zm9v" -> 3, "Zm9vYmFy" -> 6
    expect(base64Bytes("Zg==")).toBe(1);
    expect(base64Bytes("Zm8=")).toBe(2);
    expect(base64Bytes("Zm9v")).toBe(3);
    expect(base64Bytes("Zm9vYmFy")).toBe(6);
    // unpadded and line-wrapped payloads
    expect(base64Bytes("Zm8")).toBe(2);
    expect(base64Bytes("Zm9v\nYmFy")).toBe(6);
    expect(base64Bytes("")).toBe(0);
  });

  it("computes encoded length as ceil(n/3)*4", () => {
    expect(encodedLength(0)).toBe(0);
    expect(encodedLength(-1)).toBe(0);
    expect(encodedLength(1)).toBe(4);
    expect(encodedLength(3)).toBe(4);
    expect(encodedLength(4)).toBe(8);
    expect(encodedLength(1024)).toBe(1368);
  });

  it("reports the ~33% growth", () => {
    // 3 bytes -> 4 chars = +33%
    expect(sizeIncreasePercent(3, 4)).toBe(33);
    expect(sizeIncreasePercent(1024, encodedLength(1024))).toBe(34);
    expect(sizeIncreasePercent(0, 10)).toBe(0);
  });
});

describe("formatBytes", () => {
  it("formats B, KB and MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });
});

describe("buildOutputs", () => {
  const uri = "data:image/png;base64,AAAA";

  it("builds CSS, HTML and Markdown snippets", () => {
    expect(buildOutputs(uri, "Logo")).toEqual({
      dataUri: uri,
      css: `background-image: url("${uri}");`,
      html: `<img src="${uri}" alt="Logo" />`,
      markdown: `![Logo](${uri})`,
    });
  });

  it("falls back to the filename without extension, then to 'image'", () => {
    expect(buildOutputs(uri, "", "photo.final.jpg").html).toContain('alt="photo.final"');
    expect(buildOutputs(uri, "  ", "").html).toContain('alt="image"');
    expect(buildOutputs(uri).markdown).toBe(`![image](${uri})`);
  });

  it("escapes HTML attribute breakers and strips Markdown brackets", () => {
    const r = buildOutputs(uri, 'a "b" <c> & [d]');
    expect(r.html).toContain('alt="a &quot;b&quot; &lt;c&gt; &amp; [d]"');
    expect(r.markdown).toBe(`![a "b" <c> & d](${uri})`);
  });

  it("escapes the data URI for each snippet's syntax", () => {
    const uri = 'data:image/svg+xml,<svg a="1">\\x</svg> (x)\n';
    const r = buildOutputs(uri, "x");
    expect(r.dataUri).toBe(uri);
    expect(r.html).toBe(
      '<img src="data:image/svg+xml,&lt;svg a=&quot;1&quot;&gt;\\x&lt;/svg&gt; (x)\n" alt="x" />',
    );
    expect(r.css).toBe(
      'background-image: url("data:image/svg+xml,<svg a=\\"1\\">\\\\x</svg> (x)\\a ");',
    );
    expect(r.markdown).toBe('![x](data:image/svg+xml,%3Csvg%20a="1"%3E\\x%3C/svg%3E%20%28x%29%0A)');
  });
});
