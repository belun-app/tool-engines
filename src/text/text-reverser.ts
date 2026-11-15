/**
 * Reverses text letter by letter, by word order or within each word, mirrors it or turns it
 * upside down (Latin and Cyrillic), and checks for palindromes.
 */

import { segmentGraphemes } from "../_graphemes.js";

export type TextReverserMode = "letter" | "word" | "flip" | "mirror" | "eachWord";

export const TEXT_REVERSER_MODES: readonly TextReverserMode[] = [
  "letter",
  "flip",
  "mirror",
  "word",
  "eachWord",
];

export interface TextReverserResult {
  output: string;
}

/**
 * Glyphs that read as their partner when the page is rotated 180°.
 * Latin, Cyrillic, digits and punctuation. Every pair is registered in both
 * directions below, so flipping twice restores Latin letters, digits and
 * punctuation. It does not restore every Cyrillic letter: where a Cyrillic letter
 * shares its rotated glyph with an earlier entry (Л → V, М and Ш → W, Ь → Q),
 * the glyph rotates back to that entry, so Л comes back as Λ and М as M.
 */
const ROTATION_PAIRS: Array<[string, string]> = [
  // Latin lowercase
  ["a", "ɐ"],
  ["b", "q"],
  ["c", "ɔ"],
  ["d", "p"],
  ["e", "ǝ"],
  ["f", "ɟ"],
  ["g", "ƃ"],
  ["h", "ɥ"],
  ["i", "ᴉ"],
  ["j", "ɾ"],
  ["k", "ʞ"],
  ["m", "ɯ"],
  ["n", "u"],
  ["r", "ɹ"],
  ["t", "ʇ"],
  ["v", "ʌ"],
  ["w", "ʍ"],
  ["y", "ʎ"],
  // Latin uppercase
  ["A", "∀"],
  ["B", "ᙠ"],
  ["C", "Ɔ"],
  ["D", "ᗡ"],
  ["E", "Ǝ"],
  ["F", "Ⅎ"],
  ["G", "⅁"],
  ["J", "ſ"],
  ["K", "ꓘ"],
  ["L", "⅂"],
  ["M", "W"],
  ["P", "Ԁ"],
  ["Q", "Ò"],
  ["R", "ᴚ"],
  ["T", "⊥"],
  ["U", "∩"],
  ["V", "Λ"],
  ["Y", "⅄"],
  // Digits
  ["1", "Ɩ"],
  ["2", "ᄅ"],
  ["3", "Ɛ"],
  ["4", "ㄣ"],
  ["5", "ϛ"],
  ["6", "9"],
  ["7", "ㄥ"],
  // Punctuation
  [".", "˙"],
  [",", "'"],
  ['"', "„"],
  ["?", "¿"],
  ["!", "¡"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
  ["<", ">"],
  ["_", "‾"],
  [";", "؛"],
  ["&", "⅋"],
  // Cyrillic lowercase
  ["а", "ɐ"], // а
  ["б", "ƍ"], // б
  ["в", "ʚ"], // в
  ["г", "ɹ"], // г — the turned r reads as a г seen upside down
  ["д", "ɓ"], // д
  ["е", "ǝ"], // е
  ["ё", "ǝ"], // ё
  ["з", "ε"], // з
  ["й", "ņ"], // й
  ["к", "ʞ"], // к
  ["л", "v"], // л
  ["м", "w"], // м
  ["п", "u"], // п
  ["р", "d"], // р
  ["с", "ɔ"], // с
  ["т", "ɯ"], // т
  ["у", "ʎ"], // у
  ["ц", "ǹ"], // ц
  ["ч", "Һ"], // ч
  ["ш", "m"], // ш
  ["щ", "m"], // щ
  ["ъ", "q"], // ъ
  ["ь", "q"], // ь
  ["э", "є"], // э
  ["я", "ʁ"], // я
  // Cyrillic uppercase
  ["А", "∀"], // А
  ["Б", "ƍ"], // Б
  ["В", "ʚ"], // В
  ["Г", "⅃"], // Г — stem on the right and the bar at the bottom once rotated
  ["Д", "Ɓ"], // Д
  ["Е", "Ǝ"], // Е
  ["Ё", "Ǝ"], // Ё
  ["З", "Ɛ"], // З
  ["Й", "Ņ"], // Й
  ["К", "ʞ"], // К
  ["Л", "V"], // Л
  ["М", "W"], // М
  ["П", "U"], // П
  ["Р", "Ԁ"], // Р
  ["С", "Ɔ"], // С
  ["Т", "⊥"], // Т
  ["У", "⅄"], // У
  ["Ц", "Ǹ"], // Ц
  ["Ч", "Һ"], // Ч
  ["Ш", "W"], // Ш
  ["Щ", "W"], // Щ
  ["Ъ", "Q"], // Ъ
  ["Ь", "Q"], // Ь
  ["Э", "Є"], // Э
  ["Я", "ʁ"], // Я
];

/** Multi-code-point rotations — no single glyph exists for these. */
const ROTATION_EXTRA: ReadonlyArray<readonly [string, string]> = [
  ["ы", "ıq"],
  ["Ы", "Iq"],
  ["ю", "oı"],
  ["Ю", "OI"],
];

const ROTATION_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = Object.fromEntries(ROTATION_EXTRA);
  for (const [from, to] of ROTATION_PAIRS) {
    if (!(from in map)) map[from] = to;
    if (!(to in map)) map[to] = from;
  }
  return map;
})();

/**
 * Glyphs that read as their partner in a mirror (reflected left to right). Unicode has a
 * mirrored look-alike for only part of the alphabet: letters without one (and the
 * symmetric ones such as o, x, А, Ж) stay as they are. Pairs are registered in both
 * directions; when two letters share a mirror image (Latin N and Cyrillic И), the first
 * one listed wins on the way back.
 */
const MIRROR_PAIRS: Array<[string, string]> = [
  // Latin lowercase
  ["a", "ɒ"],
  ["b", "d"],
  ["c", "ɔ"],
  ["e", "ɘ"],
  ["f", "ʇ"],
  ["g", "ϱ"],
  ["h", "ʜ"],
  ["j", "ꞁ"],
  ["k", "ʞ"],
  ["p", "q"],
  ["r", "ɿ"],
  ["s", "ꙅ"],
  ["t", "ƚ"],
  ["y", "γ"],
  ["z", "ƹ"],
  // Latin uppercase
  ["B", "ᙠ"],
  ["C", "Ɔ"],
  ["D", "ᗡ"],
  ["E", "Ǝ"],
  ["F", "ꟻ"],
  ["G", "Ꭾ"],
  ["J", "Ⴑ"],
  ["K", "ꓘ"],
  ["L", "⅃"],
  ["N", "И"],
  ["P", "ꟼ"],
  ["R", "Я"],
  ["S", "Ꙅ"],
  ["Z", "Ƹ"],
  // Digits and punctuation
  ["3", "Ɛ"],
  ["?", "⸮"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
  ["/", "\\"],
  // Cyrillic
  ["г", "ɿ"],
  ["е", "ɘ"],
  ["ё", "ɘ̈"],
  ["з", "ε"],
  ["и", "ᴎ"],
  ["к", "ʞ"],
  ["р", "q"],
  ["с", "ɔ"],
  ["э", "є"],
  ["я", "ʁ"],
  ["Г", "⅂"], // stem on the right, bar still on top (⅃ is the rotated Г)
  ["Е", "Ǝ"],
  ["Ё", "Ǝ̈"],
  ["З", "Ɛ"],
  ["И", "N"],
  ["К", "ꓘ"],
  ["Р", "ꟼ"],
  ["С", "Ɔ"],
  ["Э", "Є"],
  ["Я", "R"],
];

const MIRROR_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [from, to] of MIRROR_PAIRS) {
    if (!(from in map)) map[from] = to;
    if (!(to in map)) map[to] = from;
  }
  return map;
})();

/**
 * Rotate every glyph 180° and reverse the whole text — lines included, because a
 * screen turned upside down shows the last line on top.
 */
function flipUpsideDown(text: string): string {
  return segmentGraphemes(text)
    .map((ch) => ROTATION_MAP[ch] ?? ch)
    .reverse()
    .join("");
}

/** Reflect each line left to right: mirrored glyphs in reverse order, line order kept. */
function mirror(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      segmentGraphemes(line)
        .map((ch) => MIRROR_MAP[ch] ?? ch)
        .reverse()
        .join(""),
    )
    .join("\n");
}

/** Reverse the letters inside every word; words, spaces and lines stay where they are. */
function reverseEachWord(text: string): string {
  return text
    .split(/(\s+)/)
    .map((part) => (/^\s*$/.test(part) ? part : segmentGraphemes(part).reverse().join("")))
    .join("");
}

/**
 * A palindrome reads the same both ways once case, spaces and punctuation are ignored
 * («А роза упала на лапу Азора», "Was it a car or a cat I saw?"); ё counts as е.
 * Needs at least three letters or digits, so "a" or "ok" is not reported.
 */
export function isPalindrome(text: string): boolean {
  const chars = [...text.toLowerCase().replace(/ё/g, "е")].filter((c) => /[\p{L}\p{Nd}]/u.test(c));
  if (chars.length < 3) return false;
  for (let i = 0, j = chars.length - 1; i < j; i++, j--) if (chars[i] !== chars[j]) return false;
  return true;
}

export function reverseText(text: string, mode: TextReverserMode): TextReverserResult {
  if (!text) return { output: "" };

  if (mode === "letter") {
    return { output: segmentGraphemes(text).reverse().join("") };
  }

  if (mode === "flip") {
    return { output: flipUpsideDown(text) };
  }

  if (mode === "mirror") {
    return { output: mirror(text) };
  }

  if (mode === "eachWord") {
    return { output: reverseEachWord(text) };
  }

  const output = text
    .split("\n")
    .map((line) => line.split(/\s+/).filter(Boolean).reverse().join(" "))
    .join("\n");

  return { output };
}
