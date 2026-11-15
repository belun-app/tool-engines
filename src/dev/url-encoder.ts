/**
 * Percent-encoding and decoding of URL components (encodeURIComponent rules), with lone
 * surrogates encoded as U+FFFD instead of throwing.
 */

/** Lone UTF-16 surrogates (half an emoji from a truncated paste). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function encodeURL(input: string): string {
  // encodeURIComponent throws URIError on a lone surrogate; encode it as U+FFFD
  // (%EF%BF%BD), as TextEncoder and browsers' URL parsers do.
  return encodeURIComponent(input.replace(LONE_SURROGATE, "�"));
}

export function decodeURL(input: string): { result: string | null; error: string | null } {
  try {
    return { result: decodeURIComponent(input), error: null };
  } catch {
    return { result: null, error: "Invalid URL-encoded string" };
  }
}
