import { describe, expect, it } from "vitest";
import { binaryToText, textToBinary } from "./text-to-binary.js";

describe("textToBinary", () => {
  it("encodes ASCII as 8-bit groups ('A' = 65 = 01000001)", () => {
    expect(textToBinary("A")).toEqual({ binary: "01000001", charCount: 1, bitCount: 8 });
    // H=72=01001000, i=105=01101001
    expect(textToBinary("Hi")).toEqual({
      binary: "01001000 01101001",
      charCount: 2,
      bitCount: 16,
    });
    // space = 32 = 00100000
    expect(textToBinary(" ").binary).toBe("00100000");
  });

  it("returns zeros for empty input", () => {
    expect(textToBinary("")).toEqual({ binary: "", charCount: 0, bitCount: 0 });
  });

  it("encodes non-ASCII by UTF-16 code unit as documented (é = 233)", () => {
    expect(textToBinary("é").binary).toBe("11101001");
    // П = U+041F = 1055 = 10000011111 (wider than 8 bits, no padding needed)
    expect(textToBinary("П").binary).toBe("10000011111");
  });

  it("reports the actual number of bits for non-ASCII characters", () => {
    expect(textToBinary("П").bitCount).toBe(11);
  });

  it("round-trips an emoji", () => {
    expect(binaryToText(textToBinary("😀").binary).text).toBe("😀");
  });
});

describe("binaryToText", () => {
  it("decodes 8-bit groups separated by any whitespace", () => {
    expect(binaryToText("01001000 01101001")).toEqual({
      text: "Hi",
      charCount: 2,
      bitCount: 16,
      isValid: true,
    });
    expect(binaryToText("  01001000\n\t01101001  ").text).toBe("Hi");
  });

  it("accepts unpadded groups", () => {
    // 1000001 = 65 = A
    expect(binaryToText("1000001").text).toBe("A");
  });

  it("treats empty input as valid and empty", () => {
    expect(binaryToText("   ")).toEqual({ text: "", charCount: 0, bitCount: 0, isValid: true });
  });

  it("flags groups with non-binary digits as invalid and skips them", () => {
    const r = binaryToText("01000001 0102 01000010");
    expect(r.isValid).toBe(false);
    expect(r.text).toBe("AB");
  });

  it("round-trips ASCII and Latin-1", () => {
    const s = "Hello, World! café";
    expect(binaryToText(textToBinary(s).binary).text).toBe(s);
  });
});
