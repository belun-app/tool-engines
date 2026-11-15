/**
 * Turns any text into a URL slug: Russian or Ukrainian Cyrillic is transliterated,
 * diacritics are dropped, and every run of other characters becomes one separator.
 */

export type SlugSeparator = "-" | "_";

export interface SlugOptions {
  /** Character that joins words: `"-"` (default) or `"_"`. Any other value means `"-"`. */
  separator?: SlugSeparator;
  /** Lowercase the whole slug. Default `true`; pass `false` to keep the letter case. */
  lowercase?: boolean;
}

export interface SlugResult {
  slug: string;
  length: number;
}

// Russian → Latin transliteration so Cyrillic input produces usable slugs.
const CYRILLIC: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/**
 * Ukrainian national transliteration (Cabinet of Ministers resolution No. 55, 2010), used
 * when the text has a letter only Ukrainian uses (і, ї, є, ґ): "Київ" -> "Kyiv".
 */
const UKRAINIAN: Record<string, string> = {
  ...CYRILLIC,
  г: "h",
  ґ: "g",
  е: "e",
  є: "ie",
  и: "y",
  і: "i",
  ї: "i",
  й: "i",
  х: "kh",
  ц: "ts",
  ю: "iu",
  я: "ia",
};

/** At the start of a word these Ukrainian letters take their "y" form: Євген -> Yevhen. */
const UKRAINIAN_WORD_START: Record<string, string> = { є: "ye", ї: "yi", й: "y", ю: "yu", я: "ya" };

/** Latin letters that Unicode does not decompose into a base letter + diacritic. */
const LATIN_EXTRA: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ł: "l",
  þ: "th",
  ð: "d",
};

function transliterate(input: string): string {
  const ukrainian = /[ієїґ]/i.test(input);
  const table = ukrainian ? UKRAINIAN : CYRILLIC;
  let out = "";
  let previous = "";
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const wordStart = !/[\p{L}\p{M}']/u.test(previous);
    previous = ch;
    const mapped =
      (ukrainian && wordStart ? UKRAINIAN_WORD_START[lower] : undefined) ??
      table[lower] ??
      LATIN_EXTRA[lower];
    if (mapped === undefined) {
      out += ch;
    } else if (ch !== lower && mapped.length > 0) {
      out += mapped.charAt(0).toUpperCase() + mapped.slice(1);
    } else {
      out += mapped;
    }
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * URL slug from any text: Cyrillic is transliterated (Russian, or Ukrainian when the text
 * has і/ї/є/ґ), diacritics are dropped, and every run of other characters becomes one
 * separator. A non-string `text` gives an empty slug.
 */
export function slugify(text: string, options: SlugOptions = {}): SlugResult {
  const separator: SlugSeparator = options?.separator === "_" ? "_" : "-";
  const lowercase = options?.lowercase !== false;

  if (typeof text !== "string" || !text.trim()) return { slug: "", length: 0 };

  let s = transliterate(text);
  // Split accented Latin letters into base + diacritic, then drop the diacritics.
  s = s.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
  if (lowercase) s = s.toLowerCase();
  // Everything that is not a letter or digit becomes a separator.
  s = s.replace(/[^a-zA-Z0-9]+/g, separator);

  const sep = escapeRegExp(separator);
  s = s.replace(new RegExp(`${sep}{2,}`, "g"), separator);
  s = s.replace(new RegExp(`^${sep}+|${sep}+$`, "g"), "");

  return { slug: s, length: s.length };
}
