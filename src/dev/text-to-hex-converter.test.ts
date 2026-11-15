import { describe, expect, it } from "vitest";
import { hexToText, textToHex } from "./text-to-hex-converter.js";

describe("textToHex", () => {
  it("encodes ASCII as lowercase two-digit bytes ('Hi' = 48 69)", () => {
    expect(textToHex("Hi")).toEqual({ hex: "48 69", charCount: 2, byteCount: 2 });
    expect(textToHex("\n").hex).toBe("0a");
  });

  it("encodes UTF-8 multi-byte characters", () => {
    // "я" = D1 8F ; "😀" = F0 9F 98 80
    expect(textToHex("я")).toEqual({ hex: "d1 8f", charCount: 1, byteCount: 2 });
    expect(textToHex("😀")).toEqual({ hex: "f0 9f 98 80", charCount: 1, byteCount: 4 });
  });

  it("returns zeros for empty input", () => {
    expect(textToHex("")).toEqual({ hex: "", charCount: 0, byteCount: 0 });
  });
});

describe("hexToText", () => {
  it("decodes spaced, compact, uppercase and prefixed forms", () => {
    expect(hexToText("48 69").text).toBe("Hi");
    expect(hexToText("4869").text).toBe("Hi");
    expect(hexToText("0x48 0X69").text).toBe("Hi");
    expect(hexToText("48:69").text).toBe("Hi");
    expect(hexToText("48-69,21").text).toBe("Hi!");
    expect(hexToText("D1 8F")).toEqual({ text: "я", charCount: 1, byteCount: 2, isValid: true });
  });

  it("treats empty input as valid and empty", () => {
    expect(hexToText("  ")).toEqual({ text: "", charCount: 0, byteCount: 0, isValid: true });
  });

  it("rejects odd digit counts and non-hex characters", () => {
    const invalid = { text: "", charCount: 0, byteCount: 0, isValid: false };
    expect(hexToText("486")).toEqual(invalid);
    expect(hexToText("zz")).toEqual(invalid);
    expect(hexToText("48 6g")).toEqual(invalid);
  });

  it("round-trips Unicode", () => {
    const s = "Привет, 世界 👋";
    expect(hexToText(textToHex(s).hex).text).toBe(s);
  });

  it("does not throw on invalid UTF-8 (replacement character)", () => {
    expect(hexToText("ff").text).toBe("�");
  });
});
