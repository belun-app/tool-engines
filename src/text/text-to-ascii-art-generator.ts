/**
 * Text → ASCII art banners.
 *
 * Two families of fonts live here. `standard` reproduces the glyphs of FIGlet's standard
 * font (standard.flf by Glenn Chappell and Ian Chai, BSD 3-Clause licence; see
 * THIRD_PARTY_NOTICES.md). The rest are rendered from one 5x7 bitmap — the same glyph
 * grid an LED matrix uses — so a new style costs a fill character and a scale factor
 * rather than another forty hand-drawn glyphs. The bitmap also carries the Cyrillic
 * alphabet.
 *
 * Glyph rows are written without trailing padding and squared off at load time, which
 * keeps the source free of trailing whitespace that editors and formatters like to eat.
 */

export type AsciiArtAlign = "left" | "center" | "right";
export type AsciiArtBorder = "none" | "single" | "double" | "ascii" | "stars";

export interface AsciiArtFontInfo {
  id: string;
  name: string;
  /** Rows one line of output occupies, before a drop shadow adds its own. */
  height: number;
  /** Whether the fill character can be overridden. Line-art fonts cannot. */
  fillable: boolean;
  /** Whether the font has Cyrillic glyphs. */
  cyrillic: boolean;
}

export interface AsciiArtOptions {
  font?: string;
  /** Blank columns inserted between glyphs. */
  letterSpacing?: number;
  align?: AsciiArtAlign;
  /** Wrap onto a new banner row past this many columns. 0 disables wrapping. */
  maxWidth?: number;
  border?: AsciiArtBorder;
  /** Overrides the font's fill character for bitmap fonts. First character wins. */
  fill?: string;
}

export interface AsciiArtResult {
  text: string;
  lines: string[];
  /** Columns in the widest line. */
  width: number;
  /** Total rows, including blank descender rows and the border. */
  height: number;
  font: string;
  fontName: string;
  /** Characters the chosen font has no glyph for, deduplicated, in input order. */
  unsupported: string[];
  /** True when the input was longer than MAX_INPUT_LENGTH and was cut. */
  truncated: boolean;
}

/** Long enough for a headline, short enough that the output stays a banner. */
export const MAX_INPUT_LENGTH = 200;

const BITMAP_HEIGHT = 7;
const BITMAP_WIDTH = 5;

/** 5x7 glyph grid: "#" is ink, "." is paper. Uppercase only — input is folded. */
const bitmapSource = (): Record<string, string[]> => ({
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  " ": ["", "", "", "", "", "", ""],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", ".#..."],
  "'": ["..#..", "..#..", ".....", ".....", ".....", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
  "`": ["..#..", "...#.", ".....", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  _: [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "*": [".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", "....."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "\\": ["#....", "#....", ".#...", "..#..", "...#.", "....#", "....#"],
  "|": ["..#..", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "[": [".###.", ".#...", ".#...", ".#...", ".#...", ".#...", ".###."],
  "]": [".###.", "...#.", "...#.", "...#.", "...#.", "...#.", ".###."],
  "{": ["...##", "..#..", "..#..", ".#...", "..#..", "..#..", "...##"],
  "}": ["##...", "..#..", "..#..", "...#.", "..#..", "..#..", "##..."],
  "<": ["...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."],
  ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "%": ["##..#", "##..#", "...#.", "..#..", ".#...", "#..##", "#..##"],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "^": ["..#..", ".#.#.", "#...#", ".....", ".....", ".....", "....."],
  "~": [".....", ".....", ".##.#", "#..#.", ".....", ".....", "....."],
});

/**
 * Cyrillic glyphs on the same 5x7 grid. Eleven letters are visually identical to their
 * Latin counterparts and are aliased rather than redrawn; the rest are here.
 */
const cyrillicSource = (): Record<string, string[]> => ({
  Б: ["#####", "#....", "#....", "####.", "#...#", "#...#", "####."],
  Г: ["#####", "#....", "#....", "#....", "#....", "#....", "#...."],
  Д: ["..###", "..#.#", "..#.#", ".#..#", ".#..#", "#####", "#...#"],
  Ё: [".#.#.", "#####", "#....", "####.", "#....", "#....", "#####"],
  Ж: ["#.#.#", "#.#.#", ".###.", "..#..", ".###.", "#.#.#", "#.#.#"],
  З: [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  И: ["#...#", "#...#", "#..##", "#.#.#", "##..#", "#...#", "#...#"],
  Й: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", "#...#"],
  Л: ["..###", "..#.#", ".#..#", ".#..#", ".#..#", "#...#", "#...#"],
  П: ["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#...#"],
  У: ["#...#", "#...#", ".#.#.", "..#..", "..#..", ".#...", "##..."],
  Ф: ["..#..", ".###.", "#.#.#", "#.#.#", "#.#.#", ".###.", "..#.."],
  Ц: ["#...#", "#...#", "#...#", "#...#", "#...#", "#####", "....#"],
  Ч: ["#...#", "#...#", "#...#", ".####", "....#", "....#", "....#"],
  Ш: ["#.#.#", "#.#.#", "#.#.#", "#.#.#", "#.#.#", "#.#.#", "#####"],
  Щ: ["#.#.#", "#.#.#", "#.#.#", "#.#.#", "#.#.#", "#####", "....#"],
  Ъ: ["##...", ".#...", ".#...", ".###.", ".#..#", ".#..#", ".###."],
  Ы: ["#...#", "#...#", "#...#", "##..#", "#.#.#", "#.#.#", "##..#"],
  Ь: ["#....", "#....", "#....", "####.", "#...#", "#...#", "####."],
  Э: [".###.", "#...#", "....#", "..###", "....#", "#...#", ".###."],
  Ю: ["#.###", "#.#.#", "#.#.#", "###.#", "#.#.#", "#.#.#", "#.###"],
  Я: [".####", "#...#", "#...#", ".####", "..#.#", ".#..#", "#...#"],
});

/** Cyrillic letters drawn identically to a Latin letter — no point storing them twice. */
const CYRILLIC_ALIASES: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
};

/** Strips the leading newline so a glyph can be written as an indented block. */
const art = (block: string): string[] => block.replace(/^\n/, "").split("\n");

/**
 * Hand-drawn banner font: five drawn rows plus one descender row. Widths inside a glyph
 * are squared off by squareGlyph(), so rows carry no trailing padding here.
 */
const standardSource = (): Record<string, string[]> => ({
  A: art(String.raw`
     _
    / \
   / _ \
  / ___ \
 /_/   \_\
`),
  B: art(String.raw`
  ____
 | __ )
 |  _ \
 | |_) |
 |____/
`),
  C: art(String.raw`
  ____
 / ___|
| |
| |___
 \____|
`),
  D: art(String.raw`
 ____
|  _ \
| | | |
| |_| |
|____/
`),
  E: art(String.raw`
 _____
| ____|
|  _|
| |___
|_____|
`),
  F: art(String.raw`
 _____
|  ___|
| |_
|  _|
|_|
`),
  G: art(String.raw`
  ____
 / ___|
| |  _
| |_| |
 \____|
`),
  H: art(String.raw`
 _   _
| | | |
| |_| |
|  _  |
|_| |_|
`),
  I: art(String.raw`
 ___
|_ _|
 | |
 | |
|___|
`),
  J: art(String.raw`
     _
    | |
 _  | |
| |_| |
 \___/
`),
  K: art(String.raw`
 _  __
| |/ /
| ' /
| . \
|_|\_\
`),
  L: art(String.raw`
 _
| |
| |
| |___
|_____|
`),
  M: art(String.raw`
 __  __
|  \/  |
| |\/| |
| |  | |
|_|  |_|
`),
  N: art(String.raw`
 _   _
| \ | |
|  \| |
| |\  |
|_| \_|
`),
  O: art(String.raw`
  ___
 / _ \
| | | |
| |_| |
 \___/
`),
  P: art(String.raw`
 ____
|  _ \
| |_) |
|  __/
|_|
`),
  Q: art(String.raw`
  ___
 / _ \
| | | |
| |_| |
 \__\_\
`),
  R: art(String.raw`
 ____
|  _ \
| |_) |
|  _ <
|_| \_\
`),
  S: art(String.raw`
 ____
/ ___|
\___ \
 ___) |
|____/
`),
  T: art(String.raw`
 _____
|_   _|
  | |
  | |
  |_|
`),
  U: art(String.raw`
 _   _
| | | |
| | | |
| |_| |
 \___/
`),
  V: art(String.raw`
__     __
\ \   / /
 \ \ / /
  \ V /
   \_/
`),
  W: art(String.raw`
__        __
\ \      / /
 \ \ /\ / /
  \ V  V /
   \_/\_/
`),
  X: art(String.raw`
__  __
\ \/ /
 \  /
 /  \
/_/\_\
`),
  Y: art(String.raw`
__   __
\ \ / /
 \ V /
  | |
  |_|
`),
  Z: art(String.raw`
 _____
|__  /
  / /
 / /_
/____|
`),
  "0": art(String.raw`
  ___
 / _ \
| | | |
| |_| |
 \___/
`),
  "1": art(String.raw`
 _
/ |
| |
| |
|_|
`),
  "2": art(String.raw`
 ____
|___ \
  __) |
 / __/
|_____|
`),
  "3": art(String.raw`
 _____
|___ /
  |_ \
 ___) |
|____/
`),
  "4": art(String.raw`
 _  _
| || |
| || |_
|__   _|
   |_|
`),
  "5": art(String.raw`
 ____
| ___|
|___ \
 ___) |
|____/
`),
  "6": art(String.raw`
  __
 / /_
| '_ \
| (_) |
 \___/
`),
  "7": art(String.raw`
 _____
|___  |
   / /
  / /
 /_/
`),
  "8": art(String.raw`
  ___
 ( _ )
 / _ \
| (_) |
 \___/
`),
  "9": art(String.raw`
  ___
 / _ \
| (_) |
 \__, |
   /_/
`),
  " ": art("\n\n\n\n\n\n    "),
  "!": art(String.raw`
 _
| |
| |
|_|
(_)
`),
  "?": art(String.raw`
 ___
|__ \
  / /
 |_|
 (_)
`),
  ".": art(String.raw`



 _
(_)
`),
  ",": art(String.raw`



 _
( )
|/
`),
  ":": art(String.raw`

 _
(_)
 _
(_)
`),
  ";": art(String.raw`

 _
(_)
 _
( )
|/
`),
  "'": art(String.raw`
 _
( )
|/
`),
  '"': art(String.raw`
 _ _
( | )
 V V
`),
  "-": art(String.raw`


 _____
|_____|
`),
  _: art(String.raw`



 ______
|______|
`),
  "+": art(String.raw`

    _
 _| |_
|_   _|
  |_|
`),
  "=": art(String.raw`

 ______
|______|
 ______
|______|
`),
  "(": art(String.raw`
  __
 / /
| |
| |
| |
 \_\
`),
  ")": art(String.raw`
__
\ \
 | |
 | |
 | |
/_/
`),
  "/": art(String.raw`
    __
   / /
  / /
 / /
/_/
`),
  "\\": art(String.raw`
__
\ \
 \ \
  \ \
   \_\
`),
  "*": art(String.raw`

__/\__
\    /
/_  _\
  \/
`),
});

interface FontDef {
  id: string;
  name: string;
  kind: "bitmap" | "art";
  /** Horizontal pixel repeat. Monospace cells are taller than wide, so 2 reads square. */
  scale: number;
  fill: string;
  shadow?: string;
  /** Shear each row so the banner leans to the right. */
  slant?: boolean;
  spacing: number;
  /**
   * Blank rows inserted between banner lines. The line-art font already ends on a blank
   * descender row, so only the bitmap fonts need one.
   */
  lineGap: number;
  glyphs?: Record<string, string[]>;
}

const bitmapFont = (rest: Omit<FontDef, "kind" | "lineGap">): FontDef => ({
  ...rest,
  kind: "bitmap",
  lineGap: 1,
});

const FONT_DEFS: FontDef[] = [
  { id: "standard", name: "Standard", kind: "art", scale: 1, fill: "", spacing: 0, lineGap: 0 },
  bitmapFont({ id: "block", name: "Block", scale: 2, fill: "█", spacing: 2 }),
  bitmapFont({ id: "banner", name: "Banner", scale: 2, fill: "#", spacing: 2 }),
  bitmapFont({ id: "stars", name: "Stars", scale: 2, fill: "*", spacing: 2 }),
  bitmapFont({ id: "shadow", name: "Shadow", scale: 2, fill: "█", shadow: "░", spacing: 3 }),
  bitmapFont({ id: "slant", name: "Slant", scale: 2, fill: "█", slant: true, spacing: 2 }),
  bitmapFont({ id: "mini", name: "Mini", scale: 1, fill: "#", spacing: 1 }),
];

/** Pads every row of a glyph to the same width so concatenation stays aligned. */
function squareGlyph(rows: string[], height: number): string[] {
  const padded = [...rows];
  while (padded.length < height) padded.push("");
  padded.length = height;
  const width = padded.reduce((max, row) => Math.max(max, row.length), 0);
  return padded.map((row) => row.padEnd(width, " "));
}

const STANDARD_HEIGHT = 6;

let glyphTables: { art: Record<string, string[]>; bitmap: Record<string, string[]> } | null = null;

/**
 * The glyph tables, built on first use rather than at import time, so importing the module
 * (for example only for `ASCII_ART_FONTS`) costs nothing.
 */
function fontGlyphs(kind: FontDef["kind"]): Record<string, string[]> {
  if (!glyphTables) {
    const art: Record<string, string[]> = Object.fromEntries(
      Object.entries(standardSource()).map(([char, rows]) => [
        char,
        squareGlyph(rows, STANDARD_HEIGHT),
      ]),
    );
    const bitmap: Record<string, string[]> = Object.fromEntries([
      ...Object.entries(bitmapSource()).map(([char, rows]) => [
        char,
        rows.map((row) => row.padEnd(BITMAP_WIDTH, ".")),
      ]),
      ...Object.entries(cyrillicSource()).map(([char, rows]) => [
        char,
        rows.map((row) => row.padEnd(BITMAP_WIDTH, ".")),
      ]),
    ]);
    for (const [cyrillic, latin] of Object.entries(CYRILLIC_ALIASES)) {
      bitmap[cyrillic] = bitmap[latin];
    }
    glyphTables = { art, bitmap };
  }
  return kind === "art" ? glyphTables.art : glyphTables.bitmap;
}

const FONTS: Record<string, FontDef> = Object.fromEntries(FONT_DEFS.map((f) => [f.id, f]));

export const DEFAULT_FONT = "standard";

export const ASCII_ART_FONTS: AsciiArtFontInfo[] = FONT_DEFS.map((def) => ({
  id: def.id,
  name: def.name,
  height: def.kind === "art" ? STANDARD_HEIGHT : BITMAP_HEIGHT + (def.shadow ? 1 : 0),
  fillable: def.kind === "bitmap",
  cyrillic: def.kind === "bitmap",
}));

/** Corner and edge characters: top-left, top-right, bottom-left, bottom-right, bar, post. */
const BORDERS: Record<Exclude<AsciiArtBorder, "none">, string[]> = {
  single: ["┌", "┐", "└", "┘", "─", "│"],
  double: ["╔", "╗", "╚", "╝", "═", "║"],
  ascii: ["+", "+", "+", "+", "-", "|"],
  stars: ["*", "*", "*", "*", "*", "*"],
};

function emptyResult(font: FontDef, truncated: boolean): AsciiArtResult {
  return {
    text: "",
    lines: [],
    width: 0,
    height: 0,
    font: font.id,
    fontName: font.name,
    unsupported: [],
    truncated,
  };
}

function glyphFor(font: FontDef, char: string): string[] | undefined {
  font.glyphs ??= fontGlyphs(font.kind);
  return Object.hasOwn(font.glyphs, char) ? font.glyphs[char] : undefined;
}

function glyphWidth(font: FontDef, char: string): number {
  const glyph = glyphFor(font, char) ?? glyphFor(font, " ");
  const raw = glyph?.[0]?.length ?? 0;
  return font.kind === "art" ? raw : raw * font.scale;
}

/** Greedy word wrap measured in output columns, not input characters. */
function wrapLine(font: FontDef, line: string, spacing: number, maxWidth: number): string[] {
  if (maxWidth <= 0) return [line];

  const measure = (text: string) => {
    const chars = [...text];
    if (!chars.length) return 0;
    const ink = chars.reduce((sum, ch) => sum + glyphWidth(font, ch), 0);
    return ink + spacing * (chars.length - 1);
  };

  if (measure(line) <= maxWidth) return [line];

  const out: string[] = [];
  let current = "";

  const breakOverlong = () => {
    while (measure(current) > maxWidth && [...current].length > 1) {
      const chars = [...current];
      let cut = chars.length;
      while (cut > 1 && measure(chars.slice(0, cut).join("")) > maxWidth) cut--;
      out.push(chars.slice(0, cut).join(""));
      current = chars.slice(cut).join("");
    }
  };

  for (const chunk of line.split(/(\s+)/)) {
    if (!chunk) continue;
    if (current && measure(current + chunk) > maxWidth) {
      out.push(current.trimEnd());
      current = chunk.trim() ? chunk : "";
    } else {
      current += chunk;
    }
    breakOverlong();
  }

  if (current.trim()) out.push(current.trimEnd());
  return out.length ? out : [""];
}

/** Renders one input line into a band of output rows. */
function renderBand(
  font: FontDef,
  line: string,
  spacing: number,
  fill: string,
  unsupported: Set<string>,
): string[] {
  const height = font.kind === "art" ? STANDARD_HEIGHT : BITMAP_HEIGHT;
  const chars = [...line];

  const resolve = (char: string): string[] => {
    const glyph = glyphFor(font, char);
    if (glyph) return glyph;
    if (char.trim()) unsupported.add(char);
    return glyphFor(font, " ") ?? [];
  };

  if (font.kind === "art") {
    const rows = Array.from({ length: height }, () => "");
    chars.forEach((char, index) => {
      const glyph = resolve(char);
      const gap = index > 0 && spacing > 0 ? " ".repeat(spacing) : "";
      for (let r = 0; r < height; r++) rows[r] += gap + (glyph[r] ?? "");
    });
    return rows;
  }

  // Bitmap path: build an ink grid first, then shear and shade it.
  const grid: boolean[][] = Array.from({ length: height }, () => [] as boolean[]);
  chars.forEach((char, index) => {
    const glyph = resolve(char);
    if (index > 0 && spacing > 0) {
      for (let r = 0; r < height; r++) {
        for (let s = 0; s < spacing; s++) grid[r].push(false);
      }
    }
    for (let r = 0; r < height; r++) {
      for (const cell of glyph[r] ?? "") {
        for (let s = 0; s < font.scale; s++) grid[r].push(cell === "#");
      }
    }
  });

  let ink = grid;
  if (font.slant) {
    const lean = height - 1;
    ink = grid.map((row, r) => {
      const shift = lean - r;
      return [
        ...Array.from({ length: shift }, () => false),
        ...row,
        ...Array.from({ length: lean - shift }, () => false),
      ];
    });
  }

  const width = ink.reduce((max, row) => Math.max(max, row.length), 0);
  const at = (r: number, c: number) => (r >= 0 && c >= 0 ? (ink[r]?.[c] ?? false) : false);

  if (!font.shadow) {
    return ink.map((_, r) =>
      Array.from({ length: width }, (_, c) => (at(r, c) ? fill : " ")).join(""),
    );
  }

  const shade = font.shadow;
  return Array.from({ length: height + 1 }, (_, r) =>
    Array.from({ length: width + 1 }, (_, c) => {
      if (at(r, c)) return fill;
      return at(r - 1, c - 1) ? shade : " ";
    }).join(""),
  );
}

function alignLines(lines: string[], width: number, align: AsciiArtAlign): string[] {
  if (align === "left") return lines;
  return lines.map((line) => {
    const padding = width - line.length;
    if (padding <= 0) return line;
    const left = align === "right" ? padding : Math.floor(padding / 2);
    return " ".repeat(left) + line;
  });
}

function applyBorder(lines: string[], width: number, style: AsciiArtBorder): string[] {
  if (style === "none") return lines;
  const [tl, tr, bl, br, bar, post] = BORDERS[style];
  const rule = bar.repeat(width + 2);
  const body = lines.map((line) => `${post} ${line.padEnd(width, " ")} ${post}`);
  return [`${tl}${rule}${tr}`, ...body, `${bl}${rule}${br}`];
}

/**
 * Turns text into an ASCII-art banner. Empty or whitespace-only input returns an empty
 * result rather than a box full of nothing.
 */
export function generateAsciiArt(text: string, options: AsciiArtOptions = {}): AsciiArtResult {
  const requested = options?.font ?? DEFAULT_FONT;
  const font = Object.hasOwn(FONTS, requested) ? FONTS[requested] : FONTS[DEFAULT_FONT];
  if (typeof text !== "string") return emptyResult(font, false);

  const truncated = text.length > MAX_INPUT_LENGTH;
  const source = (truncated ? text.slice(0, MAX_INPUT_LENGTH) : text).replace(/\t/g, "  ");

  if (!source.trim()) return emptyResult(font, truncated);

  const align = options.align ?? "left";
  const border = options.border ?? "none";
  const spacing = Math.max(0, Math.min(10, options.letterSpacing ?? font.spacing));
  const fill = font.kind === "bitmap" ? ([...(options.fill ?? "")][0] ?? font.fill) : font.fill;
  const maxWidth = Math.max(0, options.maxWidth ?? 0);

  const unsupported = new Set<string>();
  const upper = source.toUpperCase();

  const inputLines = upper
    .split(/\r\n|\r|\n/)
    .flatMap((line) => (line.trim() ? wrapLine(font, line, spacing, maxWidth) : [""]));

  const gap = Array.from({ length: font.lineGap }, () => "");
  const flat = inputLines
    .map((line) => (line ? renderBand(font, line, spacing, fill, unsupported) : [""]))
    .flatMap((band, index) => (index > 0 ? [...gap, ...band] : band))
    .map((line) => line.trimEnd());

  const width = flat.reduce((max, line) => Math.max(max, line.length), 0);
  const aligned = alignLines(flat, width, align);
  const lines = applyBorder(aligned, width, border);
  const finished = border === "none" ? lines.map((line) => line.trimEnd()) : lines;

  return {
    text: finished.join("\n"),
    lines: finished,
    width: finished.reduce((max, line) => Math.max(max, line.length), 0),
    height: finished.length,
    font: font.id,
    fontName: font.name,
    unsupported: [...unsupported],
    truncated,
  };
}
