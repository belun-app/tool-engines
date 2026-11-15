import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64 } from "./base64.js";

describe("encodeBase64", () => {
  it("encodes RFC 4648 test vectors", () => {
    // RFC 4648 §10
    expect(encodeBase64("")).toBe("");
    expect(encodeBase64("f")).toBe("Zg==");
    expect(encodeBase64("fo")).toBe("Zm8=");
    expect(encodeBase64("foo")).toBe("Zm9v");
    expect(encodeBase64("foob")).toBe("Zm9vYg==");
    expect(encodeBase64("fooba")).toBe("Zm9vYmE=");
    expect(encodeBase64("foobar")).toBe("Zm9vYmFy");
  });

  it("encodes UTF-8 (Cyrillic, emoji) as the page promises", () => {
    // "Привет" = D0 9F D1 80 D0 B8 D0 B2 D0 B5 D1 82
    expect(encodeBase64("Привет")).toBe("0J/RgNC40LLQtdGC");
    // U+1F600 = F0 9F 98 80
    expect(encodeBase64("😀")).toBe("8J+YgA==");
  });
});

describe("decodeBase64", () => {
  it("decodes RFC 4648 vectors and UTF-8", () => {
    expect(decodeBase64("Zm9vYmFy")).toEqual({ result: "foobar", error: null });
    expect(decodeBase64("0J/RgNC40LLQtdGC").result).toBe("Привет");
    expect(decodeBase64("8J+YgA==").result).toBe("😀");
  });

  it("ignores surrounding and embedded whitespace (line-wrapped Base64)", () => {
    expect(decodeBase64("  Zm9v\nYmFy \r\n").result).toBe("foobar");
  });

  it("decodes empty input to empty text", () => {
    expect(decodeBase64("")).toEqual({ result: "", error: null });
  });

  it("round-trips arbitrary text", () => {
    const s = "Mixed: ÄÖÜ ß — 中文 — 👨‍👩‍👧";
    expect(decodeBase64(encodeBase64(s)).result).toBe(s);
  });

  it("returns an error (not a throw) for invalid Base64", () => {
    expect(decodeBase64("not base64!")).toEqual({ result: null, error: "Invalid Base64 string" });
    expect(decodeBase64("a")).toEqual({ result: null, error: "Invalid Base64 string" });
    expect(decodeBase64("Zm9v=YmFy").error).toBe("Invalid Base64 string");
  });
});
