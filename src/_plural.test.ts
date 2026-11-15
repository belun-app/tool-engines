import { describe, expect, it, vi } from "vitest";
import { pluralCategory, pluralForm, ruPlural } from "./_plural.js";

const CYCLE_RU = "цикл|цикла|циклов";
const WORD_RU: [string, string, string] = ["слово", "слова", "слов"];

describe("pluralForm (RU)", () => {
  it.each([
    [0, "циклов"],
    [1, "цикл"],
    [2, "цикла"],
    [4, "цикла"],
    [5, "циклов"],
    [11, "циклов"],
    [12, "циклов"],
    [14, "циклов"],
    [21, "цикл"],
    [22, "цикла"],
    [25, "циклов"],
    [101, "цикл"],
    [111, "циклов"],
    [1.5, "цикла"],
  ])("%s -> %s", (n, form) => {
    expect(pluralForm(n, CYCLE_RU, "ru")).toBe(form);
  });

  it("uses the right Russian forms for 5, 72 and 2", () => {
    expect(`5 ${pluralForm(5, CYCLE_RU, "ru")}`).toBe("5 циклов");
    expect(`72 ${ruPlural(72, WORD_RU)}`).toBe("72 слова");
    expect(`2 ${pluralForm(2, "адрес|адреса|адресов", "ru")}`).toBe("2 адреса");
  });

  it("uses a 4th form for fractions when given", () => {
    expect(pluralForm(2.5, ["минута", "минуты", "минут", "минуты"], "ru")).toBe("минуты");
  });

  it("treats negatives like their absolute value", () => {
    expect(pluralForm(-1, CYCLE_RU, "ru")).toBe("цикл");
    expect(pluralForm(-5, CYCLE_RU, "ru")).toBe("циклов");
  });
});

describe("pluralForm (EN)", () => {
  it("has one and other", () => {
    expect(pluralForm(1, "cycle|cycles", "en")).toBe("cycle");
    expect(pluralForm(0, "cycle|cycles", "en")).toBe("cycles");
    expect(pluralForm(2, "cycle|cycles", "en")).toBe("cycles");
    expect(pluralForm(1.5, "cycle|cycles", "en")).toBe("cycles");
  });

  it("repeats a single form", () => {
    expect(pluralForm(3, "px", "en")).toBe("px");
    expect(pluralForm(3, "шт.", "ru")).toBe("шт.");
  });
});

describe("pluralCategory", () => {
  it("follows CLDR", () => {
    expect(pluralCategory(1, "ru")).toBe("one");
    expect(pluralCategory(3, "ru-RU")).toBe("few");
    expect(pluralCategory(7, "ru")).toBe("many");
    expect(pluralCategory(1, "en")).toBe("one");
    expect(pluralCategory(7, "en")).toBe("other");
  });
});

describe("without Intl.PluralRules (fallback)", () => {
  const stubNoPluralRules = () => vi.stubGlobal("Intl", { ...Intl, PluralRules: undefined });

  it("matches the CLDR categories for Russian integers", () => {
    const ns = [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112, 1001, -1, -3, -11];
    const expected = ns.map((n) => pluralCategory(n, "ru"));
    stubNoPluralRules();
    expect(typeof Intl.PluralRules).toBe("undefined");
    expect(ns.map((n) => pluralCategory(n, "ru-RU"))).toEqual(expected);
  });

  it("puts Russian fractions in the 'other' category", () => {
    stubNoPluralRules();
    expect(pluralCategory(1.5, "ru")).toBe("other");
    expect(pluralForm(1.5, CYCLE_RU, "ru")).toBe("цикла");
    expect(pluralForm(2.5, ["минута", "минуты", "минут", "минуты (дробь)"], "ru")).toBe(
      "минуты (дробь)",
    );
  });

  it("picks Russian forms the same way as with Intl", () => {
    stubNoPluralRules();
    expect(pluralForm(1, CYCLE_RU, "ru")).toBe("цикл");
    expect(pluralForm(3, CYCLE_RU, "ru")).toBe("цикла");
    expect(pluralForm(13, CYCLE_RU, "ru")).toBe("циклов");
    expect(ruPlural(72, WORD_RU)).toBe("слова");
  });

  it("uses 'one' only for exactly 1 in English", () => {
    stubNoPluralRules();
    expect(pluralCategory(1, "en")).toBe("one");
    expect(pluralCategory(0, "en")).toBe("other");
    expect(pluralCategory(1.5, "en-US")).toBe("other");
    expect(pluralForm(1, "cycle|cycles", "en")).toBe("cycle");
    expect(pluralForm(2, "cycle|cycles", "en")).toBe("cycles");
  });

  it("works when Intl itself is missing", () => {
    vi.stubGlobal("Intl", undefined);
    expect(pluralCategory(22, "ru")).toBe("few");
    expect(pluralCategory(1, "de")).toBe("one");
    expect(pluralCategory(7, "de")).toBe("other");
  });
});

describe("pluralForm edge cases", () => {
  it("returns an empty string for an empty form list", () => {
    expect(pluralForm(3, [], "ru")).toBe("");
    expect(pluralForm(3, [], "en")).toBe("");
  });

  it("treats every non-Russian language with the English rules", () => {
    expect(pluralForm(1, "Zyklus|Zyklen", "de")).toBe("Zyklus");
    expect(pluralForm(5, "Zyklus|Zyklen", "de")).toBe("Zyklen");
    expect(pluralCategory(5, "RU")).toBe("many");
  });

  it("falls back to the previous form when Russian forms are missing", () => {
    expect(pluralForm(5, ["цикл", "цикла"], "ru")).toBe("цикла");
    expect(pluralForm(1.5, "цикл", "ru")).toBe("цикл");
  });
});
