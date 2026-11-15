import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ALGORITHM_LABELS,
  compareHash,
  createFileHasher,
  createMd5,
  createSha1,
  createSha256,
  detectHashAlgorithm,
  formatFileSize,
  hashBytes,
  normalizeHash,
} from "./file-hash-checker.js";

const ref = (algo: string, data: Uint8Array) => createHash(algo).update(data).digest("hex");
const ascii = (s: string) => new TextEncoder().encode(s);

describe("hashes — published test vectors", () => {
  it("hashes the empty input", () => {
    expect(hashBytes(new Uint8Array())).toEqual({
      md5: "d41d8cd98f00b204e9800998ecf8427e",
      sha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
  });

  it('hashes "abc" (RFC 1321 / FIPS 180 examples)', () => {
    expect(hashBytes(ascii("abc"))).toEqual({
      md5: "900150983cd24fb0d6963f7d28e17f72",
      sha1: "a9993e364706816aba3e25717850c26c9cd0d89d",
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  });

  it("hashes the 56-byte two-block FIPS message", () => {
    const r = hashBytes(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"));
    expect(r.sha1).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
    expect(r.sha256).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
});

describe("hashes — agree with node:crypto across block boundaries and chunkings", () => {
  // Lengths around the 55/56/64-byte padding edges and multi-block inputs.
  const lengths = [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000];

  it.each(lengths)("length %i, one chunk", (n) => {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
    expect(hashBytes(data)).toEqual({
      md5: ref("md5", data),
      sha1: ref("sha1", data),
      sha256: ref("sha256", data),
    });
  });

  it("gives the same digest regardless of how the input is chunked", () => {
    const data = Uint8Array.from({ length: 1000 }, (_, i) => (i * 13) & 0xff);
    for (const size of [1, 3, 63, 64, 65, 500]) {
      const h = createFileHasher();
      for (let i = 0; i < data.length; i += size) h.update(data.subarray(i, i + size));
      h.update(new Uint8Array()); // empty chunk is a no-op
      expect(h.digest()).toEqual(hashBytes(data));
    }
  });

  it("digest is idempotent and later updates are ignored", () => {
    const h = createSha256();
    h.update(ascii("abc"));
    const first = h.digest();
    h.update(ascii("more"));
    expect(h.digest()).toBe(first);
    const m = createMd5();
    expect(m.digest()).toBe(m.digest());
    expect(createSha1().digest()).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });
});

describe("normalizeHash / detectHashAlgorithm", () => {
  const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  it("extracts a digest from sha256sum output and markup", () => {
    expect(normalizeHash(`${sha256.toUpperCase()}  *file.iso`)).toBe(sha256);
    expect(normalizeHash(`<code>${sha256}</code>`)).toBe(sha256);
  });

  it("joins certutil-style spaced pairs", () => {
    const md5 = "d41d8cd98f00b204e9800998ecf8427e";
    const spaced = md5.match(/../g)?.join(" ") ?? "";
    expect(normalizeHash(spaced)).toBe(md5);
  });

  it("returns empty for unusable input", () => {
    expect(normalizeHash("not a hash")).toBe("");
    expect(normalizeHash("abc123")).toBe("");
  });

  it("detects algorithms by length", () => {
    expect(detectHashAlgorithm("a".repeat(32))).toBe("md5");
    expect(detectHashAlgorithm("a".repeat(40))).toBe("sha1");
    expect(detectHashAlgorithm("a".repeat(64))).toBe("sha256");
    expect(detectHashAlgorithm("a".repeat(48))).toBeNull();
    expect(ALGORITHM_LABELS.sha1).toBe("SHA-1");
  });
});

describe("compareHash", () => {
  const result = hashBytes(ascii("abc"));

  it("reports empty, invalid, match and mismatch", () => {
    expect(compareHash(result, "  ").status).toBe("empty");
    expect(compareHash(result, "xyz").status).toBe("invalid");
    const ok = compareHash(result, ` ${result.sha1.toUpperCase()} `);
    expect(ok).toMatchObject({ status: "match", matched: true, algorithm: "sha1" });
    const bad = compareHash(result, "0".repeat(32));
    expect(bad).toMatchObject({ status: "mismatch", matched: false, algorithm: "md5" });
  });

  it("is a mismatch when no file has been hashed yet", () => {
    expect(compareHash(null, result.md5).status).toBe("mismatch");
  });
});

describe("formatFileSize", () => {
  it("scales units with 2/1/0 decimals", () => {
    expect(formatFileSize(-1)).toBe("0 B");
    expect(formatFileSize(Number.NaN)).toBe("0 B");
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1023)).toBe("1023 B");
    expect(formatFileSize(1536)).toBe("1.50 KB");
    expect(formatFileSize(10 * 1024)).toBe("10.0 KB");
    expect(formatFileSize(200 * 1024)).toBe("200 KB");
    expect(formatFileSize(5 * 1024 ** 3)).toBe("5.00 GB");
    expect(formatFileSize(2048 * 1024 ** 4)).toBe("2048 TB");
  });
});
