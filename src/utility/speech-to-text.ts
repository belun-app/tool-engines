/**
 * Transcript assembly and formatting for the Speech to Text tool.
 *
 * The Web Speech API lives in the browser, so recognition itself belongs in the
 * mount. What is testable — and what every dictation tool gets subtly wrong — is
 * what happens to the words after they arrive: joining a final chunk to what came
 * before without doubling spaces, capitalising after a full stop, turning spoken
 * "comma" and "new paragraph" into actual punctuation, and counting the result.
 */

export interface TranscriptStats {
  words: number;
  characters: number;
  /** Lines with at least one non-whitespace character. */
  lines: number;
  /** Spoken length in seconds, from the dictation clock. */
  seconds: number;
  /** Words per minute over the elapsed dictation time, 0 until a few seconds in. */
  wordsPerMinute: number;
}

export interface LanguageOption {
  /** BCP-47 tag handed to SpeechRecognition.lang */
  code: string;
  /** English label */
  label: string;
  /** Russian label */
  labelRu: string;
}

/**
 * Languages the Chrome/Edge speech service handles well, kept to a list a person
 * can actually scan. The full Google set runs past 100 entries, most of which are
 * regional variants that behave identically.
 */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: "en-US", label: "English (US)", labelRu: "Английский (США)" },
  { code: "en-GB", label: "English (UK)", labelRu: "Английский (Великобритания)" },
  { code: "ru-RU", label: "Russian", labelRu: "Русский" },
  { code: "uk-UA", label: "Ukrainian", labelRu: "Украинский" },
  { code: "de-DE", label: "German", labelRu: "Немецкий" },
  { code: "fr-FR", label: "French", labelRu: "Французский" },
  { code: "es-ES", label: "Spanish (Spain)", labelRu: "Испанский (Испания)" },
  { code: "es-MX", label: "Spanish (Mexico)", labelRu: "Испанский (Мексика)" },
  { code: "pt-BR", label: "Portuguese (Brazil)", labelRu: "Португальский (Бразилия)" },
  { code: "it-IT", label: "Italian", labelRu: "Итальянский" },
  { code: "pl-PL", label: "Polish", labelRu: "Польский" },
  { code: "nl-NL", label: "Dutch", labelRu: "Нидерландский" },
  { code: "tr-TR", label: "Turkish", labelRu: "Турецкий" },
  { code: "ar-SA", label: "Arabic", labelRu: "Арабский" },
  { code: "hi-IN", label: "Hindi", labelRu: "Хинди" },
  { code: "zh-CN", label: "Chinese (Mandarin)", labelRu: "Китайский (мандарин)" },
  { code: "ja-JP", label: "Japanese", labelRu: "Японский" },
  { code: "ko-KR", label: "Korean", labelRu: "Корейский" },
  { code: "kk-KZ", label: "Kazakh", labelRu: "Казахский" },
  { code: "he-IL", label: "Hebrew", labelRu: "Иврит" },
];

/** Pick the closest supported language for a page locale, defaulting to en-US. */
export function defaultLanguage(locale: string): string {
  const tag = (locale || "en").toLowerCase();
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === tag);
  if (exact) return exact.code;
  const prefix = tag.split("-")[0];
  const byPrefix = LANGUAGES.find((l) => l.code.toLowerCase().startsWith(`${prefix}-`));
  return byPrefix ? byPrefix.code : "en-US";
}

/** Languages written right to left — the textarea needs dir="rtl" for these. */
const RTL_PREFIXES = ["ar", "he", "fa", "ur"];

export function isRightToLeft(code: string): boolean {
  const prefix = (code || "").toLowerCase().split("-")[0];
  return RTL_PREFIXES.includes(prefix);
}

/**
 * Spoken punctuation commands, in English and Russian. Dragon and Google Docs
 * voice typing both support these and people expect them; the raw Web Speech
 * result does not insert them.
 *
 * Order matters: two-word phrases have to be tried before one-word ones, or
 * "new paragraph" gets eaten by "new line".
 */
const COMMAND_PHRASES: ReadonlyArray<readonly [string[], string]> = [
  [["new paragraph", "новый абзац", "абзац"], "\n\n"],
  [["new line", "newline", "новая строка", "с новой строки"], "\n"],
  [["question mark", "вопросительный знак"], "?"],
  [["exclamation (?:mark|point)", "восклицательный знак"], "!"],
  [["open (?:quote|quotes)", "открыть кавычки"], "«"],
  [["close (?:quote|quotes)", "закрыть кавычки"], "»"],
  [["open paren(?:thesis)?", "открыть скобку"], "("],
  [["close paren(?:thesis)?", "закрыть скобку"], ")"],
  [["semicolon", "точка с запятой"], ";"],
  [["colon", "двоеточие"], ":"],
  [["ellipsis", "многоточие"], "…"],
  [["dash", "тире"], "—"],
  [["hyphen", "дефис"], "-"],
  [["full stop", "period", "точка"], "."],
  [["comma", "запятая"], ","],
];

/**
 * JS `\b` only knows ASCII word characters, so it never matches around a Cyrillic
 * word. The phrases are wrapped in Unicode-aware look-arounds instead.
 */
const COMMANDS: ReadonlyArray<readonly [RegExp, string]> = COMMAND_PHRASES.map(
  ([phrases, mark]) =>
    [
      new RegExp(`(?<![\\p{L}\\p{N}_])(?:${phrases.join("|")})(?![\\p{L}\\p{N}_])`, "giu"),
      mark,
    ] as const,
);

/*
 * The space-trimming patterns below start only where a run of spaces and tabs starts
 * (`(?<![ \t])`). Without that, a long run that is not followed by the expected
 * character is rescanned from every position inside it, which is quadratic.
 */

/**
 * Replace spoken punctuation names with the characters they stand for.
 *
 * The space before a mark is swallowed ("word comma" → "word,") and the mark
 * keeps whatever space followed it, so the result reads like typed text.
 */
export function applySpokenPunctuation(text: string): string {
  let out = text;
  for (const [pattern, replacement] of COMMANDS) {
    out = out.replace(pattern, replacement);
  }
  // "hello , world" → "hello, world"; newlines lose their surrounding spaces entirely.
  out = out.replace(/(?<![ \t])[ \t]+([,.;:!?…»)])/g, "$1");
  out = out.replace(/([(«])[ \t]+/g, "$1");
  out = out.replace(/(?<![ \t])[ \t]*\n[ \t]*/g, "\n");
  return out;
}

/** Spaces and tabs removed from both ends (other whitespace, such as newlines, stays). */
function trimSpaces(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && (text[start] === " " || text[start] === "\t")) start++;
  while (end > start && (text[end - 1] === " " || text[end - 1] === "\t")) end--;
  return text.slice(start, end);
}

/** Spaces and tabs removed from the end. */
function trimSpacesEnd(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === " " || text[end - 1] === "\t")) end--;
  return text.slice(0, end);
}

const WHITESPACE = /\s/;
const LOWERCASE = /\p{Ll}/u;
const SENTENCE_MARK = /[.!?…]/;

/**
 * Capitalise the first letter of the text and of anything after . ! ? … followed by
 * whitespace, or after a newline (and any whitespace). One pass over the text.
 */
export function capitalizeSentences(text: string): string {
  let out = "";
  let first = true;
  let gap = 0; // whitespace characters since the last other character
  let newline = false; // the current whitespace run contains a newline
  let mark = false; // the last other character was a sentence mark
  for (const ch of text) {
    if (WHITESPACE.test(ch)) {
      gap++;
      if (ch === "\n") newline = true;
      out += ch;
      first = false;
      continue;
    }
    const start = first || newline || (mark && gap > 0);
    out += start && LOWERCASE.test(ch) ? ch.toUpperCase() : ch;
    mark = SENTENCE_MARK.test(ch);
    first = false;
    gap = 0;
    newline = false;
  }
  return out;
}

export interface AppendOptions {
  /** Convert spoken "comma", "new paragraph" and friends into punctuation. */
  spokenPunctuation?: boolean;
  /** Capitalise sentence starts. */
  autoCapitalize?: boolean;
}

/**
 * Append a finalised recognition chunk to the transcript so far.
 *
 * Recognition results arrive without leading spaces and without regard for what
 * is already on screen, so naive concatenation produces either "wordword" or a
 * run of double spaces. A chunk that starts with punctuation must not be pushed
 * away from the word it belongs to, and a chunk that begins a paragraph must not
 * inherit a stray space.
 */
export function appendChunk(
  transcript: string,
  chunk: string,
  options: AppendOptions = {},
): string {
  let piece = chunk.replace(/\s+/g, " ").trim();
  if (!piece) return transcript;

  if (options.spokenPunctuation) piece = applySpokenPunctuation(piece);
  // Trim spaces only: a "new paragraph" said at the start or end of a chunk (after a
  // pause, the usual case) leaves a newline there that must survive.
  piece = trimSpaces(piece);
  if (!piece) return transcript;

  const base = trimSpacesEnd(transcript);
  let joined: string;
  if (!base) {
    joined = piece.replace(/^\n+/, "");
  } else if (base.endsWith("\n") || piece.startsWith("\n")) {
    joined = base + piece;
  } else if (/^[,.;:!?…»)]/.test(piece)) {
    joined = base + piece;
  } else if (/[(«]$/.test(base)) {
    joined = base + piece;
  } else {
    joined = `${base} ${piece}`;
  }

  // Collapse an accidental third blank line but keep a real paragraph break.
  joined = joined.replace(/\n{3,}/g, "\n\n");

  return options.autoCapitalize ? capitalizeSentences(joined) : joined;
}

/** Word count, character count and live dictation pace. */
export function analyzeTranscript(text: string, elapsedSeconds = 0): TranscriptStats {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const seconds = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
  // Below ~5 seconds the rate swings wildly, so hold it at zero rather than print noise.
  const wordsPerMinute = seconds >= 5 && words > 0 ? Math.round(words / (seconds / 60)) : 0;

  return {
    words,
    characters: text.length,
    lines: text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0).length,
    seconds: Math.round(seconds),
    wordsPerMinute,
  };
}

/** Format a number of seconds as m:ss (e.g. 75 → "1:15"). */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Confidence as a whole percentage, clamped to 0–100. 0 when unknown. */
export function confidencePercent(confidence: number): number {
  if (!Number.isFinite(confidence) || confidence <= 0) return 0;
  return Math.min(100, Math.round(confidence * 100));
}

/**
 * A filename for the downloaded transcript, e.g. "transcript-2026-10-20-1432.txt".
 * Local time, because that is what the person dictating sees on their clock.
 */
export function transcriptFilename(date: Date = new Date(), prefix = "transcript"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${prefix}-${stamp}.txt`;
}
