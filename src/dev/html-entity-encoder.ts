export interface HtmlEntityResult {
  result: string;
  error: string | null;
}

// The five characters that must be escaped for safe embedding in HTML markup.
const CHAR_TO_NAMED: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Common named entities decoded back to their character. Numeric entities
// (&#38; and &#x26;) are handled separately, so this map only needs the names.
const NAMED_TO_CHAR: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  cent: "¢",
  pound: "£",
  yen: "¥",
  euro: "€",
  sect: "§",
  para: "¶",
  middot: "·",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  dagger: "†",
  Dagger: "‡",
  permil: "‰",
  prime: "′",
  Prime: "″",
  larr: "←",
  uarr: "↑",
  rarr: "→",
  darr: "↓",
  harr: "↔",
  spades: "♠",
  clubs: "♣",
  hearts: "♥",
  diams: "♦",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "‌",
  zwj: "‍",
  infin: "∞",
  ne: "≠",
  le: "≤",
  ge: "≥",
  radic: "√",
  sum: "∑",
  prod: "∏",
  int: "∫",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  pi: "π",
  sigma: "σ",
  omega: "ω",
  Omega: "Ω",
  Delta: "Δ",
  Sigma: "Σ",
  Pi: "Π",
};

/**
 * Escape a string for safe embedding in HTML. Always escapes the five markup
 * characters (& < > " '). When `encodeNonAscii` is true, every character above
 * U+007F is also converted to a hexadecimal numeric entity (&#xNN;), which is
 * useful for pasting international text into ASCII-only contexts like email.
 */
export function encodeHtmlEntities(input: string, encodeNonAscii = false): string {
  if (!input) return "";

  let out = "";
  // Iterate by code point so surrogate pairs (emoji, astral characters) stay intact.
  for (const ch of input) {
    const named = CHAR_TO_NAMED[ch];
    if (named) {
      out += named;
      continue;
    }
    if (encodeNonAscii) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp > 127) {
        out += `&#x${cp.toString(16).toUpperCase()};`;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/**
 * Decode HTML entities back to plain text. Handles named entities from the map
 * above plus decimal (&#38;) and hexadecimal (&#x26;) numeric entities. Unknown
 * entities are left untouched rather than dropped.
 */
export function decodeHtmlEntities(input: string): HtmlEntityResult {
  if (!input) return { result: "", error: null };

  // HTML allows both &#x26; and &#X26; for hex references.
  const result = input.replace(
    /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        if (Number.isNaN(code) || code < 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      const char = NAMED_TO_CHAR[body];
      return char !== undefined ? char : match;
    },
  );

  return { result, error: null };
}
