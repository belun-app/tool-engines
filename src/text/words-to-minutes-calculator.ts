/**
 * Speaking time of a script from its word count at a slow, average or fast pace, or the
 * number of words that fit a given time.
 */

export type SpeechPaceKey = "slow" | "average" | "fast";
export type SpeechDirection = "wordsToTime" | "timeToWords";

/**
 * Words per minute for the three reference paces. The band is the one speech coaches
 * quote: audiobook narration and ceremonial reading sit near 110, a conference talk
 * lands around 140, and radio or podcast delivery reaches 180. Toastmasters uses 125–150
 * as its "comfortable" window, which straddles the average column.
 */
export const SPEECH_PACE_WPM: Record<SpeechPaceKey, number> = {
  slow: 110,
  average: 140,
  fast: 180,
};

/**
 * Silent reading of continuous English prose, from Brysbaert's 2019 meta-analysis of
 * 190 studies. Silent reading runs roughly 70% faster than reading the same text aloud.
 */
export const SILENT_READING_WPM = 238;

/**
 * Silent reading of Russian prose: 184 words per minute in the IReST study
 * (Trauzettel-Klosinski & Dietz, 2012), which measured the same texts in 17 languages.
 * Russian words are longer than English ones, so fewer of them fit in a minute.
 */
export const SILENT_READING_WPM_RU = 184;

/**
 * Characters (with spaces) per Russian word in running text: an average word of about
 * 5.3 letters plus the space and punctuation after it. Used to turn a character count —
 * the unit Russian texts are usually ordered in — into words.
 */
export const CHARS_PER_WORD_RU = 6.5;

/** A double-spaced 12 pt manuscript page — the unit speech scripts are printed in. */
export const WORDS_PER_SCRIPT_PAGE = 250;

export const MIN_WPM = 50;
export const MAX_WPM = 400;

export interface SpeechPaceTime {
  wpm: number;
  totalSeconds: number;
  /** Whole hours; zero for anything under an hour. */
  hours: number;
  /** Whole minutes after hours are taken out. */
  minutes: number;
  seconds: number;
  /** Locale-neutral clock, `m:ss` or `h:mm:ss`. */
  clock: string;
}

export interface WordsToMinutesResult {
  direction: SpeechDirection;
  /** Word count the timings are based on. */
  words: number;
  characters: number;
  /** Pace used for the headline figure. */
  wpm: number;
  headline: SpeechPaceTime;
  slow: SpeechPaceTime;
  average: SpeechPaceTime;
  fast: SpeechPaceTime;
  silentReading: SpeechPaceTime;
  /** Double-spaced manuscript pages at 250 words per page. */
  scriptPages: number;
  /** In time-to-words mode: how many words each pace needs to fill the target. */
  wordsAtSlow: number;
  wordsAtAverage: number;
  wordsAtFast: number;
}

export interface WordsToMinutesInput {
  direction: SpeechDirection;
  /** Script text; when present it overrides `words`. */
  text?: string;
  /** Explicit word count, used when no text is pasted. */
  words?: number;
  /** Target duration for `timeToWords`. */
  targetSeconds?: number;
  /** Delivery pace for the headline figure. Clamped to 50–400. */
  wpm?: number;
  /** Silent-reading pace; defaults to {@link SILENT_READING_WPM} (English prose). */
  readingWpm?: number;
}

function paceTime(words: number, wpm: number): SpeechPaceTime {
  const safeWpm = clampWpm(wpm);
  // A single word still takes time to say: never round a non-empty script down to 0:00.
  const totalSeconds = words > 0 ? Math.max(1, Math.round((words / safeWpm) * 60)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, "0");
  const clock =
    hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
  return { wpm: safeWpm, totalSeconds, hours, minutes, seconds, clock };
}

export function clampWpm(wpm: number | undefined): number {
  if (!Number.isFinite(wpm) || wpm === undefined) return SPEECH_PACE_WPM.average;
  return Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(wpm)));
}

/**
 * Words in a spoken script. Same whitespace split the Word Counter uses, with one
 * difference that matters when timing: a token with no letter or digit in it — a lone
 * dash used as a beat marker, a row of dots — is not said out loud, so it is not timed.
 */
export function countSpeechWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((token) => /[\p{L}\p{Nd}]/u.test(token)).length;
}

/** Words needed to fill `totalSeconds` at `wpm`, rounded to the nearest whole word. */
function wordsForSeconds(totalSeconds: number, wpm: number): number {
  if (totalSeconds <= 0) return 0;
  return Math.round((totalSeconds / 60) * clampWpm(wpm));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function wordsToMinutes(input: WordsToMinutesInput): WordsToMinutesResult {
  const direction: SpeechDirection =
    input.direction === "timeToWords" ? "timeToWords" : "wordsToTime";
  const wpm = clampWpm(input.wpm);

  const text = input.text ?? "";
  const hasText = text.trim().length > 0;
  const targetSeconds =
    Number.isFinite(input.targetSeconds) && (input.targetSeconds ?? 0) > 0
      ? Math.round(input.targetSeconds as number)
      : 0;

  let words: number;
  let characters: number;

  if (direction === "timeToWords") {
    words = wordsForSeconds(targetSeconds, wpm);
    characters = 0;
  } else if (hasText) {
    words = countSpeechWords(text);
    characters = text.length;
  } else {
    const given = input.words;
    words = Number.isFinite(given) && (given ?? 0) > 0 ? Math.floor(given as number) : 0;
    characters = 0;
  }

  // In time-to-words mode the target duration is the answer the user already gave us,
  // so the headline must echo it exactly rather than round-tripping through word count.
  const headline =
    direction === "timeToWords" ? { wpm, ...splitSeconds(targetSeconds) } : paceTime(words, wpm);

  return {
    direction,
    words,
    characters,
    wpm,
    headline,
    slow: paceTime(words, SPEECH_PACE_WPM.slow),
    average: paceTime(words, SPEECH_PACE_WPM.average),
    fast: paceTime(words, SPEECH_PACE_WPM.fast),
    silentReading: paceTime(words, input.readingWpm ?? SILENT_READING_WPM),
    scriptPages: words > 0 ? round1(words / WORDS_PER_SCRIPT_PAGE) : 0,
    wordsAtSlow: wordsForSeconds(targetSeconds, SPEECH_PACE_WPM.slow),
    wordsAtAverage: wordsForSeconds(targetSeconds, SPEECH_PACE_WPM.average),
    wordsAtFast: wordsForSeconds(targetSeconds, SPEECH_PACE_WPM.fast),
  };
}

function splitSeconds(totalSeconds: number): Omit<SpeechPaceTime, "wpm"> {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  const clock =
    hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
  return { totalSeconds: total, hours, minutes, seconds, clock };
}

/**
 * Target duration in seconds from the minutes and seconds fields. Negative parts count as
 * zero (a "-30" in the seconds box must not shorten a 5-minute slot); seconds above 59
 * are allowed and roll over, so 0:90 is a minute and a half.
 */
export function targetSecondsFrom(minutes: number, seconds: number): number {
  const m = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return m * 60 + s;
}

/** Words in a text of `characters` characters (with spaces), for languages ordered by size. */
export function wordsFromCharacters(characters: number, charsPerWord = CHARS_PER_WORD_RU): number {
  if (!Number.isFinite(characters) || characters <= 0) return 0;
  return Math.round(characters / charsPerWord);
}

/**
 * Reads a number typed the way people write it in the page language. English: "1,000"
 * and "2.5". Russian: "1 000" and "2,5" (a comma is the decimal separator, so "1,5" is
 * one and a half, never 15). Returns NaN for anything that is not a number.
 */
export function parseLocaleNumber(raw: string, lang: "en" | "ru"): number {
  // \s also matches the no-break and narrow no-break spaces of "1 000".
  let t = raw.trim().replace(/[\s']/g, "");
  if (!t) return Number.NaN;
  if (lang === "ru") t = t.replace(",", ".");
  else t = t.replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return Number.NaN;
  return Number.parseFloat(t);
}
