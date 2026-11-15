import { describe, expect, it } from "vitest";
import { Hunspell } from "./_hunspell.js";

/** A small synthetic dictionary exercising every directive the reader understands. */
const AFF = [
  "# A comment line, followed by a blank line",
  "",
  "SET UTF-8",
  "TRY esiarntolcdug",
  "NOSUGGEST !",
  "ONLYINCOMPOUND c",
  "NEEDAFFIX n",
  "FORBIDDENWORD f",
  "REP 2",
  "REP ie ei",
  "REP alot a_lot",
  "ICONV 1",
  "ICONV ’ '",
  "PFX U Y 1",
  "PFX U 0 un .",
  "PFX R N 1",
  "PFX R 0 re .",
  "PFX I Y 2",
  "PFX I 0 il l",
  "PFX I 0 in [^l]",
  "PFX A Y 1",
  "PFX A e a e",
  "SFX S Y 2",
  "SFX S y ies [^aeiou]y",
  "SFX S 0 s [^y]",
  "SFX G N 1",
  "SFX G e ing e",
  "SFX T Y 1",
  "SFX T 0 ed/X [^e]",
].join("\n");

const DIC = [
  "13",
  "city/S",
  "make/GRS",
  "lock/US",
  "walk/T",
  "legal/I",
  "active/I",
  "nod/nS",
  "bad/fS",
  "1th/c",
  "darn/!",
  "eat/A",
  "work/S",
  "work/U",
  "run/S\tpo:verb st:run",
  "don't",
  "/S",
  "",
].join("\n");

const h = new Hunspell(AFF, DIC);

describe("Hunspell dictionary loading", () => {
  it("skips the word-count header, empty lines and empty stems, and merges homonyms", () => {
    // city make lock walk legal active nod bad 1th darn eat work run don't
    expect(h.size).toBe(14);
  });

  it("drops morphological data after a tab", () => {
    expect(h.check("run")).toBe(true);
    expect(h.check("runs")).toBe(true);
    expect(h.check("po:verb")).toBe(false);
  });

  it("reads a .dic without a count line and with CRLF line endings", () => {
    const crlf = new Hunspell("SFX S Y 1\r\nSFX S 0 s .\r\n", "apple\r\nbanana/S\r\n");
    expect(crlf.size).toBe(2);
    expect(crlf.check("apple")).toBe(true);
    expect(crlf.check("bananas")).toBe(true);
    expect(crlf.check("apples")).toBe(false);
  });

  it("treats a count line with trailing spaces as a header, not a word", () => {
    const d = new Hunspell("", "2  \nfoo\nbar");
    expect(d.size).toBe(2);
    expect(d.check("2")).toBe(false);
  });

  it("exposes TRY letters and REP pairs, ignoring the REP count line", () => {
    expect(h.tryChars).toBe("esiarntolcdug");
    expect(h.rep).toEqual([
      ["ie", "ei"],
      ["alot", "a_lot"],
    ]);
  });

  it("works with an empty affix file", () => {
    const plain = new Hunspell("", "1\nhello");
    expect(plain.tryChars).toBe("");
    expect(plain.rep).toEqual([]);
    expect(plain.check("hello")).toBe(true);
    expect(plain.check("hellos")).toBe(false);
    expect(plain.suggestable("hello")).toBe(true);
  });
});

describe("Hunspell.check", () => {
  it("rejects the empty string and is case-sensitive", () => {
    expect(h.check("")).toBe(false);
    expect(h.check("City")).toBe(false);
  });

  it("accepts suffixed forms only when the suffix condition holds", () => {
    expect(h.check("cities")).toBe(true);
    expect(h.check("citys")).toBe(false);
    expect(h.check("locks")).toBe(true);
    expect(h.check("making")).toBe(true);
    expect(h.check("makeing")).toBe(false);
  });

  it("ignores continuation classes in the affix text", () => {
    expect(h.check("walked")).toBe(true);
    expect(h.check("walked/X")).toBe(false);
  });

  it("does not apply a suffix to a stem without its flag", () => {
    expect(h.check("walks")).toBe(false);
    expect(h.check("citied")).toBe(false);
  });

  it("checks prefix conditions against the stem", () => {
    expect(h.check("illegal")).toBe(true);
    expect(h.check("inactive")).toBe(true);
    expect(h.check("inlegal")).toBe(false);
    expect(h.check("ilactive")).toBe(false);
  });

  it("restores the stripped part of a prefix", () => {
    // PFX A strips a leading "e" and adds "a": eat -> aat.
    expect(h.check("aat")).toBe(true);
    expect(h.check("aeat")).toBe(false);
  });

  it("combines a prefix and a suffix only when both are cross products", () => {
    expect(h.check("unlocks")).toBe(true);
    expect(h.check("remake")).toBe(true);
    expect(h.check("remakes")).toBe(false); // PFX R is not a cross product
    expect(h.check("remaking")).toBe(false); // neither is SFX G
  });

  it("uses flags from every homonym line", () => {
    expect(h.check("works")).toBe(true);
    expect(h.check("unwork")).toBe(true);
    expect(h.check("unworks")).toBe(true);
  });

  it("requires an affix on NEEDAFFIX stems", () => {
    expect(h.check("nod")).toBe(false);
    expect(h.check("nods")).toBe(true);
  });

  it("rejects FORBIDDENWORD stems and their derived forms", () => {
    expect(h.check("bad")).toBe(false);
    expect(h.check("bads")).toBe(false);
  });

  it("rejects ONLYINCOMPOUND stems on their own", () => {
    expect(h.check("1th")).toBe(false);
  });

  it("accepts NOSUGGEST words", () => {
    expect(h.check("darn")).toBe(true);
  });
});

describe("Hunspell.normalize", () => {
  it("applies ICONV conversions, so typographic apostrophes match the dictionary", () => {
    expect(h.normalize("don’t")).toBe("don't");
    expect(h.check("don’t")).toBe(false);
    expect(h.check(h.normalize("don’t"))).toBe(true);
  });

  it("replaces every occurrence and leaves other text alone", () => {
    expect(h.normalize("’a’")).toBe("'a'");
    expect(h.normalize("plain")).toBe("plain");
  });
});

describe("Hunspell.suggestable", () => {
  it("hides NOSUGGEST words and allows everything else, including unknown words", () => {
    expect(h.suggestable("darn")).toBe(false);
    expect(h.suggestable("city")).toBe(true);
    expect(h.suggestable("unknownword")).toBe(true);
  });
});
