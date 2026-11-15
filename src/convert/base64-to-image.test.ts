import { describe, expect, it } from "vitest";
import {
  base64Bytes,
  decodeBase64,
  decodeBase64Image,
  detectImageMime,
  extensionForMime,
  formatBytes,
  stripDataUriPrefix,
  suggestFilename,
} from "./base64-to-image.js";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const b64 = (bytes: number[] | string) =>
  Buffer.from(typeof bytes === "string" ? bytes : Uint8Array.from(bytes)).toString("base64");

describe("decodeBase64", () => {
  it("matches Node's Buffer decoder on standard Base64", () => {
    const bytes = Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(decodeBase64(b64(bytes)) ?? [])).toEqual(bytes);
  });

  it("decodes RFC 4648 test vectors with and without padding", () => {
    const dec = (s: string) => Buffer.from(decodeBase64(s) ?? []).toString("latin1");
    expect(dec("Zg==")).toBe("f");
    expect(dec("Zm8=")).toBe("fo");
    expect(dec("Zm9v")).toBe("foo");
    expect(dec("Zm9vYmFy")).toBe("foobar");
    expect(dec("Zm9vYg")).toBe("foob");
  });

  it("accepts the URL-safe alphabet", () => {
    // 0xfb 0xff -> standard "+/8=", URL-safe "-_8"
    expect(Array.from(decodeBase64("-_8") ?? [])).toEqual([0xfb, 0xff]);
  });

  it("returns null for empty or invalid input", () => {
    expect(decodeBase64("")).toBeNull();
    expect(decodeBase64("===")).toBeNull();
    expect(decodeBase64("ab!c")).toBeNull();
    expect(decodeBase64("абв")).toBeNull();
  });
});

describe("base64Bytes", () => {
  it("computes decoded length from the padding", () => {
    expect(base64Bytes("Zg==")).toBe(1);
    expect(base64Bytes("Zm8=")).toBe(2);
    expect(base64Bytes("Zm9v")).toBe(3);
    expect(base64Bytes("")).toBe(0);
    expect(base64Bytes("!!!")).toBe(0);
  });
});

describe("stripDataUriPrefix", () => {
  it("strips a data URI prefix, whitespace and quotes", () => {
    expect(stripDataUriPrefix('"data:image/PNG;base64,iVBO\n Rw0K"')).toEqual({
      base64: "iVBORw0K",
      declaredMime: "image/png",
      hadPrefix: true,
    });
  });

  it("unwraps a CSS url(...)", () => {
    expect(stripDataUriPrefix("url('data:image/gif;base64,R0lG')").base64).toBe("R0lG");
  });

  it("passes through raw Base64", () => {
    expect(stripDataUriPrefix(" Zm9v ")).toEqual({
      base64: "Zm9v",
      declaredMime: "",
      hadPrefix: false,
    });
  });
});

describe("detectImageMime", () => {
  const u8 = (a: number[]) => Uint8Array.from(a);
  const ascii = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

  it("recognises magic numbers", () => {
    expect(detectImageMime(u8(PNG_SIG))).toBe("image/png");
    expect(detectImageMime(u8([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImageMime(ascii("GIF89a"))).toBe("image/gif");
    expect(detectImageMime(ascii("BM...."))).toBe("image/bmp");
    expect(detectImageMime(u8([0, 0, 1, 0, 1, 0]))).toBe("image/x-icon");
    expect(detectImageMime(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(detectImageMime(ascii("\0\0\0\x18ftypavif"))).toBe("image/avif");
    expect(detectImageMime(ascii("\0\0\0\x18ftypheic"))).toBe("image/heic");
    expect(detectImageMime(ascii("\0\0\0\x18ftypmif1"))).toBe("image/heic");
  });

  it("sniffs SVG text, with or without an XML prolog and BOM", () => {
    expect(detectImageMime(ascii("  <svg xmlns='x'/>"))).toBe("image/svg+xml");
    expect(detectImageMime(ascii('<?xml version="1.0"?><svg/>'))).toBe("image/svg+xml");
  });

  it("sniffs an SVG that starts with a UTF-8 BOM", () => {
    expect(detectImageMime(Uint8Array.from(Buffer.from("﻿<svg/>", "utf8")))).toBe("image/svg+xml");
  });

  it("returns empty for RIFF that is not WebP, truncated data and text", () => {
    expect(detectImageMime(ascii("RIFF\0\0\0\0WAVE"))).toBe("");
    expect(detectImageMime(u8([0x89, 0x50]))).toBe("");
    expect(detectImageMime(ascii("hello"))).toBe("");
    expect(detectImageMime(u8([]))).toBe("");
  });
});

describe("extensionForMime / formatBytes / suggestFilename", () => {
  it("maps MIME types to extensions", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/svg+xml")).toBe("svg");
    expect(extensionForMime("image/x-icon")).toBe("ico");
    expect(extensionForMime("text/plain")).toBe("bin");
  });

  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1536 * 1024)).toBe("1.50 MB");
  });

  it("suggests a filename", () => {
    expect(suggestFilename("png")).toBe("decoded-image.png");
    expect(suggestFilename("")).toBe("decoded-image.bin");
  });
});

describe("decodeBase64Image", () => {
  it("returns the empty result for blank input", () => {
    const r = decodeBase64Image("  ");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("");
    expect(r.size).toBe("0 B");
  });

  it("decodes a raw PNG payload", () => {
    const payload = b64([...PNG_SIG, 0, 0, 0, 0]);
    const r = decodeBase64Image(payload);
    expect(r.ok).toBe(true);
    expect(r.mime).toBe("image/png");
    expect(r.extension).toBe("png");
    expect(r.bytes).toBe(12);
    expect(r.size).toBe("12 B");
    expect(r.dataUri).toBe(`data:image/png;base64,${payload}`);
    expect(r.hadPrefix).toBe(false);
  });

  it("trusts the sniffed type over a wrong declared MIME", () => {
    const r = decodeBase64Image(`data:image/jpeg;base64,${b64("GIF89a")}`);
    expect(r.mime).toBe("image/gif");
    expect(r.hadPrefix).toBe(true);
  });

  it("falls back to the declared image MIME when bytes are unknown", () => {
    const r = decodeBase64Image(`data:image/tiff;base64,${b64("II*\0")}`);
    expect(r.ok).toBe(true);
    expect(r.mime).toBe("image/tiff");
    expect(r.extension).toBe("bin");
  });

  it("reports non-image payloads with their size", () => {
    const r = decodeBase64Image(b64("hello world"));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a PNG/);
    expect(r.bytes).toBe(11);
  });

  it("reports an empty data URI payload and invalid characters", () => {
    expect(decodeBase64Image("data:image/png;base64,").error).toMatch(/no Base64 payload/);
    expect(decodeBase64Image("<img src=x>").error).toMatch(/not valid Base64/);
    expect(decodeBase64Image("A").error).toMatch(/Could not decode/);
  });
});
