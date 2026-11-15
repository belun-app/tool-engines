/**
 * Plural forms for EN and RU, on `Intl.PluralRules`.
 *
 * Russian has three integer forms plus a fraction form:
 *   one  — 1, 21, 101 цикл
 *   few  — 2–4, 22–24 цикла
 *   many — 0, 5–20, 25–30 циклов
 *   other — fractions, 1,5 цикла (same word as "few" in practice)
 * English has one ("1 cycle") and other ("0 cycles", "1.5 cycles").
 *
 * Forms are passed in by the caller (from the page's `data-*` attributes),
 * so engines and mounts never hold user-facing words themselves.
 * The compact string form is "one|few|many" for RU and "one|other" for EN,
 * e.g. `data-unit-cycle="цикл|цикла|циклов"` / `data-unit-cycle="cycle|cycles"`.
 */

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

const rulesCache = new Map<string, Intl.PluralRules>();

function rulesFor(lang: string): Intl.PluralRules {
  const key = lang.toLowerCase().startsWith("ru") ? "ru" : "en";
  let r = rulesCache.get(key);
  if (!r) {
    r = new Intl.PluralRules(key);
    rulesCache.set(key, r);
  }
  return r;
}

/** Fallback for engines without Intl.PluralRules (pre-2019); same rules as CLDR for integers. */
function ruCategoryFallback(n: number): PluralCategory {
  if (!Number.isInteger(n)) return "other";
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return "one";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
  return "many";
}

export function pluralCategory(n: number, lang: string): PluralCategory {
  const isRu = lang.toLowerCase().startsWith("ru");
  if (typeof Intl === "undefined" || typeof Intl.PluralRules !== "function") {
    if (isRu) return ruCategoryFallback(n);
    return n === 1 ? "one" : "other";
  }
  return rulesFor(lang).select(n) as PluralCategory;
}

/**
 * Picks a form. `forms` is either an array ([one, few, many] for RU,
 * [one, other] for EN; an optional 4th RU entry is used for fractions) or
 * a "|"-separated string in the same order.
 *
 * pluralForm(5, "цикл|цикла|циклов", "ru") -> "циклов"
 * pluralForm(1.5, "цикл|цикла|циклов", "ru") -> "цикла"
 * pluralForm(2, "cycle|cycles", "en") -> "cycles"
 */
export function pluralForm(n: number, forms: string | readonly string[], lang: string): string {
  const list = typeof forms === "string" ? forms.split("|") : forms;
  if (list.length === 0) return "";
  const cat = pluralCategory(n, lang);
  if (lang.toLowerCase().startsWith("ru")) {
    const [one, few = one, many = few, fraction = few] = list;
    if (cat === "one") return one;
    if (cat === "few") return few;
    if (cat === "many") return many;
    return fraction;
  }
  const [one, other = one] = list;
  return cat === "one" ? one : other;
}

/** Russian-only shorthand: ruPlural(21, ["день", "дня", "дней"]) -> "день". */
export function ruPlural(n: number, forms: readonly [string, string, string]): string {
  return pluralForm(n, forms, "ru");
}
