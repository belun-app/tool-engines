/**
 * Character statistics of a text: with and without spaces, user-perceived characters,
 * letters by script, digits, spaces, lines, and SMS encoding and segments.
 */

import { segmentGraphemes } from "../_graphemes.js";
import {
  countLines,
  countParagraphs,
  splitSentences,
  splitWords,
  tallyCharacters,
} from "./_text-stats.js";

/**
 * GSM 03.38 basic alphabet — the 128 characters an SMS can carry at 7 bits each.
 * Anything outside it (all Cyrillic, most accented Latin, every emoji) forces the
 * whole message onto UCS-2, which is why a Russian SMS holds 70 characters, not 160.
 */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** The GSM 03.38 extension table: still GSM-7, but each of these costs two units. */
const GSM7_EXTENDED = "^{}\\[~]|€\f";

const GSM7_BASIC_SET = new Set([...GSM7_BASIC]);
const GSM7_EXTENDED_SET = new Set([...GSM7_EXTENDED]);

export type SmsEncoding = "gsm7" | "ucs2";

export interface SmsInfo {
  encoding: SmsEncoding;
  /** Billable units: GSM-7 extension characters count as two. */
  units: number;
  segments: number;
  /** Units that fit in one segment at this encoding and segment count. */
  perSegment: number;
  /** Units still free in the last segment. */
  remaining: number;
}

export interface CharacterCountResult {
  /** Unicode code points — the figure X/Twitter and most platforms count. */
  characters: number;
  charactersNoSpaces: number;
  /** What a reader sees: an emoji family is one grapheme, eight code points. */
  graphemes: number;
  /** JavaScript's `String.length`, i.e. UTF-16 code units. */
  utf16Units: number;
  /** Bytes when encoded as UTF-8 — what byte-limited database columns measure. */
  utf8Bytes: number;
  letters: number;
  /** Letters in the Cyrillic script — the breakdown Russian counters print. */
  cyrillic: number;
  /** Letters in the Latin script. */
  latin: number;
  digits: number;
  spaces: number;
  /** Everything that is neither letter, digit, whitespace nor combining mark. */
  punctuation: number;
  /** Graphemes containing a pictographic code point. */
  emoji: number;
  /** Distinct code points, case-sensitive. */
  uniqueCharacters: number;
  words: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  sms: SmsInfo;
}

const EMPTY_SMS: SmsInfo = {
  encoding: "gsm7",
  units: 0,
  segments: 0,
  perSegment: 160,
  remaining: 160,
};

const EMPTY: CharacterCountResult = {
  characters: 0,
  charactersNoSpaces: 0,
  graphemes: 0,
  utf16Units: 0,
  utf8Bytes: 0,
  letters: 0,
  cyrillic: 0,
  latin: 0,
  digits: 0,
  spaces: 0,
  punctuation: 0,
  emoji: 0,
  uniqueCharacters: 0,
  words: 0,
  sentences: 0,
  paragraphs: 0,
  lines: 0,
  sms: EMPTY_SMS,
};

/** Segment sizes come from the GSM 03.38 / 3GPP 23.040 concatenation headers. */
function measureSms(text: string): SmsInfo {
  let units = 0;
  let gsm7 = true;

  for (const ch of text) {
    if (GSM7_BASIC_SET.has(ch)) {
      units += 1;
    } else if (GSM7_EXTENDED_SET.has(ch)) {
      units += 2;
    } else {
      gsm7 = false;
      break;
    }
  }

  if (!gsm7) {
    // UCS-2 bills per UTF-16 code unit, so an emoji outside the BMP costs two.
    const ucs2Units = text.length;
    const single = ucs2Units <= 70;
    const perSegment = single ? 70 : 67;
    const segments = single ? 1 : Math.ceil(ucs2Units / 67);
    return {
      encoding: "ucs2",
      units: ucs2Units,
      segments,
      perSegment,
      remaining: segments * perSegment - ucs2Units,
    };
  }

  const single = units <= 160;
  const perSegment = single ? 160 : 153;
  const segments = single ? 1 : Math.ceil(units / 153);
  return {
    encoding: "gsm7",
    units,
    segments,
    perSegment,
    remaining: segments * perSegment - units,
  };
}

export function countCharacters(text: string): CharacterCountResult {
  if (!text) return { ...EMPTY, sms: { ...EMPTY_SMS } };

  const codePoints = [...text];
  const graphemes = segmentGraphemes(text);
  // Letters, spaces, sentences, paragraphs and lines come from the module the word
  // counter uses too, so the two tools can never print different totals for one text.
  const tally = tallyCharacters(text);

  return {
    characters: tally.characters,
    charactersNoSpaces: tally.charactersNoSpaces,
    graphemes: graphemes.length,
    utf16Units: text.length,
    utf8Bytes: new TextEncoder().encode(text).length,
    letters: tally.letters,
    cyrillic: tally.cyrillic,
    latin: tally.latin,
    digits: tally.digits,
    spaces: tally.spaces,
    punctuation: tally.punctuation,
    emoji: graphemes.filter((g) => /\p{Extended_Pictographic}/u.test(g)).length,
    uniqueCharacters: new Set(codePoints).size,
    words: splitWords(text).length,
    sentences: splitSentences(text).length,
    paragraphs: countParagraphs(text),
    lines: countLines(text),
    sms: measureSms(text),
  };
}
