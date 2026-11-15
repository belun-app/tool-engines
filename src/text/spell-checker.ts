/**
 * Spell checking for English and Russian against Hunspell dictionaries that the caller
 * supplies as text; no dictionary is bundled.
 *
 * belun.app uses en_US from SCOWL (size 60, ~49 000 stems) and ru_RU by Alexander Lebedev
 * (~146 000 stems), the files of the `dictionary-en` and `dictionary-ru` npm packages, and
 * loads them only for the languages a text actually contains; this module is pure and
 * takes them as strings.
 *
 * What is checked: words in Latin script against English, words in Cyrillic against
 * Russian. Skipped: numbers and anything containing a digit, URLs, e-mail addresses and
 * domain names, words of one or two letters, ALL-CAPS abbreviations, CamelCase names, and
 * capitalised words in the middle of a sentence that the dictionary does not know (names).
 * ё and е are interchangeable, as in everyday Russian writing.
 *
 * Case mapping uses `toLowerCase`/`toUpperCase`, which do not depend on the host locale
 * (no Turkish dotless-i surprises), and suggestions that tie are ordered with a collator
 * for the speller's own language, so the output is the same on every machine. Time
 * budgets read an injectable clock (`now`, default `performance.now()`).
 */
import { Hunspell } from "./_hunspell.js";

export type SpellLang = "en" | "ru";

export interface MisspelledWord {
  word: string;
  offset: number;
  length: number;
  suggestions: string[];
  lang: SpellLang;
  /** Suggestions not worked out yet because the time budget ran out (see `deadline`). */
  pending?: boolean;
}

export interface SpellCheckResult {
  misspelled: MisspelledWord[];
  misspelledCount: number;
  /** Words looked at: every word with a letter in it, except those in an unloaded language. */
  checkedWords: number;
  /** Words in a language whose dictionary was not supplied (or in another script). */
  skippedWords: number;
  /**
   * The part of `skippedWords` that is English or Russian but was not checked because
   * that language's speller was not supplied (its dictionary did not load), per language.
   * The rest of `skippedWords` is in other alphabets.
   */
  unloaded: Partial<Record<SpellLang, number>>;
}

export interface Speller {
  readonly lang: SpellLang;
  /** True when the word (as typed, case-insensitively for capitalised words) is known. */
  correct(word: string): boolean;
  /**
   * Up to `max` corrections, best first, in the same capitalisation as `word`. With a
   * `deadline` (a value of the clock `now`, by default `performance.now()`) the search
   * stops there and returns the best found so far: a long unknown word can take a second
   * to search exhaustively. Words longer than {@link MAX_SUGGEST_LENGTH} get none.
   */
  suggest(word: string, max?: number, deadline?: number, now?: () => number): string[];
}

/** A clock in milliseconds; the default reads `performance.now()`. */
export type Clock = () => number;

const defaultClock: Clock = () => performance.now();

/**
 * Longest word (in UTF-16 code units) that gets suggestions. Real words are far shorter;
 * the edit search is quadratic in the word length, so a pasted run of letters would
 * otherwise stall the page.
 */
export const MAX_SUGGEST_LENGTH = 64;

const ALPHABET: Record<SpellLang, string> = {
  en: "esianrtolcdugmphbyfvkwzjxq'",
  ru: "оеаинтсрвлкмдпуяыьгзбчйхжшюцщэфъё",
};
const VOWELS: Record<SpellLang, string> = { en: "aeiouy", ru: "аеёиоуыэюя" };

/**
 * Consonants that sound alike and get swapped in writing: voiced/voiceless pairs and
 * sibilants in Russian (зделать → сделать, конешно → конечно).
 */
const SOUND_ALIKE: Record<SpellLang, readonly string[]> = {
  en: ["ck", "sz", "cs"],
  ru: ["бп", "вф", "гкх", "дт", "жшщ", "зсц", "чщш"],
};

/** Dictionary lookups between two clock reads in `suggest` (reading the clock is not free). */
const LOOKUPS_PER_CLOCK_CHECK = 500;

/** Words of one or two letters that may stand alone when a run-together word is split. */
const SHORT_WORDS: Record<SpellLang, ReadonlySet<string>> = {
  en: new Set([
    "a",
    "i",
    "an",
    "as",
    "at",
    "be",
    "by",
    "do",
    "go",
    "if",
    "in",
    "is",
    "it",
    "me",
    "my",
    "no",
    "of",
    "on",
    "or",
    "so",
    "to",
    "up",
    "us",
    "we",
  ]),
  ru: new Set([
    "а",
    "в",
    "и",
    "к",
    "о",
    "с",
    "у",
    "я",
    "во",
    "до",
    "за",
    "из",
    "ко",
    "на",
    "не",
    "ни",
    "но",
    "об",
    "он",
    "от",
    "по",
    "со",
    "то",
    "ты",
    "мы",
    "вы",
  ]),
};

/** Edit costs per language; lower is a likelier slip. */
const COST: Record<SpellLang, { insert: number; twoVowels: number }> = {
  en: { insert: 3.5, twoVowels: 4.2 },
  // Unstressed vowels are the commonest Russian error, so two of them (малако → молоко)
  // outrank a random extra letter, but not one sound-alike consonant.
  ru: { insert: 3.95, twoVowels: 3.9 },
};

/** Accented loanwords en_US leaves out but English text uses all the time. */
const EXTRA_WORDS: Record<SpellLang, readonly string[]> = {
  en: [
    "café",
    "cafés",
    "résumé",
    "résumés",
    "naïve",
    "fiancé",
    "fiancée",
    "cliché",
    "clichés",
    "déjà",
    "façade",
    "entrée",
    "protégé",
    "rosé",
    "sauté",
    "soufflé",
    "touché",
    "doppelgänger",
  ],
  ru: [],
};

/** Second halves of hyphenated Russian words that are not words on their own. */
const RU_PARTICLES = new Set(["то", "либо", "нибудь", "ка", "таки", "кое", "де", "с"]);

// toUpperCase/toLowerCase use the Unicode default case mapping, whatever the host locale.
const isUpper = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isCapitalized = (s: string) =>
  s.length > 1 && isUpper(s.charAt(0)) && s.slice(1) === s.slice(1).toLowerCase();

/** Russian: every way of reading some of the е letters as ё (at most 4 of them). */
function yoVariants(word: string): string[] {
  const at: number[] = [];
  for (let i = 0; i < word.length && at.length < 4; i++) {
    if (word[i] === "е" || word[i] === "Е") at.push(i);
  }
  const out: string[] = [];
  for (let mask = 1; mask < 1 << at.length; mask++) {
    const chars = word.split("");
    at.forEach((pos, bit) => {
      if (mask & (1 << bit)) chars[pos] = chars[pos] === "е" ? "ё" : "Ё";
    });
    out.push(chars.join(""));
  }
  return out;
}

class HunspellSpeller implements Speller {
  private readonly extra: Set<string>;
  private readonly alphabet: string;
  private readonly vowels: string;
  private readonly collator: Intl.Collator;

  constructor(
    readonly lang: SpellLang,
    private readonly hun: Hunspell,
  ) {
    this.extra = new Set(EXTRA_WORDS[lang]);
    this.alphabet = ALPHABET[lang];
    this.vowels = VOWELS[lang];
    this.collator = new Intl.Collator(lang);
  }

  /**
   * The dictionary spelling of `word` in this exact case, or null. With `yo`, a Russian
   * word written with е where the dictionary has ё is found too (ru_RU lists most such
   * pairs itself; this catches the rest). Suggestions skip it: it multiplies the lookups.
   */
  private form(word: string, yo: boolean): string | null {
    if (this.hun.check(word) || this.extra.has(word)) return word;
    if (yo && this.lang === "ru" && /[еЕ]/.test(word)) {
      for (const v of yoVariants(word)) if (this.hun.check(v)) return v;
    }
    return null;
  }

  /** Case-tolerant lookup: "The" is "the", "NASA" may be "NASA", "Nasa" or "nasa". */
  private known(word: string, yo = true): string | null {
    const w = this.hun.normalize(word);
    const exact = this.form(w, yo);
    if (exact) return exact;
    const lower = w.toLowerCase();
    if (lower === w) return null;
    if (isCapitalized(w)) return this.form(lower, yo);
    if (isUpper(w)) return this.form(lower, yo) ?? this.form(capitalize(lower), yo);
    return this.form(lower, yo);
  }

  correct(word: string): boolean {
    return this.known(word) !== null;
  }

  suggest(word: string, max = 3, deadline?: number, now: Clock = defaultClock): string[] {
    const typed = this.hun.normalize(word);
    if (typed.length > MAX_SUGGEST_LENGTH) return [];
    const base = typed.toLowerCase();
    const scores = new Map<string, number>();
    let budget = 60000;
    let sinceClock = 0;

    const consider = (cand: string, score: number) => {
      if (budget-- <= 0 || cand === base || !cand) return;
      if (deadline !== undefined && ++sinceClock >= LOOKUPS_PER_CLOCK_CHECK) {
        sinceClock = 0;
        if (now() > deadline) {
          budget = 0; // out of time: keep what was found, stop looking
          return;
        }
      }
      let found: string | null;
      if (cand.includes(" ")) {
        const short = SHORT_WORDS[this.lang];
        const parts = cand.split(" ");
        found = parts.every((p) => (p.length > 2 || short.has(p)) && this.known(p, false))
          ? cand
          : null;
      } else {
        found = this.known(cand, false);
      }
      if (!found || !this.hun.suggestable(found)) return;
      if (found.toLowerCase() === base) return;
      const prev = scores.get(found);
      if (prev === undefined || score < prev) scores.set(found, score);
    };

    const n = base.length;
    const cost = COST[this.lang];
    const isVowel = (c: string) => this.vowels.includes(c);
    const edits: string[] = [];

    // Known typing slips from the dictionary (en_US: "alot" → "a lot", ei/ie …).
    for (const [from, to] of this.hun.rep) {
      let at = base.indexOf(from);
      while (at >= 0) {
        consider(base.slice(0, at) + to.replace(/_/g, " ") + base.slice(at + from.length), 0.8);
        at = base.indexOf(from, at + 1);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      // Swapped neighbours: teh → the, recieve → receive.
      const e = base.slice(0, i) + base[i + 1] + base[i] + base.slice(i + 2);
      edits.push(e);
      consider(e, 1);
    }
    for (let i = 0; i < n; i++) {
      // A letter too many; a doubled one is the likelier slip.
      const e = base.slice(0, i) + base.slice(i + 1);
      edits.push(e);
      consider(e, base[i] === base[i - 1] || base[i] === base[i + 1] ? 2 : 3);
    }
    for (let i = 0; i <= n; i++) {
      for (const c of this.alphabet) {
        // A letter missing: tomorow → tomorrow, dont → don't.
        const e = base.slice(0, i) + c + base.slice(i);
        edits.push(e);
        const doubled = c === base[i - 1] || c === base[i];
        consider(e, c === "'" ? 1.5 : doubled ? 2 : cost.insert);
      }
    }
    for (let i = 0; i < n; i++) {
      for (const c of this.alphabet) {
        if (c === base[i] || c === "'") continue;
        // A wrong letter; a vowel for a vowel is the commonest (definately, харошая).
        const e = base.slice(0, i) + c + base.slice(i + 1);
        edits.push(e);
        const alike = SOUND_ALIKE[this.lang].some((g) => g.includes(c) && g.includes(base[i]));
        consider(e, isVowel(c) && isVowel(base[i]) ? 2.5 : alike ? 2.8 : 4);
      }
    }
    // Two words run together: вообщем → в общем, alot → a lot.
    for (let i = 1; i < n; i++) consider(`${base.slice(0, i)} ${base.slice(i)}`, 4.5);

    // Two wrong vowels — the unstressed-vowel slip that dominates Russian spelling
    // (малако → молоко, пашол → пошел). Cheap: only vowel pairs are tried.
    const vowelAt: number[] = [];
    for (let i = 0; i < n; i++) if (isVowel(base[i])) vowelAt.push(i);
    const twoVowels = cost.twoVowels;
    for (let a = 0; a < vowelAt.length; a++) {
      for (let b = a + 1; b < vowelAt.length; b++) {
        const [i, j] = [vowelAt[a], vowelAt[b]];
        for (const v of this.vowels) {
          if (v === base[i]) continue;
          for (const w of this.vowels) {
            if (w === base[j]) continue;
            consider(
              base.slice(0, i) + v + base.slice(i + 1, j) + w + base.slice(j + 1),
              twoVowels,
            );
          }
        }
      }
    }

    // Nothing close yet: try two edits, but only the cheap kinds — a vowel swap or a
    // doubled letter — on top of every first edit.
    if (scores.size === 0) {
      for (const e of edits) {
        if (budget <= 0) break;
        for (let i = 0; i < e.length; i++) {
          if (isVowel(e[i])) {
            for (const v of this.vowels) {
              if (v !== e[i]) consider(e.slice(0, i) + v + e.slice(i + 1), 5);
            }
          }
          if (e[i] === e[i + 1]) consider(e.slice(0, i) + e.slice(i + 1), 5.5);
          else consider(e.slice(0, i) + e[i] + e.slice(i), 5.5);
        }
      }
    }

    const sorted = [...scores.entries()]
      .sort(
        (a, b) =>
          a[1] - b[1] ||
          Math.abs(a[0].length - n) - Math.abs(b[0].length - n) ||
          Number(b[0][0]?.toLowerCase() === base[0]) - Number(a[0][0]?.toLowerCase() === base[0]) ||
          this.collator.compare(a[0], b[0]),
      )
      .map(([w]) => w);
    // ru_RU lists many words both with ё and with е: offer one, the ё spelling.
    const byPlainE = new Map<string, string>();
    for (const w of sorted) {
      const key = w.replace(/ё/g, "е").replace(/Ё/g, "Е");
      const prev = byPlainE.get(key);
      if (prev === undefined || (!/[ёЁ]/.test(prev) && /[ёЁ]/.test(w))) byPlainE.set(key, w);
    }
    const ranked = [
      ...new Set(sorted.map((w) => byPlainE.get(w.replace(/ё/g, "е").replace(/Ё/g, "Е")) ?? w)),
    ].slice(0, max);

    if (isCapitalized(typed) || (isUpper(typed) && typed.length === 1)) {
      return ranked.map((w) => capitalize(w));
    }
    if (isUpper(typed)) return ranked.map((w) => w.toUpperCase());
    return ranked;
  }
}

/** Builds a speller from the text of a Hunspell .aff and .dic file. */
export function createSpeller(lang: SpellLang, aff: string, dic: string): Speller {
  return new HunspellSpeller(lang, new Hunspell(aff, dic));
}

interface Token {
  word: string;
  offset: number;
  lang: SpellLang | null;
  sentenceStart: boolean;
}

/*
 * URLs, e-mail addresses and domain names are blanked before words are read. The three
 * patterns are tried at each position in this order, as one regex alternation would, but
 * by hand: tried by a plain global regex, a long run such as "a-a-a-…" or "x.y.z.…" is
 * rescanned from every position inside it, which is quadratic in its length.
 */
const URL_AT = /\b(?:https?:\/\/|ftp:\/\/|www\.)\S+/iuy;
/**
 * The local part starts where a run of characters other than whitespace and "@" starts:
 * a start further inside that run would reach the same "@", so it is never the leftmost.
 */
const EMAIL_AT = /(?<![^\s@])[^\s@]+@[^\s@]+\.[^\s@]+/iuy;
const DOMAIN_AT =
  /\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:com|org|net|ru|рф|io|dev|app|info|biz|edu|gov|uk|de|by|kz|ua|me|co|ai)\b/iuy;
/** Where a domain-name match can start (DOMAIN_AT without what follows the first letter). */
const DOMAIN_HEAD_AT = /\b[\p{L}\p{N}-]/iuy;
const DOMAIN_CHAR = /^[\p{L}\p{N}-]$/u;

/** End of the match of a sticky regex at `at`, or -1. */
function endOf(re: RegExp, text: string, at: number): number {
  re.lastIndex = at;
  return re.test(text) ? re.lastIndex : -1;
}

/**
 * Are two neighbouring characters part of one dotted name ("a-b.c")? A domain match that
 * fails from one position also fails from every later position of the same name, because
 * it can only reach the "." + TLD endings the earlier position could reach.
 */
function sameName(a: string, b: string): boolean {
  const da = DOMAIN_CHAR.test(a);
  const db = DOMAIN_CHAR.test(b);
  return (da && db) || (da && b === ".") || (a === "." && db);
}

/** The text with URLs, e-mail addresses and domain names replaced by spaces. Linear time. */
function maskUrls(text: string): string {
  let out = "";
  let copied = 0;
  let nameTried = false; // a domain match was already tried in the current dotted name
  let prev = "";
  let i = 0;
  while (i < text.length) {
    const ch = String.fromCodePoint(text.codePointAt(i) as number);
    if (!sameName(prev, ch)) nameTried = false;
    let end = endOf(URL_AT, text, i);
    if (end < 0) end = endOf(EMAIL_AT, text, i);
    if (end < 0 && !nameTried && endOf(DOMAIN_HEAD_AT, text, i) >= 0) {
      nameTried = true;
      end = endOf(DOMAIN_AT, text, i);
    }
    if (end < 0) {
      prev = ch;
      i += ch.length;
      continue;
    }
    out += text.slice(copied, i) + " ".repeat(end - i);
    copied = end;
    const last = text.codePointAt(end - 1) as number;
    prev = String.fromCodePoint(
      last >= 0xdc00 && last <= 0xdfff ? (text.codePointAt(end - 2) as number) : last,
    );
    i = end;
  }
  return copied ? out + text.slice(copied) : text;
}

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’\-‐][\p{L}\p{M}\p{N}]+)*/gu;

function scriptOf(word: string): SpellLang | null {
  if (/\p{Script=Cyrillic}/u.test(word)) return "ru";
  if (/\p{Script=Latin}/u.test(word)) return "en";
  return null;
}

/** Is the word the first one of a sentence (or of the text, or of a line)? */
function startsSentence(text: string, offset: number): boolean {
  for (let i = offset - 1; i >= 0; i--) {
    const c = text[i];
    if (/[\s"'«»“”„()[\]—–-]/.test(c)) {
      if (c === "\n") return true;
      continue;
    }
    return /[.!?…:;]/.test(c);
  }
  return true;
}

/** Splits text into words, blanking URLs and e-mail addresses so they are never read. */
export function tokenize(text: string): Token[] {
  const masked = maskUrls(text);
  const tokens: Token[] = [];
  for (const m of masked.matchAll(WORD)) {
    const word = m[0];
    if (/\p{N}/u.test(word)) continue;
    const offset = m.index ?? 0;
    tokens.push({
      word,
      offset,
      lang: scriptOf(word),
      sentenceStart: startsSentence(text, offset),
    });
  }
  return tokens;
}

/** The dictionaries a text needs: English for Latin words, Russian for Cyrillic ones. */
export function languagesIn(text: string): SpellLang[] {
  const out: SpellLang[] = [];
  if (/\p{Script=Latin}/u.test(text)) out.push("en");
  if (/\p{Script=Cyrillic}/u.test(text)) out.push("ru");
  return out;
}

export interface CheckOptions {
  /** Suggestions computed so far, keyed by `${lang}:${word}`; reused across checks. */
  cache?: Map<string, string[]>;
  /** Most suggestions per word. */
  maxSuggestions?: number;
  /**
   * Clock value (see `now`) after which new suggestions are left for later (`pending`),
   * so a long text with many unknown words is highlighted at once.
   */
  deadline?: number;
  /**
   * Most milliseconds spent on the suggestions for one word; the best found by then are
   * kept. Without it a long unknown word («маркетплейсами») is searched exhaustively,
   * which takes up to a second.
   */
  suggestTimeoutMs?: number;
  /** Clock for `deadline` and `suggestTimeoutMs`, in milliseconds; default `performance.now()`. */
  now?: Clock;
}

export function checkSpelling(
  text: string,
  spellers: Partial<Record<SpellLang, Speller>>,
  options: CheckOptions = {},
): SpellCheckResult {
  const cache = options.cache ?? new Map<string, string[]>();
  const max = options.maxSuggestions ?? 3;
  const now = options.now ?? defaultClock;
  const misspelled: MisspelledWord[] = [];
  let checkedWords = 0;
  let skippedWords = 0;
  const unloaded: Partial<Record<SpellLang, number>> = {};
  const verdicts = new Map<string, boolean>();

  const isKnown = (speller: Speller, word: string) => {
    const key = `${speller.lang}:${word}`;
    let ok = verdicts.get(key);
    if (ok === undefined) {
      ok = speller.correct(word);
      verdicts.set(key, ok);
    }
    return ok;
  };

  const flag = (speller: Speller, word: string, offset: number) => {
    const key = `${speller.lang}:${word}`;
    let suggestions = cache.get(key);
    if (!suggestions) {
      if (options.deadline !== undefined && now() > options.deadline) {
        misspelled.push({
          word,
          offset,
          length: word.length,
          suggestions: [],
          lang: speller.lang,
          pending: true,
        });
        return;
      }
      const timeout = options.suggestTimeoutMs;
      suggestions = speller.suggest(
        word,
        max,
        timeout === undefined ? undefined : now() + timeout,
        now,
      );
      cache.set(key, suggestions);
    }
    misspelled.push({ word, offset, length: word.length, suggestions, lang: speller.lang });
  };

  /** One word (or one part of a hyphenated word): decide whether to flag it. */
  const judge = (speller: Speller, word: string, offset: number, sentenceStart: boolean) => {
    const letters = word.replace(/['’]/g, "");
    if (letters.length < 3) return;
    if (isUpper(letters)) return; // NASA, ГОСТ
    if (isKnown(speller, word)) return;
    const rest = word.slice(1);
    if (rest !== rest.toLowerCase()) return; // iPhone, McDonald, CamelCase
    if (isUpper(word.charAt(0)) && !sentenceStart) return; // a name mid-sentence
    flag(speller, word, offset);
  };

  for (const token of tokenize(text)) {
    const speller = token.lang ? spellers[token.lang] : undefined;
    if (!speller) {
      skippedWords++;
      if (token.lang) unloaded[token.lang] = (unloaded[token.lang] ?? 0) + 1;
      continue;
    }
    checkedWords++;
    const word = token.word.replace(/’/g, "'");
    if (!/[-‐]/.test(word)) {
      judge(speller, token.word, token.offset, token.sentenceStart);
      continue;
    }
    if (isKnown(speller, word)) continue;
    // A hyphenated compound the dictionary does not list: check each part on its own.
    let at = 0;
    for (const part of token.word.split(/[-‐]/)) {
      const isParticle = speller.lang === "ru" && at > 0 && RU_PARTICLES.has(part.toLowerCase());
      if (!isParticle) {
        judge(speller, part, token.offset + at, at === 0 && token.sentenceStart);
      }
      at += part.length + 1;
    }
  }

  return {
    misspelled,
    misspelledCount: misspelled.length,
    checkedWords,
    skippedWords,
    unloaded,
  };
}
