/**
 * Converts text to binary, one group of at least eight bits per Unicode code point, and
 * binary back to text.
 */

export interface TextToBinaryResult {
  binary: string;
  charCount: number;
  bitCount: number;
}

export interface BinaryToTextResult {
  text: string;
  charCount: number;
  bitCount: number;
  isValid: boolean;
}

export function textToBinary(text: string): TextToBinaryResult {
  if (!text) return { binary: "", charCount: 0, bitCount: 0 };

  // One group per code point, so an emoji (U+1F600, 17 bits) stays whole and round-trips.
  const chunks = Array.from(text).map((ch) =>
    (ch.codePointAt(0) ?? 0).toString(2).padStart(8, "0"),
  );

  return {
    binary: chunks.join(" "),
    charCount: text.length,
    // Groups wider than 8 bits (Cyrillic П is 11) count their real length.
    bitCount: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  };
}

export function binaryToText(binary: string): BinaryToTextResult {
  const trimmed = binary.trim();
  if (!trimmed) return { text: "", charCount: 0, bitCount: 0, isValid: true };

  const chunks = trimmed.split(/\s+/).filter(Boolean);
  let isValid = true;

  const chars = chunks.map((chunk) => {
    if (!/^[01]+$/.test(chunk)) {
      isValid = false;
      return "";
    }
    const code = Number.parseInt(chunk, 2);
    if (code > 0x10ffff) {
      isValid = false;
      return "";
    }
    return String.fromCodePoint(code);
  });

  const text = chars.join("");
  return {
    text,
    charCount: text.length,
    bitCount: chunks.length * 8,
    isValid,
  };
}
