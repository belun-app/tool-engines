/**
 * Word cloud from a text: word weights without stop words, and a layout that places the
 * words on an Archimedean spiral, biggest first, without overlaps.
 */

import { graphemeLength, segmentGraphemes } from "../_graphemes.js";
import { STOP_WORDS } from "../text/_stop-words.js";

export interface WordCloudEntry {
  word: string;
  count: number;
  /** Normalized 0..1, where 1 is the most frequent word */
  weight: number;
}

export interface WordCloudResult {
  entries: WordCloudEntry[];
  totalWords: number;
  uniqueWords: number;
}

export interface WordCloudOptions {
  /** Maximum number of distinct words to keep, ranked by frequency */
  maxWords?: number;
  /** Minimum word length (letters/digits only, ignoring internal punctuation) to include */
  minWordLength?: number;
  /** Drop common English and Russian function words (the, and, of, и, в, на, ...) */
  excludeStopWords?: boolean;
  caseSensitive?: boolean;
  /**
   * Locale (BCP 47) used to break ties alphabetically. Default: the host's default locale,
   * so tie order can differ between machines; pass a locale for reproducible output.
   */
  locale?: string | string[];
}

/** String comparison for the locale; an invalid locale falls back to the host default. */
function textCompare(locale?: string | string[]): (a: string, b: string) => number {
  try {
    return new Intl.Collator(locale).compare;
  } catch {
    return new Intl.Collator().compare;
  }
}

const HAS_MARK = /\p{M}/u;

/** Letters in a word as a reader counts them (graphemes), ignoring ' ’ and -. */
function letterCount(word: string): number {
  const letters = word.replace(/['’-]/g, "");
  // Fast path: without combining marks, code points are graphemes.
  return HAS_MARK.test(letters) ? graphemeLength(letters) : [...letters].length;
}

/** Stop-word check, case-insensitive and with typographic apostrophes (’) read as '. */
function isStopWord(word: string): boolean {
  const w = word.toLowerCase().replace(/’/g, "'");
  return STOP_WORDS.has(w) || STOP_WORDS.has(w.replace(/ё/g, "е"));
}

export function buildWordCloud(text: string, options: WordCloudOptions = {}): WordCloudResult {
  const {
    maxWords = 60,
    minWordLength = 2,
    excludeStopWords = true,
    caseSensitive = false,
    locale,
  } = options;
  const compare = textCompare(locale);

  // Combining marks (stress marks, decomposed accents) stay inside the word.
  const matches =
    text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’-][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu) ?? [];
  const words = matches
    .map((w) => (caseSensitive ? w : w.toLowerCase()))
    .filter((w) => letterCount(w) >= Math.max(1, minWordLength))
    .filter((w) => !excludeStopWords || !isStopWord(w));

  if (words.length === 0) {
    return { entries: [], totalWords: 0, uniqueWords: 0 };
  }

  // «ещё» and «еще» are one word spelled two ways: count them together under ё → е and
  // show the spelling the text uses most (the first one seen on a tie).
  const counts = new Map<string, { count: number; forms: Map<string, number> }>();
  for (const word of words) {
    const key = word.replace(/ё/g, "е").replace(/Ё/g, "Е");
    let slot = counts.get(key);
    if (!slot) {
      slot = { count: 0, forms: new Map() };
      counts.set(key, slot);
    }
    slot.count += 1;
    slot.forms.set(word, (slot.forms.get(word) ?? 0) + 1);
  }

  const shown = (forms: Map<string, number>): string => {
    let best = "";
    let bestCount = 0;
    for (const [form, n] of forms) {
      if (n > bestCount) {
        best = form;
        bestCount = n;
      }
    }
    return best;
  };

  const sorted: Array<[string, number]> = [...counts.values()]
    .map((slot): [string, number] => [shown(slot.forms), slot.count])
    .sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
  const top = sorted.slice(0, Math.max(1, Math.round(maxWords)));
  const maxCount = top[0]?.[1] ?? 1;

  const entries: WordCloudEntry[] = top.map(([word, count]) => ({
    word,
    count,
    weight: count / maxCount,
  }));

  return { entries, totalWords: words.length, uniqueWords: sorted.length };
}

export interface CloudRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CloudPlacement extends CloudRect {
  word: string;
  fontSize: number;
  /** Rank of the word in `entries` (0 = most frequent), for colouring. */
  index: number;
}

export interface CloudLayoutOptions {
  width: number;
  height: number;
  minFont: number;
  maxFont: number;
  /** Width of `word` drawn bold at `fontSize` px (canvas `measureText` in the browser). */
  measure: (word: string, fontSize: number) => number;
  /** Same seed, same picture: a palette change redraws the layout instead of reshuffling. */
  seed?: number;
}

export interface CloudLayout {
  placements: CloudPlacement[];
  /** Words that did not fit even at the smallest size. */
  dropped: number;
}

/** Small deterministic PRNG (mulberry32): the layout only needs a repeatable spread. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function overlaps(a: CloudRect, b: CloudRect, pad: number): boolean {
  return !(
    a.x + a.w + pad < b.x ||
    b.x + b.w + pad < a.x ||
    a.y + a.h + pad < b.y ||
    b.y + b.h + pad < a.y
  );
}

/** Archimedean spiral from the centre; the first free spot inside the frame wins. */
function spiralPlace(
  w: number,
  h: number,
  width: number,
  height: number,
  placed: CloudRect[],
  random: () => number,
): CloudRect | null {
  const cx = width / 2;
  const cy = height / 2;
  // An ellipse with the frame's proportions fills a wide or a tall frame alike.
  const squash = height / width;
  let angle = random() * Math.PI * 2;
  let radius = 0;
  const angleStep = 0.28;
  const radiusStep = Math.max(0.5, width / 1000);
  const maxRadius = Math.hypot(width, height) / 2 / Math.min(1, squash) + w;

  while (radius <= maxRadius) {
    const x = cx + radius * Math.cos(angle) - w / 2;
    const y = cy + radius * Math.sin(angle) * squash - h / 2;
    if (x >= 2 && y >= 2 && x + w <= width - 2 && y + h <= height - 2) {
      const rect: CloudRect = { x, y, w, h };
      let free = true;
      for (let i = placed.length - 1; i >= 0; i--) {
        if (overlaps(rect, placed[i], 2)) {
          free = false;
          break;
        }
      }
      if (free) return rect;
    }
    angle += angleStep;
    radius += radiusStep;
  }
  return null;
}

/**
 * Places the words on the frame, biggest first. Font size grows with the square root of
 * the weight between `minFont` and `maxFont`; a single most frequent word keeps `maxFont`.
 * When some words do not fit, every other word is shrunk step by step and the layout is
 * tried again, so a long text never loses words silently. A word wider than the frame is
 * scaled down to fit it (not below 6 px); the most frequent word is always in the picture,
 * cut with "…" if it is still too wide at 6 px.
 */
export function layoutCloud(entries: WordCloudEntry[], options: CloudLayoutOptions): CloudLayout {
  const { width, height, minFont, maxFont, measure, seed = 1 } = options;
  if (entries.length === 0) return { placements: [], dropped: 0 };

  const soleTop = entries.length === 1 || entries[0].count > entries[1].count;
  const maxWidth = width - 8;
  const maxHeight = height - 8;

  /**
   * The most frequent word must be in the picture. Still too wide at 6 px (a very long
   * word in a narrow frame, or a measure that rounds up), it first loses a pixel at a
   * time down to 6 px, then is cut with "…" to the longest prefix that fits; only a
   * frame too narrow even for one letter and "…" makes it smaller than 6 px.
   */
  const fitTopWord = (word: string, start: number) => {
    let fontSize = start;
    let w = measure(word, fontSize);
    while (w > maxWidth && fontSize > 6) w = measure(word, --fontSize);
    if (w <= maxWidth) return { label: word, fontSize, w };
    const chars = segmentGraphemes(word);
    const cut = (k: number) => `${chars.slice(0, k).join("")}…`;
    let lo = 1;
    let hi = chars.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (measure(cut(mid), fontSize) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    const label = cut(lo);
    w = measure(label, fontSize);
    while (w > maxWidth && fontSize > 1) w = measure(label, --fontSize);
    return { label, fontSize, w };
  };

  const attempt = (spread: number, last: boolean): CloudLayout | null => {
    const random = mulberry32(seed);
    const placed: CloudRect[] = [];
    const placements: CloudPlacement[] = [];
    let dropped = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const full = i === 0 && soleTop ? 1 : spread;
      let fontSize = Math.round(minFont + Math.sqrt(entry.weight) * (maxFont - minFont) * full);
      fontSize = Math.min(fontSize, Math.floor(maxHeight));
      let label = entry.word;
      let w = measure(label, fontSize);
      if (w > maxWidth) {
        // Too wide for the frame at this size: shrink it until it fits (not below 6 px).
        fontSize = Math.max(6, Math.floor((fontSize * maxWidth) / w));
        w = measure(label, fontSize);
      }
      if (i === 0 && w > maxWidth) ({ label, fontSize, w } = fitTopWord(label, fontSize));
      const rect = w <= maxWidth ? spiralPlace(w, fontSize, width, height, placed, random) : null;
      if (!rect) {
        if (!last) return null;
        dropped++;
        continue;
      }
      placed.push(rect);
      placements.push({ ...rect, word: label, fontSize, index: i });
    }
    return { placements, dropped };
  };

  const spreads = [1, 0.8, 0.64, 0.5, 0.38, 0.28, 0.18, 0.1, 0.04, 0];
  for (let s = 0; s < spreads.length; s++) {
    const result = attempt(spreads[s], s === spreads.length - 1);
    if (result) return result;
  }
  return { placements: [], dropped: entries.length };
}
