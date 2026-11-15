/**
 * Translates text to and from Morse code, with the International (Latin) and Russian
 * alphabets, digits and punctuation, and detects whether an input is Morse.
 */

export type MorseAlphabet = "latin" | "cyrillic";

export interface MorseResult {
  output: string;
  /** Characters (encoding) or codes (decoding) with no mapping in the chosen alphabet. */
  unsupported: string[];
}

export interface MorseTimelineUnit {
  tone: boolean;
  ms: number;
}

/** Word separator used on output. Decoding also accepts a bare "/" or 3+ spaces. */
export const WORD_SEPARATOR = "/";

/** Digits and punctuation are identical in both alphabets. */
const SHARED: Record<string, string> = {
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
  ".": ".-.-.-",
  ",": "--..--",
  "?": "..--..",
  "'": ".----.",
  "!": "-.-.--",
  "/": "-..-.",
  "(": "-.--.",
  ")": "-.--.-",
  "&": ".-...",
  ":": "---...",
  ";": "-.-.-.",
  "=": "-...-",
  "+": ".-.-.",
  "-": "-....-",
  _: "..--.-",
  '"': ".-..-.",
  $: "...-..-",
  "@": ".--.-.",
};

const LATIN: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  ...SHARED,
};

/** Russian Morse (ГОСТ). Several codes collide with Latin, hence the explicit alphabet option. */
const CYRILLIC: Record<string, string> = {
  А: ".-",
  Б: "-...",
  В: ".--",
  Г: "--.",
  Д: "-..",
  Е: ".",
  Ж: "...-",
  З: "--..",
  И: "..",
  Й: ".---",
  К: "-.-",
  Л: ".-..",
  М: "--",
  Н: "-.",
  О: "---",
  П: ".--.",
  Р: ".-.",
  С: "...",
  Т: "-",
  У: "..-",
  Ф: "..-.",
  Х: "....",
  Ц: "-.-.",
  Ч: "---.",
  Ш: "----",
  Щ: "--.-",
  Ъ: "--.--",
  Ы: "-.--",
  Ь: "-..-",
  Э: "..-..",
  Ю: "..--",
  Я: ".-.-",
  ...SHARED,
};

/**
 * Encoding is unambiguous (Latin and Cyrillic letters are different characters), so text is
 * encoded against both alphabets at once: "SOS сос" gives SOS twice whatever the alphabet
 * select says. The alphabet only matters when decoding, where codes collide (В = W, Я = …).
 * Russian Morse has no separate Ё: it is sent as Е.
 */
const ENCODE: Record<string, string> = { ...LATIN, ...CYRILLIC, Ё: CYRILLIC.Е };

function encodeMap(alphabet: MorseAlphabet): Record<string, string> {
  return alphabet === "cyrillic" ? CYRILLIC : LATIN;
}

function decodeMap(alphabet: MorseAlphabet): Record<string, string> {
  const source = encodeMap(alphabet);
  const reversed: Record<string, string> = {};
  for (const [char, code] of Object.entries(source)) {
    if (reversed[code] === undefined) reversed[code] = char;
  }
  return reversed;
}

/** Word gaps when decoding: "/" (any number), a line break, or three or more spaces. */
const WORD_GAP = /\s*\/+\s*|\s*\n\s*|\s{3,}/;

/**
 * True when the text is made only of Morse symbols (dots, dashes and their look-alikes,
 * slashes, whitespace) and holds at least two dots/dashes. Used to switch the tool to
 * decoding when someone pastes Morse while it is set to encode.
 */
export function looksLikeMorse(text: string): boolean {
  const t = text.trim();
  if (!/^[\s.\-_·•‧°*‐‑‒–—―−\/]+$/.test(t)) return false;
  return (t.match(/[.\-_·•‧*‐‑‒–—―−]/g) ?? []).length >= 2;
}

const MORSE_SYMBOL = "[.\\-_·•‧*‐‑‒–—―−]";
const MORSE_SYMBOLS = new RegExp(MORSE_SYMBOL, "g");
/** Two symbols with a letter or word gap between them: ". -", "-- / .-". */
const MORSE_LETTER_GAP = new RegExp(`${MORSE_SYMBOL}(?:\\s+|\\s*/+\\s*)${MORSE_SYMBOL}`);

/**
 * Stricter than `looksLikeMorse`, for text typed key by key: at least four dots/dashes,
 * at least one gap between letters, and no letters at all. "..." opening a sentence or a
 * dash in a list is not Morse; "... ---" is. Pasted text can use `looksLikeMorse`.
 */
export function isPlausibleMorse(text: string): boolean {
  if (!looksLikeMorse(text)) return false;
  const t = text.trim();
  return (t.match(MORSE_SYMBOLS) ?? []).length >= 4 && MORSE_LETTER_GAP.test(t);
}

/** Which alphabet a piece of plain text is written in, or null when mixed or neither. */
export function detectAlphabet(text: string): MorseAlphabet | null {
  const cyr = /[А-ЯЁа-яё]/.test(text);
  const lat = /[A-Za-z]/.test(text);
  if (cyr && !lat) return "cyrillic";
  if (lat && !cyr) return "latin";
  return null;
}

/**
 * Accepts unicode dashes and middots so pasted Morse from anywhere decodes cleanly.
 * Underscores and asterisks are included because that is how Morse survives a copy-paste
 * through chat clients and search boxes — "_ _ _ _" is a real thing people paste.
 */
function normalizeMorse(morse: string): string {
  return morse
    .replace(/[‐‑‒–—―−_]/g, "-")
    .replace(/[·•‧°*]/g, ".")
    .trim();
}

/**
 * Encodes Latin and Cyrillic text together. `alphabet` is accepted for symmetry with
 * {@link morseToText} but does not change the result: see {@link ENCODE}.
 */
export function textToMorse(text: string, _alphabet: MorseAlphabet = "latin"): MorseResult {
  if (!text.trim()) return { output: "", unsupported: [] };

  const map = ENCODE;
  const unsupported = new Set<string>();

  const words = text
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const codes: string[] = [];
      for (const char of word) {
        const code = map[char];
        if (code === undefined) {
          unsupported.add(char);
          continue;
        }
        codes.push(code);
      }
      return codes.join(" ");
    })
    .filter((word) => word.length > 0);

  return {
    output: words.join(` ${WORD_SEPARATOR} `),
    unsupported: [...unsupported],
  };
}

export function morseToText(morse: string, alphabet: MorseAlphabet = "latin"): MorseResult {
  const normalized = normalizeMorse(morse);
  if (!normalized) return { output: "", unsupported: [] };

  const map = decodeMap(alphabet);
  const unsupported = new Set<string>();

  const words = normalized.split(WORD_GAP).map((word) =>
    word
      .split(/\s+/)
      .filter(Boolean)
      .map((code) => {
        const char = map[code];
        if (char === undefined) {
          unsupported.add(code);
          return "?";
        }
        return char;
      })
      .join(""),
  );

  return {
    output: words.filter(Boolean).join(" "),
    unsupported: [...unsupported],
  };
}

/**
 * Turns Morse into on/off durations using PARIS timing:
 * dot = 1 unit, dash = 3, intra-character gap = 1, letter gap = 3, word gap = 7.
 */
export function morseToTimeline(morse: string, wpm = 15): MorseTimelineUnit[] {
  const unit = 1200 / Math.max(1, wpm);
  const normalized = normalizeMorse(morse);
  if (!normalized) return [];

  const timeline: MorseTimelineUnit[] = [];
  const words = normalized.split(WORD_GAP).filter((word) => word.trim().length > 0);

  words.forEach((word, wordIndex) => {
    if (wordIndex > 0) timeline.push({ tone: false, ms: unit * 7 });

    const letters = word.split(/\s+/).filter(Boolean);
    letters.forEach((letter, letterIndex) => {
      if (letterIndex > 0) timeline.push({ tone: false, ms: unit * 3 });

      const symbols = [...letter].filter((symbol) => symbol === "." || symbol === "-");
      symbols.forEach((symbol, symbolIndex) => {
        if (symbolIndex > 0) timeline.push({ tone: false, ms: unit });
        timeline.push({ tone: true, ms: symbol === "." ? unit : unit * 3 });
      });
    });
  });

  return timeline;
}

/** Total playback length in milliseconds. */
export function timelineDuration(timeline: MorseTimelineUnit[]): number {
  return timeline.reduce((total, item) => total + item.ms, 0);
}
