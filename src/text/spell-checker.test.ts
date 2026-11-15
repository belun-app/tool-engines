import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { Hunspell } from "./_hunspell.js";
import {
  type Clock,
  MAX_SUGGEST_LENGTH,
  type Speller,
  checkSpelling,
  createSpeller,
  languagesIn,
  tokenize,
} from "./spell-checker.js";

/**
 * The real en_US and ru_RU Hunspell dictionaries, from the unmodified npm packages
 * dictionary-en@4.0.0 and dictionary-ru@3.0.0 (dev dependencies). The suite that needs
 * them is skipped when they are not installed.
 */
const dictPath = (lang: string, ext: string): string =>
  fileURLToPath(new URL(`../../node_modules/dictionary-${lang}/index.${ext}`, import.meta.url));
const haveDicts = ["en", "ru"].every(
  (lang) => existsSync(dictPath(lang, "aff")) && existsSync(dictPath(lang, "dic")),
);
const dict = (lang: string, ext: string) => readFileSync(dictPath(lang, ext), "utf8");

/** A fake clock that moves forward by `step` ms every time it is read, and counts reads. */
function steppingClock(step = 1): Clock & { reads: number } {
  let t = 0;
  const clock = Object.assign(
    () => {
      clock.reads++;
      t += step;
      return t;
    },
    { reads: 0 },
  );
  return clock;
}

/** Wraps a speller to count `suggest` calls. */
function countingSpeller(inner: Speller): Speller & { suggestCalls: number } {
  const wrapped = {
    lang: inner.lang,
    suggestCalls: 0,
    correct: (word: string) => inner.correct(word),
    suggest: (word: string, max?: number, deadline?: number, now?: Clock) => {
      wrapped.suggestCalls++;
      return inner.suggest(word, max, deadline, now);
    },
  };
  return wrapped;
}

describe("Hunspell reader (synthetic dictionary)", () => {
  const aff = [
    "SET UTF-8",
    "TRY esiarntolcdug",
    "NOSUGGEST !",
    "ONLYINCOMPOUND c",
    "PFX U Y 1",
    "PFX U 0 un .",
    "SFX S Y 2",
    "SFX S y ies [^aeiou]y",
    "SFX S 0 s [^y]",
    "SFX D Y 2",
    "SFX D 0 d e",
    "SFX D 0 ed [^e]",
  ].join("\n");
  const dic = ["5", "city/S", "bake/DS", "lock/UDS", "1th/c", "darn/!"].join("\n");
  const h = new Hunspell(aff, dic);

  it("accepts stems and suffixed forms whose condition matches", () => {
    for (const w of ["city", "cities", "bake", "baked", "bakes", "lock", "locked", "locks"]) {
      expect(h.check(w), w).toBe(true);
    }
    expect(h.check("citys")).toBe(false); // condition [^y] fails
    expect(h.check("bakeed")).toBe(false);
  });

  it("combines a prefix and a suffix only when both allow cross products", () => {
    expect(h.check("unlock")).toBe(true);
    expect(h.check("unlocked")).toBe(true);
    expect(h.check("unbake")).toBe(false); // bake has no U flag
  });

  it("honours ONLYINCOMPOUND and NOSUGGEST", () => {
    expect(h.check("1th")).toBe(false);
    expect(h.check("darn")).toBe(true);
    expect(h.suggestable("darn")).toBe(false);
    expect(h.suggestable("city")).toBe(true);
  });
});

describe.skipIf(!haveDicts)("spell checker with the real en_US and ru_RU dictionaries", () => {
  let en: Speller;
  let ru: Speller;
  let both: { en: Speller; ru: Speller };
  const marks = (text: string) => checkSpelling(text, both).misspelled.map((m) => m.word);

  beforeAll(() => {
    en = createSpeller("en", dict("en", "aff"), dict("en", "dic"));
    ru = createSpeller("ru", dict("ru", "aff"), dict("ru", "dic"));
    both = { en, ru };
  });

  it("does not flag ordinary English prose", () => {
    const prose =
      "The weather was beautiful yesterday, so we walked through the park and talked about our plans. " +
      "She opened the email, read it carefully, and replied to her colleague with a short summary " +
      "of the meeting. Thanks for the visit today; my computer and my dog say hello. The children " +
      "were running happily while their parents wondered whether the unhappy neighbors had left.";
    expect(marks(prose)).toEqual([]);
  });

  it("flags classic English typos with the right first suggestion", () => {
    const r = checkSpelling("I recieve teh package tomorow and it was definately great.", both);
    expect(r.misspelled.map((m) => [m.word, m.suggestions[0]])).toEqual([
      ["recieve", "receive"],
      ["teh", "the"],
      ["tomorow", "tomorrow"],
      ["definately", "definitely"],
    ]);
    expect(en.suggest("dont")[0]).toBe("don't");
    expect(en.suggest("alot")[0]).toBe("a lot");
    expect(en.suggest("wrold")[0]).toBe("world");
    expect(en.suggest("becuase")[0]).toBe("because");
    for (const s of ["helo", "freind", "teh"]) expect(en.suggest(s).length).toBeLessThanOrEqual(3);
  });

  it("checks Russian text and suggests the right word", () => {
    const r = checkSpelling("Превет, как дила? Сегодня харошая погода, я пашол гулять.", both);
    expect(r.misspelled.map((m) => m.word)).toEqual(["Превет", "дила", "харошая", "пашол"]);
    expect(r.checkedWords).toBe(9);
    const first = Object.fromEntries(r.misspelled.map((m) => [m.word, m.suggestions]));
    expect(first.Превет[0]).toBe("Привет");
    expect(first.дила).toContain("дела");
    expect(first.харошая[0]).toBe("хорошая");
    expect(first.пашол[0]).toBe("пошёл");
    expect(ru.suggest("малако")[0]).toBe("молоко");
    expect(ru.suggest("сабака")[0]).toBe("собака");
  });

  it("treats ё and е alike and knows hyphenated particles", () => {
    expect(marks("Ещё ёлка, еще елка. Кто-то что-нибудь сказал по-русски, кое-где.")).toEqual([]);
  });

  it("checks the first word of a sentence but leaves names mid-sentence alone", () => {
    expect(marks("Teh cat sat on the mat. Recieve it.")).toEqual(["Teh", "Recieve"]);
    expect(marks("We met Gwendolyn and Zarkowski in Kyiv.")).toEqual([]);
    expect(marks("Мы встретили Гвендолин в Тбилиси.")).toEqual([]);
  });

  it("skips URLs, e-mail addresses, numbers, short words, abbreviations", () => {
    expect(marks("Please visit https://example.com today or mail john@example.org.")).toEqual([]);
    expect(marks("Open belun.app or www.example.org/path?q=1 now.")).toEqual([]);
    expect(marks("ab xz 123abc 4th 2026 don't teh")).toEqual(["teh"]);
    expect(marks("The GDPR and NASA rules, ГОСТ and iPhone.")).toEqual([]);
  });

  it("keeps accented words whole and reports exact offsets", () => {
    expect(marks("The café sent my résumé.")).toEqual([]);
    const r = checkSpelling("-teh- word", both);
    expect(r.misspelled[0]).toMatchObject({ word: "teh", offset: 1, length: 3 });
    const t = "x «харошая» y";
    const m = checkSpelling(t, both).misspelled[0];
    expect(t.slice(m.offset, m.offset + m.length)).toBe("харошая");
  });

  it("checks each part of an unknown hyphenated word", () => {
    const r = checkSpelling("a well-knwon fact", both);
    expect(r.misspelled.map((m) => m.word)).toEqual(["knwon"]);
    expect(r.misspelled[0].offset).toBe(7);
  });

  it("counts words of a language without a dictionary as skipped, not as correct", () => {
    const r = checkSpelling("Привет мир and hello", { en });
    expect(r).toMatchObject({ misspelledCount: 0, checkedWords: 2, skippedWords: 2 });
    // Russian words with no Russian speller are "not loaded", not "other alphabets": the
    // caller can say the dictionary failed instead of blaming the text.
    expect(r.unloaded).toEqual({ ru: 2 });
    expect(checkSpelling("Привет 你好 hello", { en }).unloaded).toEqual({ ru: 1 });
    expect(languagesIn("Привет and hello")).toEqual(["en", "ru"]);
    expect(languagesIn("123 !!!")).toEqual([]);
  });

  it("returns an empty result for empty and whitespace-only input", () => {
    for (const input of ["", "   ", "\n\t"]) {
      expect(checkSpelling(input, both)).toEqual({
        misspelled: [],
        misspelledCount: 0,
        checkedWords: 0,
        skippedWords: 0,
        unloaded: {},
      });
    }
  });

  it("checks a 5000-word article and works out each unknown word's suggestions once", () => {
    const para =
      "The weather was beautiful yesterday, so we walked through the park and talked about our plans for the summer holidays. Teh end. ";
    const text = para.repeat(Math.ceil(5000 / para.split(/\s+/).length));
    const counted = countingSpeller(en);
    const r = checkSpelling(text, { en: counted, ru });
    expect(r.checkedWords).toBeGreaterThan(4500);
    expect(new Set(r.misspelled.map((m) => m.word))).toEqual(new Set(["Teh"]));
    expect(r.misspelled.length).toBeGreaterThan(30);
    expect(counted.suggestCalls).toBe(1);
    // A shared cache carries the suggestions over to the next check.
    const cache = new Map<string, string[]>();
    checkSpelling("Teh end.", { en: counted }, { cache });
    checkSpelling("Teh end.", { en: counted }, { cache });
    expect(counted.suggestCalls).toBe(2);
  });

  it("leaves suggestions pending once the deadline has passed", () => {
    const clock = steppingClock();
    const r = checkSpelling("qwzxv plorfk", both, { deadline: 0, now: clock });
    expect(r.misspelled.map((m) => m.pending)).toEqual([true, true]);
    expect(r.misspelled.every((m) => m.suggestions.length === 0)).toBe(true);
  });

  it("stops suggesting at the deadline instead of searching exhaustively", () => {
    const word = "маркетплейсами";
    // Without a deadline the search never reads the clock.
    const idle = steppingClock();
    expect(ru.suggest("малако", 3, undefined, idle)[0]).toBe("молоко");
    expect(idle.reads).toBe(0);
    // The clock moves 1 ms per read and is read once every 500 lookups, so a 30 ms budget
    // allows about 31 reads before the search gives up and returns what it has.
    const clock = steppingClock();
    const quick = ru.suggest(word, 3, 30, clock);
    expect(clock.reads).toBeGreaterThan(0);
    expect(clock.reads).toBeLessThanOrEqual(31);
    expect(quick.length).toBeLessThanOrEqual(3);
    // A deadline already passed stops at the first look at the clock.
    const late = steppingClock();
    ru.suggest("пеереобрзоватльный", 3, -1, late);
    expect(late.reads).toBe(1);
  });

  it("caps the time spent on one word with suggestTimeoutMs", () => {
    const clock = steppingClock();
    const r = checkSpelling("маркетплейсами", both, { suggestTimeoutMs: 30, now: clock });
    // One read to set the word's deadline, then at most one per 500 lookups until it passes.
    expect(clock.reads).toBeLessThanOrEqual(32);
    expect(r.misspelled).toHaveLength(1);
    expect(r.misspelled[0].pending).toBeUndefined();
  });

  it("gives no suggestions for a word longer than MAX_SUGGEST_LENGTH", () => {
    const long = "qwerty".repeat(Math.ceil((MAX_SUGGEST_LENGTH + 1) / 6));
    expect(en.suggest(long)).toEqual([]);
    const r = checkSpelling(`Hello ${long} world`, { en });
    expect(r.misspelled).toEqual([
      { word: long, offset: 6, length: long.length, suggestions: [], lang: "en" },
    ]);
  });

  it("checks a single 40 000-letter token without stalling", () => {
    const r = checkSpelling("x".repeat(40_000), both);
    expect(r.misspelledCount).toBe(1);
    expect(r.misspelled[0].suggestions).toEqual([]);
  }, 20_000);

  it("tokenizes words with apostrophes and hyphens, never digits", () => {
    expect(tokenize("don't rock-n-roll 3rd O’Neil").map((t) => t.word)).toEqual([
      "don't",
      "rock-n-roll",
      "O’Neil",
    ]);
  });
});

describe("tokenize: URLs, e-mail addresses and domain names", () => {
  const words = (text: string) => tokenize(text).map((t) => t.word);

  it("blanks URLs, addresses and domains wherever they start in a run", () => {
    expect(words("see https://example.com/a-b?q=1 now")).toEqual(["see", "now"]);
    expect(words("mail john.doe@mail.example.org today")).toEqual(["mail", "today"]);
    expect(words("open belun.app or WWW.Example.ORG")).toEqual(["open", "or"]);
    // A domain that starts after a hyphen or right after a non-ASCII letter.
    expect(words("-foo.com мойsite.com")).toEqual(["мой"]);
    // The first "." + TLD ending is not the end: the longest dotted name is blanked.
    expect(words("a sub.example.com.ru b")).toEqual(["a", "b"]);
    // Text after the last TLD of a dotted run stays readable.
    expect(words("x.com-tail")).toEqual(["tail"]);
    expect(words("a@b.c@x.com")).toEqual([]);
    expect(words("zzz-http://x.y")).toEqual(["zzz"]);
  });

  it("keeps offsets of words after a blanked URL", () => {
    const t = tokenize("https://x.org and word");
    expect(t.map((x) => [x.word, x.offset])).toEqual([
      ["and", 14],
      ["word", 18],
    ]);
  });

  it("handles long runs that look almost like names in linear time", () => {
    const n = 40_000;
    for (const text of [
      "a".repeat(n),
      "a-".repeat(n / 2),
      "a.".repeat(n / 2),
      `x.com${".a".repeat(n / 2)}`,
      "a@".repeat(n / 2),
      `${"я".repeat(n)}.com`,
    ]) {
      expect(Array.isArray(tokenize(text))).toBe(true);
    }
    const tail = tokenize(`x.com${"-a".repeat(1000)}`);
    expect(tail.map((t) => [t.offset, t.word.length])).toEqual([[6, 1999]]);
  }, 20_000);
});
