/**
 * Base64 encoding and decoding of UTF-8 text.
 */

export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary);
}

export function decodeBase64(input: string): { result: string | null; error: string | null } {
  try {
    const cleaned = input.trim().replace(/\s/g, "");
    const binary = atob(cleaned);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return { result: new TextDecoder().decode(bytes), error: null };
  } catch {
    return { result: null, error: "Invalid Base64 string" };
  }
}
