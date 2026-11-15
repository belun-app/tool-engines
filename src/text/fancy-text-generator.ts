/**
 * Plain text -> Unicode "fancy" text.
 *
 * Nothing here is a font. Every variant is a different set of real Unicode characters
 * that happen to look like styled Latin letters: the Mathematical Alphanumeric Symbols
 * block (U+1D400..U+1D7FF) supplies bold, italic, script, fraktur, double-struck and
 * monospace, Enclosed Alphanumerics supplies the circled and squared letters, and the
 * rest are one-off characters borrowed from phonetic and superscript blocks.
 *
 * Two details decide whether a generator is correct or not:
 *
 *  1. The maths block has holes. Twenty-four letters were already encoded in the BMP as
 *     named constants before the block existed, so Unicode left their slots reserved:
 *     italic h is U+210E, script B is U+212C, fraktur R is U+211C, and so on. A generator
 *     that only adds an offset emits an unassigned code point and the reader sees a box.
 *     Those letters live in HOLES below and are patched in after the offset pass.
 *  2. Only Latin exists. There is no Cyrillic, Arabic or CJK equivalent, so anything
 *     outside A-Z, a-z and 0-9 has to pass through untouched. Characters a style genuinely
 *     cannot draw are reported in `unsupported` rather than silently swallowed.
 */

export type FancyTextGroup = "math" | "enclosed" | "special";

export interface FancyTextStyleInfo {
  id: string;
  name: string;
  group: FancyTextGroup;
  /** Whether lowercase keeps its own shape instead of being folded onto the capitals. */
  hasLowercase: boolean;
  /** Whether 0-9 have a styled form. */
  hasDigits: boolean;
}

export interface FancyTextVariant extends FancyTextStyleInfo {
  text: string;
  /** Letters the style has no glyph for, deduplicated, in input order. */
  unsupported: string[];
  /** Characters as a human counts them, i.e. Unicode code points. */
  length: number;
  /** Characters as JavaScript and most bio limits count them: UTF-16 units. */
  utf16Length: number;
}

export interface FancyTextOptions {
  decoration?: string;
  flourish?: string;
  /** Restrict the output to these style ids, in this order. */
  styles?: string[];
}

export interface FancyTextResult {
  variants: FancyTextVariant[];
  /** Input was longer than MAX_INPUT_LENGTH and was cut. */
  truncated: boolean;
  /** Code points actually styled. */
  inputLength: number;
}

/** Long enough for a bio or a headline, short enough that every variant stays instant. */
export const MAX_INPUT_LENGTH = 1000;

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

/** Letters the Mathematical Alphanumeric Symbols block leaves reserved, by style. */
const HOLES: Record<string, Record<string, number>> = {
  italic: { h: 0x210e },
  "double-struck": {
    C: 0x2102,
    H: 0x210d,
    N: 0x2115,
    P: 0x2119,
    Q: 0x211a,
    R: 0x211d,
    Z: 0x2124,
  },
  script: {
    B: 0x212c,
    E: 0x2130,
    F: 0x2131,
    H: 0x210b,
    I: 0x2110,
    L: 0x2112,
    M: 0x2133,
    R: 0x211b,
    e: 0x212f,
    g: 0x210a,
    o: 0x2134,
  },
  fraktur: { C: 0x212d, H: 0x210c, I: 0x2111, R: 0x211c, Z: 0x2128 },
};

interface StyleSpec {
  id: string;
  name: string;
  group: FancyTextGroup;
  /** First code point of a contiguous A-Z run. */
  upper?: number;
  /** First code point of a contiguous a-z run. */
  lower?: number;
  /** First code point of a contiguous 0-9 run. */
  digits?: number;
  /** Styles whose digit run starts at 1 and keep zero somewhere else entirely. */
  digitsFromOne?: { base: number; zero?: number };
  /** Send lowercase input through the uppercase table — the style has one case only. */
  fold?: boolean;
  /** Ad-hoc pairs, applied last, for styles scattered across unrelated blocks. */
  pairs?: Record<string, string>;
  /** Shift the whole printable ASCII range, as the halfwidth/fullwidth forms do. */
  asciiShift?: number;
  /** Read the styled result right to left. */
  reverse?: boolean;
}

// A "?" in the tables below marks a letter Unicode never encoded in that shape.
const SMALL_CAPS = "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘꞯʀꜱᴛᴜᴠᴡxʏᴢ";
const SUPERSCRIPT = "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖ?ʳˢᵗᵘᵛʷˣʸᶻ";
const SUBSCRIPT = "ₐ???ₑ??ₕᵢⱼₖₗₘₙₒₚ?ᵣₛₜᵤᵥ?ₓ??";
const UPSIDE_DOWN_LOWER = "ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz";
const UPSIDE_DOWN_UPPER = "∀ꓭƆꓷƎℲ⅁HIſꓘ˥WNOԀÒꓤSꓕ∩ΛMX⅄Z";
const UPSIDE_DOWN_DIGITS = "0ƖᄅƐㄣϛ9ㄥ86";

function pairsFrom(source: string, target: string): Record<string, string> {
  const out: Record<string, string> = {};
  const glyphs = [...target];
  [...source].forEach((ch, i) => {
    const glyph = glyphs[i];
    if (glyph && glyph !== "?") out[ch] = glyph;
  });
  return out;
}

const UPSIDE_DOWN_PUNCTUATION: Record<string, string> = {
  ".": "˙",
  ",": "'",
  "'": ",",
  '"': "„",
  "`": ",",
  "?": "¿",
  "!": "¡",
  "[": "]",
  "]": "[",
  "(": ")",
  ")": "(",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
  "&": "⅋",
  _: "‾",
  ";": "؛",
};

const SPECS: StyleSpec[] = [
  { id: "bold", name: "Bold", group: "math", upper: 0x1d400, lower: 0x1d41a, digits: 0x1d7ce },
  { id: "italic", name: "Italic", group: "math", upper: 0x1d434, lower: 0x1d44e },
  { id: "bold-italic", name: "Bold italic", group: "math", upper: 0x1d468, lower: 0x1d482 },
  {
    id: "sans",
    name: "Sans-serif",
    group: "math",
    upper: 0x1d5a0,
    lower: 0x1d5ba,
    digits: 0x1d7e2,
  },
  {
    id: "sans-bold",
    name: "Sans-serif bold",
    group: "math",
    upper: 0x1d5d4,
    lower: 0x1d5ee,
    digits: 0x1d7ec,
  },
  { id: "sans-italic", name: "Sans-serif italic", group: "math", upper: 0x1d608, lower: 0x1d622 },
  {
    id: "sans-bold-italic",
    name: "Sans-serif bold italic",
    group: "math",
    upper: 0x1d63c,
    lower: 0x1d656,
  },
  { id: "mono", name: "Monospace", group: "math", upper: 0x1d670, lower: 0x1d68a, digits: 0x1d7f6 },
  {
    id: "double-struck",
    name: "Outline",
    group: "math",
    upper: 0x1d538,
    lower: 0x1d552,
    digits: 0x1d7d8,
  },
  { id: "script", name: "Script", group: "math", upper: 0x1d49c, lower: 0x1d4b6 },
  { id: "script-bold", name: "Bold script", group: "math", upper: 0x1d4d0, lower: 0x1d4ea },
  { id: "fraktur", name: "Fraktur", group: "math", upper: 0x1d504, lower: 0x1d51e },
  { id: "fraktur-bold", name: "Bold fraktur", group: "math", upper: 0x1d56c, lower: 0x1d586 },
  {
    id: "circled",
    name: "Circled",
    group: "enclosed",
    upper: 0x24b6,
    lower: 0x24d0,
    digitsFromOne: { base: 0x2460, zero: 0x24ea },
  },
  {
    id: "circled-filled",
    name: "Circled filled",
    group: "enclosed",
    upper: 0x1f150,
    fold: true,
    digitsFromOne: { base: 0x2776, zero: 0x24ff },
  },
  { id: "squared", name: "Squared", group: "enclosed", upper: 0x1f130, fold: true },
  { id: "squared-filled", name: "Squared filled", group: "enclosed", upper: 0x1f170, fold: true },
  {
    id: "parenthesised",
    name: "Parenthesised",
    group: "enclosed",
    upper: 0x1f110,
    lower: 0x249c,
    digitsFromOne: { base: 0x2474 },
  },
  { id: "fullwidth", name: "Fullwidth", group: "special", asciiShift: 0xff01 - 0x21 },
  {
    id: "small-caps",
    name: "Small caps",
    group: "special",
    // Capitals are deliberately left alone: in real small-caps typesetting the initial
    // letter stays full height, and that is what makes the style readable in a bio.
    pairs: { ...pairsFrom(LOWER, SMALL_CAPS), ...pairsFrom(UPPER, UPPER) },
  },
  {
    id: "superscript",
    name: "Superscript",
    group: "special",
    fold: true,
    pairs: {
      ...pairsFrom(LOWER, SUPERSCRIPT),
      ...pairsFrom(DIGITS, "⁰¹²³⁴⁵⁶⁷⁸⁹"),
      "+": "⁺",
      "-": "⁻",
      "=": "⁼",
      "(": "⁽",
      ")": "⁾",
    },
  },
  {
    id: "subscript",
    name: "Subscript",
    group: "special",
    fold: true,
    pairs: {
      ...pairsFrom(LOWER, SUBSCRIPT),
      ...pairsFrom(DIGITS, "₀₁₂₃₄₅₆₇₈₉"),
      "+": "₊",
      "-": "₋",
      "=": "₌",
      "(": "₍",
      ")": "₎",
    },
  },
  {
    id: "upside-down",
    name: "Upside down",
    group: "special",
    reverse: true,
    pairs: {
      ...pairsFrom(LOWER, UPSIDE_DOWN_LOWER),
      ...pairsFrom(UPPER, UPSIDE_DOWN_UPPER),
      ...pairsFrom(DIGITS, UPSIDE_DOWN_DIGITS),
      ...UPSIDE_DOWN_PUNCTUATION,
    },
  },
];

function run(chars: string, base: number): Array<[string, string]> {
  return [...chars].map((ch, i) => [ch, String.fromCodePoint(base + i)] as [string, string]);
}

function buildMap(spec: StyleSpec): Map<string, string> {
  const map = new Map<string, string>();

  if (spec.asciiShift !== undefined) {
    for (let code = 0x21; code <= 0x7e; code++) {
      map.set(String.fromCharCode(code), String.fromCodePoint(code + spec.asciiShift));
    }
    map.set(" ", "　");
  }

  if (spec.upper !== undefined) for (const [k, v] of run(UPPER, spec.upper)) map.set(k, v);
  if (spec.lower !== undefined) for (const [k, v] of run(LOWER, spec.lower)) map.set(k, v);
  if (spec.digits !== undefined) for (const [k, v] of run(DIGITS, spec.digits)) map.set(k, v);

  if (spec.digitsFromOne) {
    for (const [k, v] of run("123456789", spec.digitsFromOne.base)) map.set(k, v);
    if (spec.digitsFromOne.zero) map.set("0", String.fromCodePoint(spec.digitsFromOne.zero));
  }

  for (const [k, v] of Object.entries(spec.pairs ?? {})) map.set(k, v);

  // A single-case style borrows whichever case it has: the enclosed alphabets only
  // encode capitals, the superscripts only encode minuscules.
  if (spec.fold) {
    for (const [i, lower] of [...LOWER].entries()) {
      const upper = UPPER[i];
      const fromUpper = map.get(upper);
      const fromLower = map.get(lower);
      if (fromUpper && !fromLower) map.set(lower, fromUpper);
      if (fromLower && !fromUpper) map.set(upper, fromLower);
    }
  }

  for (const [k, code] of Object.entries(HOLES[spec.id] ?? {})) {
    map.set(k, String.fromCodePoint(code));
  }

  return map;
}

const MAPS = new Map(SPECS.map((spec) => [spec.id, buildMap(spec)]));
const SPEC_BY_ID = new Map(SPECS.map((spec) => [spec.id, spec]));

export const FANCY_TEXT_STYLES: FancyTextStyleInfo[] = SPECS.map((spec) => {
  const map = MAPS.get(spec.id) as Map<string, string>;
  return {
    id: spec.id,
    name: spec.name,
    group: spec.group,
    hasLowercase: !spec.fold && [...LOWER].some((ch) => map.get(ch) !== map.get(ch.toUpperCase())),
    hasDigits: [...DIGITS].every((ch) => map.has(ch)),
  };
});

export const DEFAULT_STYLE = "bold";

export interface FancyTextDecorationInfo {
  id: string;
  name: string;
  /** Combining mark appended to every character. */
  mark: string;
}

/**
 * Combining marks, not styles: each one is glued onto the character before it, so the
 * strike or the line is drawn by the reader's font rather than by a separate glyph.
 */
export const FANCY_TEXT_DECORATIONS: FancyTextDecorationInfo[] = [
  { id: "none", name: "None", mark: "" },
  { id: "strikethrough", name: "Strikethrough", mark: "̶" },
  { id: "underline", name: "Underline", mark: "̲" },
  { id: "overline", name: "Overline", mark: "̅" },
  { id: "slash", name: "Slash", mark: "̷" },
];

export interface FancyTextFlourishInfo {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
}

export const FANCY_TEXT_FLOURISHES: FancyTextFlourishInfo[] = [
  { id: "none", name: "None", prefix: "", suffix: "" },
  { id: "sparkles", name: "Sparkles", prefix: "✧･ﾟ ", suffix: " ･ﾟ✧" },
  { id: "stars", name: "Stars", prefix: "⋆｡°✩ ", suffix: " ✩°｡⋆" },
  { id: "hearts", name: "Hearts", prefix: "♡ ", suffix: " ♡" },
  { id: "flowers", name: "Flowers", prefix: "❀ ", suffix: " ❀" },
  { id: "brackets", name: "Brackets", prefix: "『", suffix: "』" },
  { id: "arrows", name: "Arrows", prefix: "→ ", suffix: " ←" },
  { id: "waves", name: "Waves", prefix: "≋", suffix: "≋" },
];

const DECORATION_BY_ID = new Map(FANCY_TEXT_DECORATIONS.map((d) => [d.id, d]));
const FLOURISH_BY_ID = new Map(FANCY_TEXT_FLOURISHES.map((f) => [f.id, f]));
const STYLE_BY_ID = new Map(FANCY_TEXT_STYLES.map((s) => [s.id, s]));

/**
 * Only letters are reported as unsupported. Missing digits are a property of the style
 * rather than of the input — every caller already gets that from `hasDigits`, and half
 * the maths alphabets have no digits at all, so flagging them would drown the real signal.
 */
const LETTER = /\p{L}/u;

/**
 * Applies one style. Unmapped characters pass through unchanged so that spaces,
 * punctuation and emoji survive; only letters and digits count as unsupported.
 */
export function styleText(
  text: string,
  styleId: string,
  options: { decoration?: string; flourish?: string } = {},
): FancyTextVariant {
  const info = STYLE_BY_ID.get(styleId) ?? (STYLE_BY_ID.get(DEFAULT_STYLE) as FancyTextStyleInfo);
  const map = MAPS.get(info.id) as Map<string, string>;
  const mark = (DECORATION_BY_ID.get(options.decoration ?? "none") ?? { mark: "" }).mark;
  const flourish = FLOURISH_BY_ID.get(options.flourish ?? "none") ?? { prefix: "", suffix: "" };

  const source = [...text].slice(0, MAX_INPUT_LENGTH);
  const cells: string[] = [];
  const unsupported: string[] = [];
  const seen = new Set<string>();

  for (const ch of source) {
    const mapped = map.get(ch);
    if (mapped === undefined && LETTER.test(ch) && !seen.has(ch)) {
      seen.add(ch);
      unsupported.push(ch);
    }
    // The mark stays welded to its own character so that reversing cannot orphan it.
    cells.push((mapped ?? ch) + mark);
  }

  if (SPEC_BY_ID.get(info.id)?.reverse) cells.reverse();
  const body = cells.join("");
  const styled = body ? flourish.prefix + body + flourish.suffix : "";

  return {
    ...info,
    text: styled,
    unsupported,
    length: [...styled].length,
    utf16Length: styled.length,
  };
}

/** Runs every style (or the requested subset) over the same input. */
export function generateFancyText(text: string, options: FancyTextOptions = {}): FancyTextResult {
  const points = [...text];
  const ids = options.styles?.length ? options.styles : FANCY_TEXT_STYLES.map((s) => s.id);

  return {
    variants: ids.filter((id) => STYLE_BY_ID.has(id)).map((id) => styleText(text, id, options)),
    truncated: points.length > MAX_INPUT_LENGTH,
    inputLength: Math.min(points.length, MAX_INPUT_LENGTH),
  };
}
