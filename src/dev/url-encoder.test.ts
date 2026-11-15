import { describe, expect, it } from "vitest";
import { decodeURL, encodeURL } from "./url-encoder.js";

describe("encodeURL", () => {
  it("percent-encodes reserved characters and spaces", () => {
    expect(encodeURL("a b&c=d/e?f#g")).toBe("a%20b%26c%3Dd%2Fe%3Ff%23g");
    expect(encodeURL("")).toBe("");
  });

  it("leaves unreserved characters alone", () => {
    expect(encodeURL("AZaz09-_.!~*'()")).toBe("AZaz09-_.!~*'()");
  });

  it("encodes UTF-8 Cyrillic and emoji", () => {
    // "я" = D1 8F ; U+1F600 = F0 9F 98 80
    expect(encodeURL("я")).toBe("%D1%8F");
    expect(encodeURL("😀")).toBe("%F0%9F%98%80");
  });

  it("does not throw on a lone UTF-16 surrogate", () => {
    expect(() => encodeURL("\uD83D")).not.toThrow();
    expect(encodeURL("a\uD83D")).toBe("a%EF%BF%BD");
    expect(encodeURL("😀")).toBe("%F0%9F%98%80");
  });
});

describe("decodeURL", () => {
  it("decodes percent-encoded UTF-8", () => {
    expect(decodeURL("%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82")).toEqual({
      result: "привет",
      error: null,
    });
    expect(decodeURL("a%20b%26c").result).toBe("a b&c");
  });

  it("keeps '+' literal (component decoding, not form decoding)", () => {
    expect(decodeURL("a+b").result).toBe("a+b");
  });

  it("round-trips", () => {
    const s = "q=кот & dog/😀?";
    expect(decodeURL(encodeURL(s)).result).toBe(s);
  });

  it("returns an error for malformed sequences", () => {
    expect(decodeURL("%")).toEqual({ result: null, error: "Invalid URL-encoded string" });
    expect(decodeURL("%E0%A4%A").error).toBe("Invalid URL-encoded string");
    expect(decodeURL("%FF").error).toBe("Invalid URL-encoded string");
  });
});
