import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateHashes } from "./hash-generator.js";

describe("generateHashes", () => {
  it("matches the FIPS/RFC test vectors for 'abc'", async () => {
    expect(await generateHashes("abc")).toEqual({
      // RFC 1321 A.5
      md5: "900150983cd24fb0d6963f7d28e17f72",
      // FIPS 180-2 appendix examples
      sha1: "a9993e364706816aba3e25717850c26c9cd0d89d",
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      sha512:
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    });
  });

  it("matches more RFC 1321 MD5 vectors", async () => {
    expect((await generateHashes("a")).md5).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect((await generateHashes("message digest")).md5).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    // 80 chars -> two 64-byte blocks
    expect(
      (
        await generateHashes(
          "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
        )
      ).md5,
    ).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });

  it("hand-rolled MD5 agrees with node:crypto around the 55/56/64-byte padding boundaries", async () => {
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128]) {
      const s = "x".repeat(n);
      const expected = createHash("md5").update(s).digest("hex");
      expect((await generateHashes(s)).md5, `length ${n}`).toBe(expected);
    }
  });

  it("hashes the UTF-8 bytes of Cyrillic and emoji", async () => {
    for (const s of ["Привет, мир", "😀👍🏽", "naïve café"]) {
      const r = await generateHashes(s);
      expect(r.md5).toBe(createHash("md5").update(s, "utf8").digest("hex"));
      expect(r.sha256).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });

  it("returns empty strings for empty input (no digest of the empty string)", async () => {
    expect(await generateHashes("")).toEqual({ md5: "", sha1: "", sha256: "", sha512: "" });
  });

  it("produces fixed-length lowercase hex", async () => {
    const r = await generateHashes(" ");
    expect(r.md5).toMatch(/^[0-9a-f]{32}$/);
    expect(r.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.sha512).toMatch(/^[0-9a-f]{128}$/);
  });
});
