/**
 * Splits text into user-perceived characters (extended grapheme clusters), with
 * Intl.Segmenter or a built-in fallback.
 *
 * Splits text into user-perceived characters (extended grapheme clusters), so
 * emoji with skin tones, ZWJ families, flags, keycaps, VS16 presentation and
 * combining accents ("моло\u0301ко", "é" written as e + U+0301) stay whole.
 *
 * Uses `Intl.Segmenter` (every evergreen browser since Firefox 125, Node 16+).
 * Without it, a regex fallback joins the common cluster types: combining
 * marks, variation selectors, skin-tone modifiers, ZWJ sequences, emoji tags
 * and regional-indicator pairs. The fallback is not full UAX #29 (Hangul
 * jamo, Indic conjuncts), but it never splits a surrogate pair.
 */

let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
  }
  return segmenter;
}

// Characters that attach to the previous one.
const MARK = /^\p{M}$/u;

function isExtend(cp: string): boolean {
  if (MARK.test(cp)) return true;
  const c = cp.codePointAt(0) ?? 0;
  return (
    c === 0x200c || // ZWNJ
    c === 0x20e3 || // combining enclosing keycap
    (c >= 0xfe00 && c <= 0xfe0f) || // variation selectors (VS16 = emoji presentation)
    (c >= 0x1f3fb && c <= 0x1f3ff) || // skin-tone modifiers
    (c >= 0xe0020 && c <= 0xe007f) // emoji tag sequences (subdivision flags)
  );
}
const ZWJ = "\u200d";
const REGIONAL_INDICATOR = /[\u{1f1e6}-\u{1f1ff}]/u;

/** Fallback segmentation; exported for tests. */
export function segmentGraphemesFallback(text: string): string[] {
  const out: string[] = [];
  const cps = [...text];
  let i = 0;
  while (i < cps.length) {
    let cluster = cps[i];
    // CR LF is one cluster.
    if (cps[i] === "\r" && cps[i + 1] === "\n") {
      out.push("\r\n");
      i += 2;
      continue;
    }
    if (REGIONAL_INDICATOR.test(cps[i]) && cps[i + 1] && REGIONAL_INDICATOR.test(cps[i + 1])) {
      cluster += cps[i + 1];
      i += 2;
    } else {
      i += 1;
    }
    while (i < cps.length) {
      const cp = cps[i];
      if (isExtend(cp)) {
        cluster += cp;
        i += 1;
      } else if (cp === ZWJ && i + 1 < cps.length) {
        cluster += cp + cps[i + 1];
        i += 2;
      } else if (cp === ZWJ) {
        cluster += cp;
        i += 1;
      } else {
        break;
      }
    }
    out.push(cluster);
  }
  return out;
}

export function segmentGraphemes(text: string): string[] {
  if (!text) return [];
  const seg = getSegmenter();
  if (!seg) return segmentGraphemesFallback(text);
  return Array.from(seg.segment(text), (s) => s.segment);
}

/** Number of user-perceived characters. */
export function graphemeLength(text: string): number {
  if (!text) return 0;
  const seg = getSegmenter();
  if (!seg) return segmentGraphemesFallback(text).length;
  let n = 0;
  for (const _ of seg.segment(text)) n++;
  return n;
}

/** First `count` user-perceived characters. */
export function sliceGraphemes(text: string, count: number): string {
  return segmentGraphemes(text).slice(0, Math.max(0, count)).join("");
}
