import { describe, expect, it } from "vitest";
import {
  type CurrencyCode,
  MAX_INTEGER_DIGITS,
  amountsMatch,
  applyTextCase,
  numberToWords,
  wordsToNumber,
} from "./number-to-words-converter.js";

const en = (s: string) => numberToWords(s).words;
const ru = (s: string) => numberToWords(s, { lang: "ru" }).words;

describe("numberToWords — English", () => {
  it.each([
    ["0", "zero"],
    ["7", "seven"],
    ["11", "eleven"],
    ["15", "fifteen"],
    ["20", "twenty"],
    ["21", "twenty-one"],
    ["99", "ninety-nine"],
    ["100", "one hundred"],
    ["101", "one hundred one"],
    ["110", "one hundred ten"],
    ["1001", "one thousand one"],
    ["1234", "one thousand two hundred thirty-four"],
    ["1000000", "one million"],
    ["1000001", "one million one"],
    ["2000000000", "two billion"],
  ])("%s -> %s", (input, words) => {
    expect(en(input)).toBe(words);
  });

  it("reads 21 digits up to the quintillions", () => {
    expect(MAX_INTEGER_DIGITS).toBe(21);
    expect(en("999999999999999999999")).toBe(
      "nine hundred ninety-nine quintillion nine hundred ninety-nine quadrillion " +
        "nine hundred ninety-nine trillion nine hundred ninety-nine billion " +
        "nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine",
    );
  });

  it("rejects more than 21 integer digits", () => {
    const r = numberToWords("1000000000000000000000");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too big/);
  });

  it("reads decimals digit by digit and keeps a meaningful trailing zero", () => {
    expect(en("3.14")).toBe("three point one four");
    expect(en("1.50")).toBe("one point five zero");
    expect(en(".5")).toBe("zero point five");
    // All-zero fraction is dropped.
    expect(en("1.00")).toBe("one");
  });

  it("handles negatives (ASCII and unicode minus) but not negative zero", () => {
    const r = numberToWords("-12");
    expect(r.words).toBe("minus twelve");
    expect(r.negative).toBe(true);
    expect(r.normalized).toBe("-12");
    expect(r.grouped).toBe("−12");
    expect(en("−5")).toBe("minus five");
    const z = numberToWords("-0");
    expect(z.negative).toBe(false);
    expect(z.words).toBe("zero");
  });

  it("parses pasted formats: groups, currency signs, spaces, comma decimals", () => {
    expect(numberToWords("$1,234.56").normalized).toBe("1234.56");
    expect(numberToWords("1 234,56").normalized).toBe("1234.56");
    expect(numberToWords("1.234,56").normalized).toBe("1234.56");
    expect(numberToWords("1,5").normalized).toBe("1.5");
    expect(numberToWords("1,500").normalized).toBe("1500");
    expect(numberToWords("1.234.567").normalized).toBe("1234567");
    expect(numberToWords("+007").normalized).toBe("7");
    expect(numberToWords("1'000_000").normalized).toBe("1000000");
  });

  it("groups digits per language", () => {
    expect(numberToWords("1234567.8").grouped).toBe("1,234,567.8");
    expect(numberToWords("1234567.8", { lang: "ru" }).grouped).toBe("1 234 567,8");
  });

  it("refuses stray separators instead of gluing the digits", () => {
    for (const junk of ["1.2.3", "1,2,3", "12.34.5", "1,23.4,5", "1.2,34"]) {
      const r = numberToWords(junk);
      expect(r.ok, junk).toBe(false);
      expect(r.errorCode, junk).toBe("separators");
    }
    expect(numberToWords("1,234,567").normalized).toBe("1234567");
    expect(numberToWords("45,00,000").normalized).toBe("4500000");
    expect(numberToWords("1,23,456.78").normalized).toBe("123456.78");
  });

  it("returns an error code the page can translate", () => {
    expect(numberToWords("abc").errorCode).toBe("chars");
    expect(numberToWords("-").errorCode).toBe("empty");
    expect(numberToWords("1".repeat(22)).errorCode).toBe("too-big");
    expect(numberToWords("12").errorCode).toBe("");
    expect(numberToWords("").errorCode).toBe("");
  });

  it("formats the rounded money amount with two decimals", () => {
    expect(numberToWords("7800.5", { lang: "ru", currency: "rub" }).groupedMoney).toBe("7 800,50");
    expect(numberToWords("1234.567", { currency: "usd" }).groupedMoney).toBe("1,234.57");
    expect(numberToWords("-45000", { lang: "ru" }).groupedMoney).toBe("−45 000,00");
  });

  it("returns the blank result for empty input and an error for junk", () => {
    expect(numberToWords("").ok).toBe(false);
    expect(numberToWords("  ").error).toBe("");
    expect(numberToWords("abc").error).toMatch(/digits only/);
    expect(numberToWords("1e5").ok).toBe(false);
    expect(numberToWords("$").error).toBe("Enter a number.");
    expect(numberToWords("-").error).toBe("Enter a number.");
  });

  it("builds a cheque line and currency words with rounding to cents", () => {
    const r = numberToWords("1234.567", { currency: "usd" });
    expect(r.cheque).toBe("one thousand two hundred thirty-four dollars and 57/100");
    expect(r.currencyWords).toBe(
      "one thousand two hundred thirty-four dollars and fifty-seven cents",
    );
    expect(numberToWords("1", { currency: "usd" }).currencyWords).toBe("one dollar");
    expect(numberToWords("0.01", { currency: "usd" }).currencyWords).toBe(
      "zero dollars and one cent",
    );
    expect(numberToWords("2.01", { currency: "gbp" }).currencyWords).toBe(
      "two pounds and one penny",
    );
    expect(numberToWords("2.02", { currency: "gbp" }).currencyWords).toBe(
      "two pounds and two pence",
    );
  });

  it("carries a rounded-up fraction into the integer part", () => {
    const r = numberToWords("0.995", { currency: "usd" });
    expect(r.cheque).toBe("one dollar and 00/100");
    expect(numberToWords("9.999").cheque).toBe("ten and 00/100");
    // Plain reading keeps every digit.
    expect(numberToWords("0.995").words).toBe("zero point nine nine five");
  });

  it("does not carry past the largest supported scale", () => {
    expect(numberToWords("999999999999999999999.999").cheque).toMatch(/and 99\/100$/);
  });

  it("prefixes minus to the cheque and currency words", () => {
    const r = numberToWords("-5", { currency: "eur" });
    expect(r.cheque).toBe("minus five euros and 00/100");
    expect(r.currencyWords).toBe("minus five euros");
  });

  it("gives an English ordinal for whole non-negative numbers only", () => {
    expect(numberToWords("0").ordinal).toBe("zeroth");
    expect(numberToWords("1").ordinal).toBe("first");
    expect(numberToWords("12").ordinal).toBe("twelfth");
    expect(numberToWords("21").ordinal).toBe("twenty-first");
    expect(numberToWords("40").ordinal).toBe("fortieth");
    expect(numberToWords("100").ordinal).toBe("one hundredth");
    expect(numberToWords("103").ordinal).toBe("one hundred third");
    expect(numberToWords("1000000").ordinal).toBe("one millionth");
    expect(numberToWords("1.5").ordinal).toBe("");
    expect(numberToWords("-3").ordinal).toBe("");
    expect(numberToWords("3", { lang: "ru" }).ordinal).toBe("");
  });
});

describe("numberToWords — Russian", () => {
  it.each([
    ["0", "ноль"],
    ["1", "один"],
    ["2", "два"],
    ["11", "одиннадцать"],
    ["15", "пятнадцать"],
    ["21", "двадцать один"],
    ["100", "сто"],
    ["101", "сто один"],
    ["1000", "одна тысяча"],
    ["1001", "одна тысяча один"],
    ["2000", "две тысячи"],
    ["5000", "пять тысяч"],
    ["11000", "одиннадцать тысяч"],
    ["21000", "двадцать одна тысяча"],
    ["22000", "двадцать две тысячи"],
    ["1000000", "один миллион"],
    ["2000000", "два миллиона"],
    ["5000000", "пять миллионов"],
    ["1234567", "один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь"],
  ])("%s -> %s", (input, words) => {
    expect(ru(input)).toBe(words);
  });

  it("reads Russian decimals as whole units plus tenths, hundredths or thousandths, and negatives", () => {
    expect(ru("3,14")).toBe("три целых четырнадцать сотых");
    expect(ru("1,5")).toBe("одна целая пять десятых");
    expect(ru("2,5")).toBe("две целых пять десятых");
    expect(ru("21,1")).toBe("двадцать одна целая одна десятая");
    expect(ru("0,125")).toBe("ноль целых сто двадцать пять тысячных");
    expect(ru("1234,56")).toBe("одна тысяча двести тридцать четыре целых пятьдесят шесть сотых");
    expect(ru("0,01")).toBe("ноль целых одна сотая");
    expect(ru("0,0002")).toBe("ноль целых две десятитысячных");
    expect(ru("0,00001")).toBe("ноль целых одна стотысячная");
    expect(ru("1,000001")).toBe("одна целая одна миллионная");
    expect(ru("-0,5")).toBe("минус ноль целых пять десятых");
    expect(ru("-7")).toBe("минус семь");
  });

  it("reads a Russian comma as the decimal separator, even before three digits", () => {
    const r = numberToWords("1,999", { lang: "ru", currency: "rub" });
    expect(r.normalized).toBe("1.999");
    expect(r.cheque).toBe("два рубля 00 копеек");
    expect(numberToWords("0,125", { lang: "ru" }).grouped).toBe("0,125");
    expect(numberToWords("3,141", { lang: "ru" }).grouped).toBe("3,141");
    // English keeps the thousands reading of a lone comma before three digits.
    expect(numberToWords("1,999").normalized).toBe("1999");
    // Both separators: the last one is the decimal point on either page.
    expect(numberToWords("1.234,56", { lang: "ru" }).normalized).toBe("1234.56");
    expect(numberToWords("$1,234.56", { lang: "ru" }).normalized).toBe("1234.56");
  });

  it("agrees the currency in gender and number", () => {
    const rub = (s: string) => numberToWords(s, { lang: "ru", currency: "rub" });
    expect(rub("1").currencyWords).toBe("один рубль");
    expect(rub("2").currencyWords).toBe("два рубля");
    expect(rub("5").currencyWords).toBe("пять рублей");
    expect(rub("11").currencyWords).toBe("одиннадцать рублей");
    expect(rub("0").currencyWords).toBe("ноль рублей");
    // копейка is feminine: одна / две
    expect(rub("1.01").currencyWords).toBe("один рубль одна копейка");
    expect(rub("1.22").currencyWords).toBe("один рубль двадцать две копейки");
    expect(rub("1.12").currencyWords).toBe("один рубль двенадцать копеек");
    expect(rub("21.50").cheque).toBe("двадцать один рубль 50 копеек");
    // гривна is feminine
    const uah = numberToWords("2", { lang: "ru", currency: "uah" });
    expect(uah.currencyWords).toBe("две гривны");
    expect(numberToWords("1", { lang: "ru", currency: "eur" }).currencyWords).toBe("один евро");
  });

  it("writes a plain cheque line without currency", () => {
    expect(numberToWords("12.5", { lang: "ru" }).cheque).toBe("двенадцать и 50/100");
  });

  it("negates Russian cheque wording", () => {
    expect(numberToWords("-2", { lang: "ru", currency: "usd" }).currencyWords).toBe(
      "минус два доллара",
    );
  });
});

describe("applyTextCase", () => {
  it("applies each style", () => {
    const s = "twenty-one dollars";
    expect(applyTextCase(s, "lower")).toBe(s);
    expect(applyTextCase(s, "sentence")).toBe("Twenty-one dollars");
    expect(applyTextCase(s, "title")).toBe("Twenty-One Dollars");
    expect(applyTextCase(s, "upper")).toBe("TWENTY-ONE DOLLARS");
    expect(applyTextCase("один рубль", "title")).toBe("Один Рубль");
  });

  it("returns empty input untouched", () => {
    expect(applyTextCase("", "upper")).toBe("");
  });
});

describe("numberToWords — Indian numbering (lakh, crore)", () => {
  const indian = (s: string) => numberToWords(s, { system: "indian" });

  it.each([
    ["100000", "one lakh", "1,00,000"],
    ["504000", "five lakh four thousand", "5,04,000"],
    ["640000", "six lakh forty thousand", "6,40,000"],
    ["4500000", "forty-five lakh", "45,00,000"],
    ["10000000", "one crore", "1,00,00,000"],
    [
      "12345678",
      "one crore twenty-three lakh forty-five thousand six hundred seventy-eight",
      "1,23,45,678",
    ],
    ["1000000000", "one hundred crore", "1,00,00,00,000"],
    ["1000000000000", "one lakh crore", "10,00,00,00,00,000"],
    ["999", "nine hundred ninety-nine", "999"],
    ["0", "zero", "0"],
  ])("%s -> %s", (input, words, grouped) => {
    const r = indian(input);
    expect(r.words).toBe(words);
    expect(r.grouped).toBe(grouped);
  });

  it("parses pasted Indian grouping and spaces the way people type them", () => {
    expect(indian("45,00,000").words).toBe("forty-five lakh");
    expect(indian("45 00 000").words).toBe("forty-five lakh");
    expect(indian("6,40,000.50").grouped).toBe("6,40,000.50");
  });

  it("strips rupee, dirham and rand markers around the figure", () => {
    for (const raw of [
      "₹45,00,000",
      "Rs. 45,00,000",
      "Rs 4500000/-",
      "INR 4500000",
      "4500000 INR",
    ]) {
      expect(indian(raw).words, raw).toBe("forty-five lakh");
    }
    expect(numberToWords("AED 1,250.50").normalized).toBe("1250.50");
    expect(numberToWords("R 350").normalized).toBe("350");
    expect(numberToWords("rs").error).toBe("Enter a number.");
  });

  it("names rupees and paise, singular and plural", () => {
    expect(numberToWords("1.01", { currency: "inr" }).currencyWords).toBe(
      "one rupee and one paisa",
    );
    expect(numberToWords("4500000.50", { currency: "inr", system: "indian" }).currencyWords).toBe(
      "forty-five lakh rupees and fifty paise",
    );
  });

  it("is ignored on the Russian side", () => {
    expect(numberToWords("4500000", { lang: "ru", system: "indian" }).words).toBe(
      "четыре миллиона пятьсот тысяч",
    );
  });
});

describe("numberToWords — British and", () => {
  const uk = (s: string, system: "international" | "indian" = "international") =>
    numberToWords(s, { andStyle: "uk", system }).words;

  it.each([
    ["101", "one hundred and one"],
    ["115", "one hundred and fifteen"],
    ["200", "two hundred"],
    ["1005", "one thousand and five"],
    ["1100", "one thousand one hundred"],
    ["2350", "two thousand three hundred and fifty"],
    ["1000001", "one million and one"],
    ["1000100", "one million one hundred"],
    ["5", "five"],
  ])("%s -> %s", (input, words) => {
    expect(uk(input)).toBe(words);
  });

  it("works with Indian grouping and in ordinals", () => {
    expect(uk("1200005", "indian")).toBe("twelve lakh and five");
    expect(numberToWords("101", { andStyle: "uk" }).ordinal).toBe("one hundred and first");
  });

  it("leaves US style untouched by default", () => {
    expect(numberToWords("1005").words).toBe("one thousand five");
  });
});

describe("numberToWords — rupees, dirhams, rand and the word only", () => {
  it.each([
    ["aed", "1.01", "one dirham and one fils"],
    ["aed", "2.50", "two dirhams and fifty fils"],
    ["zar", "1", "one rand"],
    ["zar", "50.05", "fifty rand and five cents"],
    ["inr", "2.5", "two rupees and fifty paise"],
  ] as const)("%s %s -> %s", (currency, input, words) => {
    expect(numberToWords(input, { currency }).currencyWords).toBe(words);
  });

  it("appends only to the cheque and currency lines, not to the plain reading", () => {
    const r = numberToWords("5000", { currency: "inr", only: true });
    expect(r.cheque).toBe("five thousand rupees and 00/100 only");
    expect(r.currencyWords).toBe("five thousand rupees only");
    expect(r.words).toBe("five thousand");
    expect(numberToWords("12", { only: true }).cheque).toBe("twelve and 00/100 only");
  });

  it("declines the new currencies in Russian", () => {
    expect(numberToWords("2.02", { lang: "ru", currency: "inr" }).currencyWords).toBe(
      "две рупии две пайсы",
    );
    expect(numberToWords("5", { lang: "ru", currency: "aed" }).currencyWords).toBe("пять дирхамов");
  });

  it("reports the rounded amount the money lines spell out", () => {
    expect(numberToWords("3.999").rounded).toBe("4.00");
    expect(numberToWords("-1234.5").rounded).toBe("-1234.50");
  });
});

describe("wordsToNumber", () => {
  it.each([
    ["One thousand two hundred thirty-four and 56/100", "1234.56"],
    ["One thousand two hundred thirty-four dollars and 56/100", "1234.56"],
    ["five dollars and fifty-six cents", "5.56"],
    ["fifty cents", "0.50"],
    ["one hundred and one", "101"],
    ["ONE HUNDRED ONE", "101"],
    ["a hundred", "100"],
    ["twelve hundred", "1200"],
    ["three point one four", "3.14"],
    ["minus seven", "-7"],
    ["zero", "0"],
    ["forty-five lakh", "4500000"],
    ["Rupees forty-five lakh and paise fifty only", "4500000.50"],
    ["one lakh crore", "1000000000000"],
    ["five thousand crore twenty lakh", "50002000000"],
    ["two million five hundred thousand", "2500000"],
    ["two thousand pounds and five pence", "2000.05"],
    ["fifty rand and 5/100", "50.05"],
  ])("%s -> %s", (text, value) => {
    const r = wordsToNumber(text);
    expect(r.error).toBe("");
    expect(r.value).toBe(value);
  });

  it.each([
    ["one one", /can't follow/],
    ["five twenty", /can't follow/],
    ["hello", /isn't a number word/],
    ["thousand", /needs a number/],
    ["one thousand two thousand", /twice/],
    ["five dollars and one hundred cents", /under 100/],
    ["five and 50/100 and fifty cents", /after the \/100/],
    ["five dollars and fifty cents and 50/100", /twice/],
    ["five dollars and fifty cents and three", /after the end/],
    ["three point fourteen", /one by one/],
    ["five dollars and 50/100 point five", /not both/],
    ["dollars", /No number words/],
  ])("rejects %s", (text, error) => {
    const r = wordsToNumber(text);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(error);
  });

  it("returns a silent blank for empty input", () => {
    expect(wordsToNumber("   ")).toEqual({ ok: false, error: "", value: "" });
  });

  it("reads back every line the converter writes, in every style", () => {
    const samples = [
      "0.01",
      "7",
      "19.99",
      "101",
      "1005.5",
      "4462.50",
      "45000",
      "504000",
      "1234567.89",
      "100000000",
      "-250.75",
      "999999999999999999999.99",
    ];
    const currencies: CurrencyCode[] = ["none", "usd", "gbp", "inr", "aed", "zar"];
    for (const sample of samples) {
      for (const currency of currencies) {
        for (const system of ["international", "indian"] as const) {
          for (const andStyle of ["us", "uk"] as const) {
            const r = numberToWords(sample, { currency, system, andStyle, only: true });
            for (const line of [r.cheque, r.currencyWords].filter(Boolean)) {
              const back = wordsToNumber(line);
              expect(back.error, `${sample} ${currency} ${system} ${andStyle}: ${line}`).toBe("");
              expect(amountsMatch(back.value, r.rounded), line).toBe(true);
            }
            if (!r.words.includes("point")) {
              expect(amountsMatch(wordsToNumber(r.words).value, r.normalized), r.words).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe("amountsMatch", () => {
  it("ignores trailing fraction zeros and leading integer zeros", () => {
    expect(amountsMatch("1234.5", "1234.50")).toBe(true);
    expect(amountsMatch("0100", "100.00")).toBe(true);
    expect(amountsMatch("-0.00", "0")).toBe(true);
  });

  it("tells different amounts apart", () => {
    expect(amountsMatch("1234.56", "1243.56")).toBe(false);
    expect(amountsMatch("-5", "5")).toBe(false);
    expect(amountsMatch("1.5", "15")).toBe(false);
  });
});

describe("defaults and non-string input", () => {
  it("uses English, no currency and international grouping without options", () => {
    const r = numberToWords("1234");
    expect(r.words).toBe("one thousand two hundred thirty-four");
    expect(r.currencyWords).toBe("");
    expect(numberToWords("1234", null as unknown as undefined).words).toBe(r.words);
  });

  it("treats an unknown currency code as no currency", () => {
    const r = numberToWords("5", { currency: "constructor" as CurrencyCode });
    expect(r.ok).toBe(true);
    expect(r.currencyWords).toBe("");
  });

  it("reads a finite number as its decimal string and ignores other types", () => {
    expect(numberToWords(21 as unknown as string).words).toBe("twenty-one");
    expect(numberToWords(undefined as unknown as string).ok).toBe(false);
    expect(numberToWords({} as unknown as string).ok).toBe(false);
    expect(wordsToNumber(null as unknown as string).ok).toBe(false);
  });
});
