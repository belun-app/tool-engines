/**
 * Lorem ipsum placeholder text: a number of paragraphs with an exact word count each,
 * optionally opening with the classic "Lorem ipsum dolor sit amet" sentence.
 */
import { type RandomSource, hasSecureRandom, randomInt } from "../_random.js";

export interface LoremIpsumResult {
  text: string;
  paragraphCount: number;
  wordCount: number;
  /** True when a paragraph or word count was outside the limits below, fractional or not a number. */
  clamped: boolean;
  /** "no-secure-random" when there is no Web Crypto and no `rng` (text is then empty). */
  error: "" | "no-secure-random";
}

export interface LoremIpsumOptions {
  /** Source of random 32-bit words; defaults to `crypto.getRandomValues` (see `_random`). */
  rng?: RandomSource;
}

export const MIN_PARAGRAPHS = 1;
export const MAX_PARAGRAPHS = 20;
export const MIN_WORDS_PER_PARAGRAPH = 10;
export const MAX_WORDS_PER_PARAGRAPH = 500;

const WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "do",
  "eiusmod",
  "tempor",
  "incididunt",
  "ut",
  "labore",
  "et",
  "dolore",
  "magna",
  "aliqua",
  "enim",
  "ad",
  "minim",
  "veniam",
  "quis",
  "nostrud",
  "exercitation",
  "ullamco",
  "laboris",
  "nisi",
  "aliquip",
  "ex",
  "ea",
  "commodo",
  "consequat",
  "duis",
  "aute",
  "irure",
  "in",
  "reprehenderit",
  "voluptate",
  "velit",
  "esse",
  "cillum",
  "eu",
  "fugiat",
  "nulla",
  "pariatur",
  "excepteur",
  "sint",
  "occaecat",
  "cupidatat",
  "non",
  "proident",
  "sunt",
  "culpa",
  "qui",
  "officia",
  "deserunt",
  "mollit",
  "anim",
  "id",
  "est",
  "laborum",
  "perspiciatis",
  "unde",
  "omnis",
  "iste",
  "natus",
  "error",
  "accusantium",
  "doloremque",
  "laudantium",
  "totam",
  "rem",
  "aperiam",
  "eaque",
  "ipsa",
  "ab",
  "illo",
  "inventore",
  "veritatis",
  "quasi",
  "architecto",
  "beatae",
  "vitae",
  "dicta",
  "explicabo",
  "nemo",
  "voluptatem",
  "quia",
  "voluptas",
  "aspernatur",
  "odit",
  "fugit",
  "consequuntur",
  "magni",
  "dolores",
  "eos",
  "ratione",
  "sequi",
  "nesciunt",
  "neque",
  "porro",
  "quisquam",
  "numquam",
  "eius",
  "modi",
  "tempora",
  "incidunt",
  "magnam",
  "quaerat",
];

const CLASSIC_START =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

const CLASSIC_WORD_COUNT = 19;

function buildSentences(targetWords: number, rng: RandomSource | undefined): string {
  const randomWord = () => WORDS[randomInt(WORDS.length, rng)];
  const sentences: string[] = [];
  let used = 0;

  while (used < targetWords) {
    const remaining = targetWords - used;
    const len = Math.min(remaining, randomInt(12, rng) + 7);
    if (len < 4) {
      if (sentences.length > 0) {
        const extra = Array.from({ length: remaining }, randomWord).join(" ");
        sentences[sentences.length - 1] =
          `${sentences[sentences.length - 1].slice(0, -1)}, ${extra}.`;
      }
      break;
    }
    const words = Array.from({ length: len }, randomWord);
    words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    sentences.push(`${words.join(" ")}.`);
    used += len;
  }

  return sentences.join(" ");
}

const clamp = (value: number, fallback: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(value) ? Math.round(value) : fallback));

/**
 * Generate `paragraphs` paragraphs of exactly `wordsPerParagraph` words each. Counts are
 * rounded and clamped to MIN..MAX_PARAGRAPHS and MIN..MAX_WORDS_PER_PARAGRAPH (a
 * non-numeric count falls back to the default); `clamped` says when that happened.
 */
export function generateLoremIpsum(
  paragraphs = 3,
  wordsPerParagraph = 100,
  startWithLoremIpsum = true,
  options: LoremIpsumOptions = {},
): LoremIpsumResult {
  const paraCount = clamp(paragraphs, 3, MIN_PARAGRAPHS, MAX_PARAGRAPHS);
  const wpp = clamp(wordsPerParagraph, 100, MIN_WORDS_PER_PARAGRAPH, MAX_WORDS_PER_PARAGRAPH);
  const clamped = paraCount !== paragraphs || wpp !== wordsPerParagraph;
  const rng = options.rng;
  if (!rng && !hasSecureRandom()) {
    return { text: "", paragraphCount: 0, wordCount: 0, clamped, error: "no-secure-random" };
  }
  const randomWord = () => WORDS[randomInt(WORDS.length, rng)];

  const parts: string[] = [];

  for (let i = 0; i < paraCount; i++) {
    if (i === 0 && startWithLoremIpsum) {
      // The classic opening is 19 words; the paragraph still gets exactly wpp words.
      const remaining = wpp - CLASSIC_WORD_COUNT;
      if (remaining >= 4) {
        parts.push(`${CLASSIC_START} ${buildSentences(remaining, rng)}`);
      } else if (remaining > 0) {
        const extra = Array.from({ length: remaining }, randomWord).join(" ");
        parts.push(`${CLASSIC_START.slice(0, -1)}, ${extra}.`);
      } else {
        const words = CLASSIC_START.split(" ").slice(0, wpp).join(" ");
        parts.push(`${words.replace(/[,.]$/, "")}.`);
      }
    } else {
      parts.push(buildSentences(wpp, rng));
    }
  }

  const text = parts.join("\n\n");
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  return { text, paragraphCount: paraCount, wordCount, clamped, error: "" };
}
