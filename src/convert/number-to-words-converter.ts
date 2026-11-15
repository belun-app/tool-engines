/**
 * Number → words converter for cheques, contracts, and invoices.
 *
 * English (US reading by default, British "and" on request; international or Indian
 * lakh/crore grouping) and Russian (the amount-in-words line of Russian invoices and
 * contracts, with gender and plural agreement) share one result shape. All arithmetic runs on the digit string rather than through
 * Number(), so a 21-digit input keeps every digit intact. `wordsToNumber` goes the other
 * way, so a written amount can be checked against its figure.
 */

export type WordsLang = "en" | "ru";
export type CurrencyCode = "none" | "usd" | "eur" | "gbp" | "inr" | "aed" | "zar" | "rub" | "uah";
export type TextCaseStyle = "lower" | "sentence" | "title" | "upper";
/** "international": thousand, million, billion. "indian": thousand, lakh, crore (EN only). */
export type NumberSystem = "international" | "indian";
/** "us": one hundred one. "uk": one hundred and one, one thousand and five (EN only). */
export type AndStyle = "us" | "uk";

export interface NumberToWordsOptions {
  lang?: WordsLang;
  currency?: CurrencyCode;
  system?: NumberSystem;
  andStyle?: AndStyle;
  /** Close the cheque and currency lines with "only", as Indian and Gulf cheques do (EN only). */
  only?: boolean;
}

export interface NumberToWordsResult {
  ok: boolean;
  /** Human-readable problem (English), or "" when there is none. */
  error: string;
  /** Machine-readable reason for `error`; pages map it to their own language. */
  errorCode: NumberErrorCode;
  /** The value exactly as parsed, e.g. "-1234.56". */
  normalized: string;
  /** Same value with separators: "1,234.56" (en), "12,34,567" (indian), "1 234,56" (ru). */
  grouped: string;
  /** The rounded money amount with separators and two decimals: "7 800,50" (ru). */
  groupedMoney: string;
  /** The amount the cheque and currency lines spell out, rounded to cents: "-1234.56". */
  rounded: string;
  /** Plain reading: "one thousand two hundred thirty-four point five six". */
  words: string;
  /** Cheque line with a numeric minor part: "… dollars and 56/100". */
  cheque: string;
  /** Full words including the minor unit; "" when no currency is selected. */
  currencyWords: string;
  /** Ordinal form of a whole number (English only; "" otherwise). */
  ordinal: string;
  negative: boolean;
}

/** Longest integer part the scale names cover (up to 999 quintillion). */
export const MAX_INTEGER_DIGITS = 21;

type Gender = "m" | "f";

interface RuUnit {
  forms: readonly [string, string, string];
  gender: Gender;
}

interface CurrencyDef {
  en: { major: readonly [string, string]; minor: readonly [string, string] };
  ru: { major: RuUnit; minor: RuUnit };
}

const CURRENCIES: Record<Exclude<CurrencyCode, "none">, CurrencyDef> = {
  usd: {
    en: { major: ["dollar", "dollars"], minor: ["cent", "cents"] },
    ru: {
      major: { forms: ["доллар", "доллара", "долларов"], gender: "m" },
      minor: { forms: ["цент", "цента", "центов"], gender: "m" },
    },
  },
  eur: {
    en: { major: ["euro", "euros"], minor: ["cent", "cents"] },
    ru: {
      major: { forms: ["евро", "евро", "евро"], gender: "m" },
      minor: { forms: ["цент", "цента", "центов"], gender: "m" },
    },
  },
  gbp: {
    en: { major: ["pound", "pounds"], minor: ["penny", "pence"] },
    ru: {
      major: { forms: ["фунт", "фунта", "фунтов"], gender: "m" },
      minor: { forms: ["пенс", "пенса", "пенсов"], gender: "m" },
    },
  },
  inr: {
    en: { major: ["rupee", "rupees"], minor: ["paisa", "paise"] },
    ru: {
      major: { forms: ["рупия", "рупии", "рупий"], gender: "f" },
      minor: { forms: ["пайса", "пайсы", "пайс"], gender: "f" },
    },
  },
  aed: {
    en: { major: ["dirham", "dirhams"], minor: ["fils", "fils"] },
    ru: {
      major: { forms: ["дирхам", "дирхама", "дирхамов"], gender: "m" },
      minor: { forms: ["филс", "филса", "филсов"], gender: "m" },
    },
  },
  zar: {
    // South African usage keeps "rand" unchanged in the plural: "fifty rand".
    en: { major: ["rand", "rand"], minor: ["cent", "cents"] },
    ru: {
      major: { forms: ["рэнд", "рэнда", "рэндов"], gender: "m" },
      minor: { forms: ["цент", "цента", "центов"], gender: "m" },
    },
  },
  rub: {
    en: { major: ["ruble", "rubles"], minor: ["kopeck", "kopecks"] },
    ru: {
      major: { forms: ["рубль", "рубля", "рублей"], gender: "m" },
      minor: { forms: ["копейка", "копейки", "копеек"], gender: "f" },
    },
  },
  uah: {
    en: { major: ["hryvnia", "hryvnias"], minor: ["kopiyka", "kopiykas"] },
    ru: {
      major: { forms: ["гривна", "гривны", "гривен"], gender: "f" },
      minor: { forms: ["копейка", "копейки", "копеек"], gender: "f" },
    },
  },
};

const EN_ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
const EN_SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion"];

const EN_ORDINALS: Record<string, string> = {
  zero: "zeroth",
  one: "first",
  two: "second",
  three: "third",
  four: "fourth",
  five: "fifth",
  six: "sixth",
  seven: "seventh",
  eight: "eighth",
  nine: "ninth",
  ten: "tenth",
  eleven: "eleventh",
  twelve: "twelfth",
  thirteen: "thirteenth",
  fourteen: "fourteenth",
  fifteen: "fifteenth",
  sixteen: "sixteenth",
  seventeen: "seventeenth",
  eighteen: "eighteenth",
  nineteen: "nineteenth",
  twenty: "twentieth",
  thirty: "thirtieth",
  forty: "fortieth",
  fifty: "fiftieth",
  sixty: "sixtieth",
  seventy: "seventieth",
  eighty: "eightieth",
  ninety: "ninetieth",
  hundred: "hundredth",
  thousand: "thousandth",
  million: "millionth",
  billion: "billionth",
  trillion: "trillionth",
  quadrillion: "quadrillionth",
  quintillion: "quintillionth",
};

const RU_ONES_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const RU_ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const RU_DIGITS = [
  "ноль",
  "один",
  "два",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
];
const RU_TEENS = [
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать",
];
const RU_TENS = [
  "",
  "",
  "двадцать",
  "тридцать",
  "сорок",
  "пятьдесят",
  "шестьдесят",
  "семьдесят",
  "восемьдесят",
  "девяносто",
];
const RU_HUNDREDS = [
  "",
  "сто",
  "двести",
  "триста",
  "четыреста",
  "пятьсот",
  "шестьсот",
  "семьсот",
  "восемьсот",
  "девятьсот",
];

const RU_SCALES: RuUnit[] = [
  { forms: ["", "", ""], gender: "m" },
  { forms: ["тысяча", "тысячи", "тысяч"], gender: "f" },
  { forms: ["миллион", "миллиона", "миллионов"], gender: "m" },
  { forms: ["миллиард", "миллиарда", "миллиардов"], gender: "m" },
  { forms: ["триллион", "триллиона", "триллионов"], gender: "m" },
  { forms: ["квадриллион", "квадриллиона", "квадриллионов"], gender: "m" },
  { forms: ["квинтиллион", "квинтиллиона", "квинтиллионов"], gender: "m" },
];

const EMPTY: NumberToWordsResult = {
  ok: false,
  error: "",
  errorCode: "",
  groupedMoney: "",
  normalized: "",
  grouped: "",
  words: "",
  cheque: "",
  currencyWords: "",
  rounded: "",
  ordinal: "",
  negative: false,
};

/** Splits a digit string into 3-digit group values, units group first. */
function splitGroups(digits: string): number[] {
  const groups: number[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.push(Number(digits.slice(Math.max(0, end - 3), end)));
  }
  return groups;
}

function enThree(n: number, uk = false): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${EN_ONES[hundreds]} hundred`);
  if (hundreds && rest && uk) parts.push("and");
  if (rest < 20) {
    if (rest) parts.push(EN_ONES[rest]);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    parts.push(ones ? `${EN_TENS[tens]}-${EN_ONES[ones]}` : EN_TENS[tens]);
  }
  return parts.join(" ");
}

interface EnPart {
  words: string;
  /** The group's own value, before its scale word; tested by the British "and" rule. */
  value: number;
  scaled: boolean;
}

/**
 * Joins the groups of a number. British English adds "and" before a final group under
 * one hundred when something bigger comes first: "one thousand and five".
 */
function joinEnParts(parts: EnPart[], uk: boolean): string {
  const last = parts[parts.length - 1];
  if (uk && parts.length > 1 && !last.scaled && last.value < 100) {
    return [...parts.slice(0, -1).map((p) => p.words), "and", last.words].join(" ");
  }
  return parts.map((p) => p.words).join(" ");
}

function enInternationalParts(digits: string, uk: boolean): EnPart[] {
  const groups = splitGroups(digits);
  const out: EnPart[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (!group) continue;
    const words = enThree(group, uk);
    out.push({
      words: EN_SCALES[i] ? `${words} ${EN_SCALES[i]}` : words,
      value: group,
      scaled: i > 0,
    });
  }
  return out;
}

/** Indian grouping: crore (1,00,00,000), lakh (1,00,000), thousand, then the last three. */
function enIndianParts(digits: string, uk: boolean): EnPart[] {
  const trimmed = digits.replace(/^0+/, "");
  if (!trimmed) return [];
  const out: EnPart[] = [];
  if (trimmed.length > 7) {
    // Crores are counted in Indian words themselves: "one lakh crore", "five thousand crore".
    const high = enIndianParts(trimmed.slice(0, -7), uk);
    if (high.length) out.push({ words: `${joinEnParts(high, uk)} crore`, value: 0, scaled: true });
  }
  const low = Number(trimmed.slice(-7));
  const lakh = Math.floor(low / 100_000);
  const thousand = Math.floor(low / 1000) % 100;
  const rest = low % 1000;
  if (lakh) out.push({ words: `${enThree(lakh, uk)} lakh`, value: lakh, scaled: true });
  if (thousand) {
    out.push({ words: `${enThree(thousand, uk)} thousand`, value: thousand, scaled: true });
  }
  if (rest) out.push({ words: enThree(rest, uk), value: rest, scaled: false });
  return out;
}

function enInteger(digits: string, system: NumberSystem = "international", uk = false): string {
  const parts = system === "indian" ? enIndianParts(digits, uk) : enInternationalParts(digits, uk);
  if (!parts.length) return "zero";
  return joinEnParts(parts, uk);
}

function ruThree(n: number, gender: Gender): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(RU_HUNDREDS[hundreds]);
  if (rest >= 10 && rest < 20) {
    parts.push(RU_TEENS[rest - 10]);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens) parts.push(RU_TENS[tens]);
    if (ones) parts.push(gender === "f" ? RU_ONES_F[ones] : RU_ONES_M[ones]);
  }
  return parts.join(" ");
}

/** Picks the right one of three Russian plural forms for a count. */
function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function ruInteger(digits: string, unit?: RuUnit): string {
  const groups = splitGroups(digits);
  const out: string[] = [];
  if (groups.every((g) => g === 0)) {
    out.push("ноль");
  } else {
    for (let i = groups.length - 1; i >= 0; i--) {
      const group = groups[i];
      if (!group) continue;
      if (i === 0) {
        out.push(ruThree(group, unit ? unit.gender : "m"));
      } else {
        out.push(ruThree(group, RU_SCALES[i].gender), pluralRu(group, RU_SCALES[i].forms));
      }
    }
  }
  if (unit) out.push(pluralRu(groups[0], unit.forms));
  return out.join(" ");
}

/** Root of the Russian fraction name for a denominator of 10^n: десят-, сот-, тысячн-, … */
const RU_FRACTION_SCALES = [
  "",
  "тысячн",
  "миллионн",
  "миллиардн",
  "триллионн",
  "квадриллионн",
  "квинтиллионн",
];

function ruFractionUnit(places: number): RuUnit {
  let root: string;
  if (places === 1) root = "десят";
  else if (places === 2) root = "сот";
  else root = ["", "десяти", "сто"][places % 3] + RU_FRACTION_SCALES[Math.floor(places / 3)];
  return { forms: [`${root}ая`, `${root}ых`, `${root}ых`], gender: "f" };
}

const RU_WHOLE: RuUnit = { forms: ["целая", "целых", "целых"], gender: "f" };

/** «одна целая пять десятых», «три целых четырнадцать сотых», «ноль целых сто двадцать пять тысячных». */
function ruDecimal(int: string, frac: string): string {
  const fracDigits = frac.replace(/^0+(?=\d)/, "");
  return `${ruInteger(int, RU_WHOLE)} ${ruInteger(fracDigits, ruFractionUnit(frac.length))}`;
}

/** Reads a run of digits one at a time: "56" → "five six" / «пять шесть». */
function digitsToWords(digits: string, lang: WordsLang): string {
  return digits
    .split("")
    .map((d) => (lang === "ru" ? RU_DIGITS[Number(d)] : EN_ONES[Number(d)]))
    .join(" ");
}

/** Adds one to a digit string without going through Number(). */
function incrementDigits(digits: string): string {
  const chars = digits.split("");
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] === "9") {
      chars[i] = "0";
      i--;
    } else {
      chars[i] = String(Number(chars[i]) + 1);
      break;
    }
  }
  if (i < 0) chars.unshift("1");
  return chars.join("");
}

/** Rounds the fractional digits to two places, carrying into the integer part if needed. */
function toMinorUnits(intDigits: string, frac: string): { int: string; minor: string } {
  const padded = `${frac}000`.slice(0, 3);
  let minor = Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) minor += 1;
  if (minor < 100) return { int: intDigits, minor: String(minor).padStart(2, "0") };

  const carried = incrementDigits(intDigits);
  // A carry past the last supported scale would have nothing to read it with.
  if (carried.length > MAX_INTEGER_DIGITS) {
    return { int: intDigits, minor: "99" };
  }
  return { int: carried, minor: "00" };
}

function groupDigits(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** Indian grouping: the last three digits, then pairs — 1,23,45,678. */
function groupDigitsIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${head},${digits.slice(-3)}`;
}

/** English ordinal of a cardinal phrase: "thirty-four" → "thirty-fourth". */
function toOrdinal(cardinal: string): string {
  const words = cardinal.split(" ");
  const last = words[words.length - 1];
  const segments = last.split("-");
  const tail = segments[segments.length - 1];
  const ordinal = EN_ORDINALS[tail];
  if (!ordinal) return "";
  segments[segments.length - 1] = ordinal;
  words[words.length - 1] = segments.join("-");
  return words.join(" ");
}

/**
 * Why an input was refused. The pages show their own text for each code (the English
 * `error` string is a fallback), so a Russian visitor never sees an English message.
 */
export type NumberErrorCode = "" | "empty" | "chars" | "separators" | "too-big";

const ERROR_TEXT: Record<Exclude<NumberErrorCode, "">, string> = {
  empty: "Enter a number.",
  chars: "Use digits only, with an optional decimal point.",
  separators: "That number has stray separators — check the commas and points.",
  "too-big": `That's too big — up to ${MAX_INTEGER_DIGITS} digits before the decimal point.`,
};

interface Parsed {
  negative: boolean;
  int: string;
  frac: string;
  error: string;
  errorCode: NumberErrorCode;
}

/** Thousands grouping written with `sep`: 1,234,567 — or the Indian 12,34,567 for commas. */
function isGrouping(intPart: string, sep: "," | "."): boolean {
  const s = sep === "," ? "," : "\\.";
  if (new RegExp(`^\\d{1,3}(${s}\\d{3})+$`).test(intPart)) return true;
  return sep === "," && /^\d{1,2}(,\d{2})+,\d{3}$/.test(intPart);
}

/**
 * Accepts the shapes people actually paste: "1234.56", "1,234.56", "1 234,56",
 * "$1,234.56", "-12". In English a lone comma followed by exactly three digits is a
 * thousands separator ("1,999" = 1999); in Russian the comma is the decimal separator,
 * so "1,999" is one point nine nine nine. Repeated separators must form real digit
 * groups: "1.2.3" is refused rather than read as 123.
 */
function parseNumber(raw: string, lang: WordsLang = "en"): Parsed | null {
  const fail = (negative: boolean, errorCode: Exclude<NumberErrorCode, "">): Parsed => ({
    negative,
    int: "",
    frac: "",
    error: ERROR_TEXT[errorCode],
    errorCode,
  });
  let s = raw.trim();
  if (!s) return null;

  let negative = false;
  if (/^[-−–]/.test(s)) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Currency codes and the rupee/rand abbreviations people type around the figure.
  s = s
    .replace(/^(?:rs\.?|inr|aed|zar|usd|eur|gbp|rub|uah|r(?=\s*\d))\s*/i, "")
    .replace(/\s*(?:\/-|inr|aed|zar|usd|eur|gbp|rub|uah)$/i, "");
  s = s.replace(/[\s'_$€£₽₴₹]/g, "");
  if (!s) return fail(negative, "empty");
  if (!/^[0-9.,]+$/.test(s)) return fail(negative, "chars");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let decimalAt = -1;

  if (lastComma >= 0 && lastDot >= 0) {
    // Both kinds: the last one is the decimal point, the other must group the digits.
    decimalAt = Math.max(lastComma, lastDot);
    const groupChar = decimalAt === lastComma ? "." : ",";
    if (!isGrouping(s.slice(0, decimalAt), groupChar)) return fail(negative, "separators");
    const removedBefore = s.slice(0, decimalAt).split(groupChar).length - 1;
    s = s.split(groupChar).join("");
    decimalAt -= removedBefore;
  } else if (lastComma >= 0) {
    const commas = s.split(",").length - 1;
    const tail = s.slice(lastComma + 1);
    if (commas === 1 && (lang === "ru" || tail.length !== 3)) {
      decimalAt = lastComma;
    } else if (isGrouping(s, ",")) {
      s = s.split(",").join("");
    } else {
      return fail(negative, "separators");
    }
  } else if (lastDot >= 0) {
    const dots = s.split(".").length - 1;
    if (dots === 1) {
      decimalAt = lastDot;
    } else if (isGrouping(s, ".")) {
      s = s.split(".").join("");
    } else {
      return fail(negative, "separators");
    }
  }

  let int = s;
  let frac = "";
  if (decimalAt >= 0) {
    int = s.slice(0, decimalAt);
    frac = s.slice(decimalAt + 1);
  }
  if (/[.,]/.test(int) || /[.,]/.test(frac)) return fail(negative, "separators");

  int = int.replace(/^0+(?=\d)/, "");
  if (!int) int = "0";
  // "1.50" keeps its trailing zero (people type cents that way), but "1.00" is just 1.
  if (/^0*$/.test(frac)) frac = "";

  if (int.length > MAX_INTEGER_DIGITS) {
    return fail(negative, "too-big");
  }
  if (frac.length > 20) frac = frac.slice(0, 20);

  return { negative, int, frac, error: "", errorCode: "" };
}

/** Applies a capitalisation style to a finished phrase. */
export function applyTextCase(text: string, style: TextCaseStyle): string {
  if (!text) return text;
  const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  if (style === "upper") return text.toUpperCase();
  if (style === "sentence") return capFirst(text);
  if (style === "title") {
    return text
      .split(" ")
      .map((word) => word.split("-").map(capFirst).join("-"))
      .join(" ");
  }
  return text;
}

/**
 * Converts a number written as text into words, currency wording, and an ordinal. Every
 * option has a default (English, no currency, international grouping, US "and"). A number
 * is read as its decimal string form; other non-string input gives the empty result.
 */
export function numberToWords(
  input: string,
  options: NumberToWordsOptions = {},
): NumberToWordsResult {
  const opts: NumberToWordsOptions = options ?? {};
  const lang: WordsLang = opts.lang === "ru" ? "ru" : "en";
  const currencyCode =
    opts.currency && Object.hasOwn(CURRENCIES, opts.currency) ? opts.currency : "none";
  const system: NumberSystem =
    lang === "en" && opts.system === "indian" ? "indian" : "international";
  const uk = lang === "en" && opts.andStyle === "uk";
  const text =
    typeof input === "string"
      ? input
      : typeof input === "number" && Number.isFinite(input)
        ? String(input)
        : "";
  const parsed = parseNumber(text, lang);
  if (!parsed) return { ...EMPTY };
  if (parsed.error) return { ...EMPTY, error: parsed.error, errorCode: parsed.errorCode };

  const { int, frac } = parsed;
  const isZero = int === "0" && frac === "";
  const negative = parsed.negative && !isZero;
  const minusWord = lang === "ru" ? "минус " : "minus ";
  const currency = currencyCode === "none" ? null : CURRENCIES[currencyCode];

  const groupSeparator = lang === "ru" ? " " : ",";
  const decimalSeparator = lang === "ru" ? "," : ".";
  const grouped =
    (negative ? "−" : "") +
    (system === "indian" ? groupDigitsIndian(int) : groupDigits(int, groupSeparator)) +
    (frac ? decimalSeparator + frac : "");

  // Plain reading. English speaks every fractional digit ("point five six"); Russian reads
  // a decimal fraction as a number of tenths, hundredths…: «одна целая пять десятых».
  const intWords = lang === "ru" ? ruInteger(int) : enInteger(int, system, uk);
  let words = intWords;
  if (frac)
    words = lang === "ru" ? ruDecimal(int, frac) : `${intWords} point ${digitsToWords(frac, lang)}`;
  if (negative) words = minusWord + words;

  // Cheque / currency wording — rounded to two decimals, the way an amount is written.
  const { int: payInt, minor } = toMinorUnits(int, frac);
  const minorValue = Number(minor);
  let cheque: string;
  let currencyWords = "";

  if (lang === "ru") {
    if (currency) {
      const majorPhrase = ruInteger(payInt, currency.ru.major);
      cheque = `${majorPhrase} ${minor} ${pluralRu(minorValue, currency.ru.minor.forms)}`;
      currencyWords =
        minorValue === 0
          ? majorPhrase
          : `${majorPhrase} ${ruThree(minorValue, currency.ru.minor.gender)} ${pluralRu(
              minorValue,
              currency.ru.minor.forms,
            )}`;
    } else {
      cheque = `${ruInteger(payInt)} и ${minor}/100`;
    }
  } else {
    const majorWords = enInteger(payInt, system, uk);
    if (currency) {
      const majorUnit = payInt === "1" ? currency.en.major[0] : currency.en.major[1];
      const minorUnit = minorValue === 1 ? currency.en.minor[0] : currency.en.minor[1];
      cheque = `${majorWords} ${majorUnit} and ${minor}/100`;
      currencyWords =
        minorValue === 0
          ? `${majorWords} ${majorUnit}`
          : `${majorWords} ${majorUnit} and ${enInteger(minor)} ${minorUnit}`;
    } else {
      cheque = `${majorWords} and ${minor}/100`;
    }
    if (opts.only) {
      cheque += " only";
      if (currencyWords) currencyWords += " only";
    }
  }
  if (negative) {
    cheque = minusWord + cheque;
    if (currencyWords) currencyWords = minusWord + currencyWords;
  }

  // Ordinals only make sense for a whole, non-negative count, and only in English here.
  const ordinal = lang === "en" && !frac && !negative ? toOrdinal(intWords) : "";

  return {
    ok: true,
    error: "",
    normalized: (negative ? "-" : "") + int + (frac ? `.${frac}` : ""),
    errorCode: "",
    grouped,
    groupedMoney:
      (negative ? "−" : "") +
      (system === "indian" ? groupDigitsIndian(payInt) : groupDigits(payInt, groupSeparator)) +
      decimalSeparator +
      minor,
    rounded: `${negative ? "-" : ""}${payInt}.${minor}`,
    words,
    cheque,
    currencyWords,
    ordinal,
    negative,
  };
}

export interface WordsToNumberResult {
  ok: boolean;
  /** Human-readable problem, or "" when there is none (or the input is empty). */
  error: string;
  /** The amount as plain digits: "1234.56", "-5", "4500000". */
  value: string;
}

const WORD_VALUES: Record<string, number> = Object.fromEntries([
  ...EN_ONES.map((w, i) => [w, i] as const),
  ...EN_TENS.slice(2).map((w, i) => [w, (i + 2) * 10] as const),
]);

const SCALE_ZEROS: Record<string, number> = {
  thousand: 3,
  thousands: 3,
  lakh: 5,
  lakhs: 5,
  lac: 5,
  lacs: 5,
  million: 6,
  millions: 6,
  crore: 7,
  crores: 7,
  billion: 9,
  billions: 9,
  trillion: 12,
  quadrillion: 15,
  quintillion: 18,
};

const MAJOR_UNITS = new Set<string>(
  [...Object.values(CURRENCIES).flatMap((c) => [...c.en.major]), "rouble", "roubles", "rs"].map(
    (w) => w.toLowerCase(),
  ),
);
const MINOR_UNITS = new Set<string>([
  ...Object.values(CURRENCIES).flatMap((c) => [...c.en.minor]),
  "kopek",
  "kopeks",
  "paisas",
  "pennies",
]);
/** Words that carry no value in a written amount. */
const FILLER = new Set(["and", "only", "exactly", "of", "us", "usd"]);

/** Adds words to a running total; BigInt so 21 digits survive. */
class Accumulator {
  total = 0n;
  current = 0n;
  lastScale = 0;
  used = false;

  /** Returns an error message, or "" when the word fits. */
  add(word: string, next: string | undefined): string {
    if (word === "a") {
      // "a hundred", "a thousand" — otherwise just an article.
      if (next === "hundred" || (next && next in SCALE_ZEROS)) return this.add("one", next);
      return "";
    }
    if (word in WORD_VALUES) {
      const v = BigInt(WORD_VALUES[word]);
      const clash = v >= 10n ? this.current % 100n !== 0n : this.current % 10n !== 0n;
      if (clash || (v === 0n && this.used)) return `"${word}" can't follow the word before it.`;
      this.current += v;
      this.used = true;
      return "";
    }
    if (word === "hundred" || word === "hundreds") {
      if (this.current === 0n) this.current = 1n;
      if (this.current >= 100n || this.current % 100n === 0n) {
        return `"${word}" can't follow the word before it.`;
      }
      this.current *= 100n;
      this.used = true;
      return "";
    }
    const zeros = SCALE_ZEROS[word];
    if (zeros) {
      if (this.current === 0n && this.total === 0n) return `"${word}" needs a number before it.`;
      if (zeros === this.lastScale) return `"${word}" appears twice in a row.`;
      const scale = 10n ** BigInt(zeros);
      // A bigger scale multiplies everything so far: "one lakh crore", "five thousand crore".
      if (zeros > this.lastScale) this.total = (this.total + this.current) * scale;
      else this.total += this.current * scale;
      this.current = 0n;
      this.lastScale = zeros;
      this.used = true;
      return "";
    }
    return `"${word}" isn't a number word.`;
  }

  value(): bigint {
    return this.total + this.current;
  }
}

/**
 * Reads an English amount written in words back into digits — the check that the line on
 * a cheque says what the figure says. Understands US and British "and", hyphens, lakh and
 * crore, "point five six", "and 56/100", "and fifty-six cents", currency names and "only".
 */
export function wordsToNumber(text: string): WordsToNumberResult {
  const fail = (error: string): WordsToNumberResult => ({ ok: false, error, value: "" });
  if (typeof text !== "string") return fail("");
  const tokens = text
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/[^a-z0-9/\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return fail("");

  let negative = false;
  if (tokens[0] === "minus" || tokens[0] === "negative") {
    negative = true;
    tokens.shift();
  }

  const major = new Accumulator();
  const minor = new Accumulator();
  let segment: "major" | "minor" | "point" = "major";
  let pointDigits = "";
  let fraction: string | null = null;
  let sawMajorUnit = false;
  let sawMinorUnit = false;
  let done = false;

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    if (FILLER.has(word)) continue;
    if (done) {
      if (MAJOR_UNITS.has(word) || MINOR_UNITS.has(word)) continue;
      if (/^\d{1,2}\/100$/.test(word)) return fail("The cents are written twice.");
      return fail(`"${word}" comes after the end of the amount.`);
    }
    const fractionMatch = /^(\d{1,2})\/100$/.exec(word);
    if (fractionMatch) {
      if (fraction !== null || minor.used) return fail("The cents are written twice.");
      fraction = fractionMatch[1].padStart(2, "0");
      continue;
    }
    if (MAJOR_UNITS.has(word)) {
      if (sawMajorUnit && !major.used) continue; // "rupees five thousand rupees"
      sawMajorUnit = true;
      if (major.used) segment = "minor";
      continue;
    }
    if (MINOR_UNITS.has(word)) {
      if (minor.used || fraction !== null) {
        done = true; // "… fifty-six cents" — the amount is complete
        continue;
      }
      if (sawMajorUnit) {
        segment = "minor"; // Indian style: "rupees five thousand and paise fifty"
        continue;
      }
      sawMinorUnit = true; // "fifty cents" — what came before was the minor part
      done = true;
      continue;
    }
    if (word === "point" || word === "dot") {
      if (segment === "point") return fail('"point" appears twice.');
      segment = "point";
      continue;
    }
    if (segment === "point") {
      const digit = WORD_VALUES[word];
      if (digit === undefined || digit > 9) {
        return fail(`After "point", spell the digits one by one: "point five six".`);
      }
      pointDigits += String(digit);
      continue;
    }
    if (/^\d+$/.test(word)) {
      if (segment !== "minor" || minor.used) return fail(`"${word}" — write the amount in words.`);
      minor.current = BigInt(word);
      minor.used = true;
      continue;
    }
    if (fraction !== null) return fail(`"${word}" comes after the /100 cents.`);
    const error = (segment === "minor" ? minor : major).add(word, tokens[i + 1]);
    if (error) return fail(error);
  }

  // "fifty cents" with no dollars: everything read so far was the minor part.
  if (sawMinorUnit && !sawMajorUnit && !minor.used) {
    minor.total = major.total;
    minor.current = major.current;
    minor.used = major.used;
    major.total = 0n;
    major.current = 0n;
    major.used = false;
  }
  if (!major.used && !minor.used && fraction === null) return fail("No number words found.");

  let frac = "";
  if (fraction !== null) frac = fraction;
  if (minor.used) {
    if (fraction !== null) return fail("The cents are written twice.");
    const cents = minor.value();
    if (cents >= 100n) return fail("The cents must be under 100.");
    frac = String(cents).padStart(2, "0");
  }
  if (pointDigits) {
    if (frac) return fail("Use either cents or a decimal point, not both.");
    frac = pointDigits;
  }

  const int = String(major.value());
  return { ok: true, error: "", value: (negative ? "-" : "") + int + (frac ? `.${frac}` : "") };
}

/** True when two plain-digit amounts are the same number: "1234.5" and "1234.50". */
export function amountsMatch(a: string, b: string): boolean {
  const norm = (s: string) => {
    const negative = s.startsWith("-");
    const [int = "", frac = ""] = s.replace(/^-/, "").split(".");
    const i = int.replace(/^0+(?=\d)/, "") || "0";
    const f = frac.replace(/0+$/, "");
    const zero = /^0*$/.test(i) && !f;
    return `${negative && !zero ? "-" : ""}${i}${f ? `.${f}` : ""}`;
  };
  return norm(a) === norm(b);
}
