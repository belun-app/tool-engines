export interface TextToHexResult {
  hex: string;
  charCount: number;
  byteCount: number;
}

export interface HexToTextResult {
  text: string;
  charCount: number;
  byteCount: number;
  isValid: boolean;
}

/** Encode text to space-separated, lowercase, two-digit UTF-8 hex bytes. */
export function textToHex(text: string): TextToHexResult {
  if (!text) return { hex: "", charCount: 0, byteCount: 0 };

  const bytes = new TextEncoder().encode(text);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

  return { hex, charCount: [...text].length, byteCount: bytes.length };
}

/**
 * Decode a hexadecimal string back to text. Tolerates common formatting:
 * spaces, colons, commas, dashes, and "0x" prefixes are all stripped first.
 * Returns isValid: false when the cleaned input has non-hex characters or an
 * odd number of digits (which can't form whole bytes).
 */
export function hexToText(hex: string): HexToTextResult {
  const cleaned = hex
    .trim()
    .replace(/0x/gi, "")
    .replace(/[\s,:;_-]+/g, "");

  if (!cleaned) return { text: "", charCount: 0, byteCount: 0, isValid: true };

  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    return { text: "", charCount: 0, byteCount: 0, isValid: false };
  }

  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }

  const text = new TextDecoder("utf-8").decode(bytes);
  return { text, charCount: [...text].length, byteCount: bytes.length, isValid: true };
}
