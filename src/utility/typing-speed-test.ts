/**
 * Typing speed test logic: random English or Russian word lists, per-character comparison of
 * typed words, and net and raw words per minute with accuracy.
 */

export type TestLanguage = "en" | "ru";

/** 200 common English words, weighted toward short everyday vocabulary like classic typing tests. */
const WORDS_EN: string[] = [
  "the",
  "of",
  "and",
  "a",
  "to",
  "in",
  "is",
  "you",
  "that",
  "it",
  "he",
  "was",
  "for",
  "on",
  "are",
  "as",
  "with",
  "his",
  "they",
  "at",
  "be",
  "this",
  "have",
  "from",
  "or",
  "one",
  "had",
  "by",
  "word",
  "but",
  "not",
  "what",
  "all",
  "were",
  "we",
  "when",
  "your",
  "can",
  "said",
  "there",
  "use",
  "an",
  "each",
  "which",
  "she",
  "do",
  "how",
  "their",
  "if",
  "will",
  "up",
  "other",
  "about",
  "out",
  "many",
  "then",
  "them",
  "these",
  "so",
  "some",
  "her",
  "would",
  "make",
  "like",
  "him",
  "into",
  "time",
  "has",
  "look",
  "two",
  "more",
  "write",
  "go",
  "see",
  "number",
  "no",
  "way",
  "could",
  "people",
  "my",
  "than",
  "first",
  "water",
  "been",
  "call",
  "who",
  "oil",
  "its",
  "now",
  "find",
  "long",
  "down",
  "day",
  "did",
  "get",
  "come",
  "made",
  "may",
  "part",
  "over",
  "new",
  "sound",
  "take",
  "only",
  "little",
  "work",
  "know",
  "place",
  "year",
  "live",
  "me",
  "back",
  "give",
  "most",
  "very",
  "after",
  "thing",
  "our",
  "just",
  "name",
  "good",
  "sentence",
  "man",
  "think",
  "say",
  "great",
  "where",
  "help",
  "through",
  "much",
  "before",
  "line",
  "right",
  "too",
  "mean",
  "old",
  "any",
  "same",
  "tell",
  "boy",
  "follow",
  "came",
  "want",
  "show",
  "also",
  "around",
  "form",
  "three",
  "small",
  "set",
  "put",
  "end",
  "does",
  "another",
  "well",
  "large",
  "must",
  "big",
  "even",
  "such",
  "because",
  "turn",
  "here",
  "why",
  "ask",
  "went",
  "men",
  "read",
  "need",
  "land",
  "different",
  "home",
  "us",
  "move",
  "try",
  "kind",
  "hand",
  "picture",
  "again",
  "change",
  "off",
  "play",
  "spell",
  "air",
  "away",
  "animal",
  "house",
  "point",
  "page",
  "letter",
  "mother",
  "answer",
  "found",
  "study",
  "still",
  "learn",
  "should",
  "world",
  "high",
  "every",
];

/** 200 common Russian words for the Russian-layout test. */
const WORDS_RU: string[] = [
  "и",
  "в",
  "не",
  "на",
  "я",
  "быть",
  "он",
  "с",
  "что",
  "а",
  "по",
  "это",
  "она",
  "этот",
  "к",
  "но",
  "они",
  "мы",
  "как",
  "из",
  "у",
  "который",
  "то",
  "за",
  "свой",
  "весь",
  "год",
  "от",
  "так",
  "о",
  "для",
  "ты",
  "же",
  "все",
  "тот",
  "мочь",
  "вы",
  "человек",
  "такой",
  "его",
  "сказать",
  "только",
  "или",
  "еще",
  "бы",
  "себя",
  "один",
  "если",
  "уже",
  "день",
  "время",
  "когда",
  "другой",
  "вот",
  "говорить",
  "наш",
  "мой",
  "знать",
  "стать",
  "при",
  "чтобы",
  "дело",
  "жизнь",
  "кто",
  "первый",
  "очень",
  "два",
  "надо",
  "где",
  "хотеть",
  "слово",
  "идти",
  "большой",
  "должен",
  "место",
  "иметь",
  "ничто",
  "новый",
  "работа",
  "рука",
  "самый",
  "тут",
  "вопрос",
  "лицо",
  "друг",
  "нет",
  "теперь",
  "ни",
  "случай",
  "голова",
  "дом",
  "потом",
  "видеть",
  "под",
  "можно",
  "после",
  "сторона",
  "думать",
  "город",
  "здесь",
  "ребенок",
  "сила",
  "конец",
  "вид",
  "система",
  "часть",
  "страна",
  "начало",
  "спросить",
  "война",
  "делать",
  "земля",
  "работать",
  "просто",
  "вода",
  "жить",
  "хорошо",
  "нужно",
  "путь",
  "раз",
  "народ",
  "мир",
  "проблема",
  "хороший",
  "школа",
  "власть",
  "закон",
  "час",
  "имя",
  "область",
  "статья",
  "число",
  "компания",
  "группа",
  "развитие",
  "процесс",
  "суд",
  "давать",
  "результат",
  "право",
  "программа",
  "мама",
  "стол",
  "книга",
  "утро",
  "вечер",
  "ночь",
  "лес",
  "поле",
  "небо",
  "свет",
  "цвет",
  "звук",
  "стена",
  "окно",
  "дверь",
  "дорога",
  "машина",
  "улица",
  "село",
  "письмо",
  "ответ",
  "рассказ",
  "музыка",
  "театр",
  "фильм",
  "игра",
  "спорт",
  "команда",
  "матч",
  "погода",
  "зима",
  "лето",
  "весна",
  "осень",
  "снег",
  "дождь",
  "солнце",
  "ветер",
  "море",
  "река",
  "гора",
  "камень",
  "трава",
  "дерево",
  "птица",
  "рыба",
  "кошка",
  "собака",
  "конь",
  "хлеб",
  "молоко",
  "чай",
  "кофе",
  "сахар",
  "соль",
  "обед",
  "ужин",
  "завтрак",
  "еда",
];

/** One committed word: what the test asked for and what the person actually typed. */
export interface WordAttempt {
  target: string;
  typed: string;
  /**
   * The word that was being typed when time ran out. A correct beginning earns its
   * characters but is neither a correct nor a wrong word; its untyped letters are not
   * missing letters.
   */
  partial?: boolean;
}

/** Keystrokes typed during a run: every added character, right or wrong. */
export interface KeystrokeTally {
  correct: number;
  /** Wrong characters typed, plus letters left out of committed words */
  wrong: number;
}

export type CharStatus = "correct" | "wrong" | "pending";

export interface TypingTestStats {
  /** Net words per minute: characters of correctly typed words (plus a space each) / 5 / minutes. */
  wpm: number;
  /** Raw words per minute: every typed character counted, right or wrong. */
  rawWpm: number;
  /** Net characters per minute — the unit Russian typing tests report. */
  cpm: number;
  /** Raw characters per minute: every typed character counted, right or wrong. */
  rawCpm: number;
  /** Correct characters as a share of all typed characters, 0–100. */
  accuracy: number;
  correctWords: number;
  wrongWords: number;
  correctChars: number;
  wrongChars: number;
  elapsedSeconds: number;
}

const EMPTY_STATS: TypingTestStats = {
  wpm: 0,
  rawWpm: 0,
  cpm: 0,
  rawCpm: 0,
  accuracy: 0,
  correctWords: 0,
  wrongWords: 0,
  correctChars: 0,
  wrongChars: 0,
  elapsedSeconds: 0,
};

/**
 * Produce a random word list for the test. The random source is injected so callers
 * can seed it; it defaults to Math.random. Consecutive duplicates are avoided.
 */
export function generateWords(
  count: number,
  language: TestLanguage = "en",
  random: () => number = Math.random,
): string[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const bank = language === "ru" ? WORDS_RU : WORDS_EN;
  const words: string[] = [];
  let previous = "";
  for (let i = 0; i < count; i++) {
    let pick = bank[Math.floor(random() * bank.length) % bank.length] ?? bank[0];
    if (pick === previous) {
      pick = bank[(bank.indexOf(pick) + 1) % bank.length];
    }
    words.push(pick);
    previous = pick;
  }
  return words;
}

/**
 * Position-by-position comparison of a (possibly partial) typed word against its target.
 * Returns one status per target character; extra typed characters beyond the target
 * length are reported by `extraChars`.
 */
/**
 * Same letter for the test: "ё" and "е" are interchangeable (Russian texts and phone
 * keyboards use both), case still matters.
 */
export function sameChar(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const norm = (c: string) => (c === "ё" ? "е" : c === "Ё" ? "Е" : c);
  return norm(a) === norm(b);
}

export function compareWord(
  target: string,
  typed: string,
): { statuses: CharStatus[]; extraChars: number } {
  const t = target ?? "";
  const y = typed ?? "";
  const statuses: CharStatus[] = [];
  for (let i = 0; i < t.length; i++) {
    if (i >= y.length) statuses.push("pending");
    else statuses.push(sameChar(y[i], t[i]) ? "correct" : "wrong");
  }
  return { statuses, extraChars: Math.max(0, y.length - t.length) };
}

export function isWordCorrect(target: string, typed: string): boolean {
  const t = target ?? "";
  const y = typed ?? "";
  if (t === "" || t.length !== y.length) return false;
  for (let i = 0; i < t.length; i++) if (!sameChar(y[i], t[i])) return false;
  return true;
}

/** True when `typed` is a correct beginning of `target` (or all of it). */
export function isCorrectPrefix(target: string, typed: string): boolean {
  const t = target ?? "";
  const y = typed ?? "";
  if (y.length === 0 || y.length > t.length) return false;
  return isWordCorrect(t.slice(0, y.length), y);
}

/**
 * Keystrokes added to the input between two states of the current word, compared with
 * the target letter at their position. Deleting (Backspace) adds nothing, so a typo that
 * was fixed still counts once as wrong — the way monkeytype and 10fastfingers count.
 */
export function tallyKeystrokes(target: string, before: string, after: string): KeystrokeTally {
  const t = target ?? "";
  const prev = before ?? "";
  const next = after ?? "";
  let common = 0;
  while (common < prev.length && common < next.length && prev[common] === next[common]) common++;
  let correct = 0;
  let wrong = 0;
  for (let i = common; i < next.length; i++) {
    if (sameChar(next[i], t[i])) correct++;
    else wrong++;
  }
  return { correct, wrong };
}

/** Letters of the target that a committed word left out ("th" for "the" → 1). */
export function missedLetters(target: string, typed: string): number {
  return Math.max(0, (target ?? "").length - (typed ?? "").length);
}

/** Correct/wrong character counts for one word: extra and (for committed words) missing letters are wrong. */
function charCounts(attempt: WordAttempt): { correct: number; wrong: number } {
  const { statuses, extraChars } = compareWord(attempt.target, attempt.typed);
  let correct = 0;
  let wrong = extraChars;
  for (const s of statuses) {
    if (s === "correct") correct++;
    // A committed word with a letter left out is an error; the word cut off by the
    // timer simply was not finished.
    else if (s === "wrong" || (s === "pending" && !attempt.partial)) wrong++;
  }
  return { correct, wrong };
}

/**
 * Final (or live) statistics for a run. Uses the standard net-WPM formula:
 * characters of fully correct words, plus one space per word, divided by five,
 * per minute elapsed. Empty input or a non-positive duration yields zeroes.
 */
export function computeStats(
  attempts: WordAttempt[],
  elapsedMs: number,
  keystrokes?: KeystrokeTally,
): TypingTestStats {
  if (!attempts || attempts.length === 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return { ...EMPTY_STATS };
  }

  const minutes = elapsedMs / 60000;
  let correctWords = 0;
  let wrongWords = 0;
  let correctChars = 0;
  let wrongChars = 0;
  let netCharUnits = 0;
  let rawCharUnits = 0;

  for (const attempt of attempts) {
    if (!attempt || (attempt.typed ?? "") === "") continue;
    const counts = charCounts(attempt);
    correctChars += counts.correct;
    wrongChars += counts.wrong;
    if (attempt.partial && isCorrectPrefix(attempt.target, attempt.typed)) {
      // The unfinished last word: its correct letters count, no space after it.
      netCharUnits += attempt.typed.length;
      rawCharUnits += attempt.typed.length;
      continue;
    }
    rawCharUnits += attempt.typed.length + 1;
    if (isWordCorrect(attempt.target, attempt.typed)) {
      correctWords++;
      netCharUnits += attempt.target.length + 1;
    } else {
      wrongWords++;
    }
  }

  // Accuracy by keystrokes when the caller tracked them (fixed typos count too),
  // otherwise by the characters of the words as committed.
  const good = keystrokes ? keystrokes.correct : correctChars;
  const typedTotal = keystrokes ? keystrokes.correct + keystrokes.wrong : correctChars + wrongChars;
  return {
    wpm: Math.round(netCharUnits / 5 / minutes),
    rawWpm: Math.round(rawCharUnits / 5 / minutes),
    cpm: Math.round(netCharUnits / minutes),
    rawCpm: Math.round(rawCharUnits / minutes),
    accuracy: typedTotal > 0 ? Math.round((good / typedTotal) * 1000) / 10 : 0,
    correctWords,
    wrongWords,
    correctChars,
    wrongChars,
    elapsedSeconds: Math.round(elapsedMs / 1000),
  };
}
