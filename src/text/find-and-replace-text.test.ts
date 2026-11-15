import { describe, expect, it } from "vitest";
import { escapeRegExp, findAndReplace } from "./find-and-replace-text.js";

describe("escapeRegExp", () => {
  it("escapes every regex metacharacter", () => {
    const special = ".*+?^${}()|[]\\";
    expect(new RegExp(escapeRegExp(special)).test(`x${special}y`)).toBe(true);
    expect(escapeRegExp("a.b")).toBe("a\\.b");
  });
});

describe("findAndReplace", () => {
  it("returns the text unchanged with zero counts for empty text or empty find", () => {
    expect(findAndReplace("", "a", "b")).toMatchObject({ output: "", matchCount: 0, valid: true });
    expect(findAndReplace("abc", "", "x")).toMatchObject({
      output: "abc",
      matchCount: 0,
      replacements: 0,
    });
  });

  it("replaces every literal match, case-insensitive by default", () => {
    const r = findAndReplace("Cat cat CAT dog", "cat", "fox");
    expect(r.output).toBe("fox fox fox dog");
    expect(r.matchCount).toBe(3);
    expect(r.replacements).toBe(3);
    expect(r.linesAffected).toBe(1);
  });

  it("respects caseSensitive", () => {
    expect(findAndReplace("Cat cat", "cat", "fox", { caseSensitive: true }).output).toBe("Cat fox");
  });

  it("treats regex characters literally when useRegex is off", () => {
    expect(findAndReplace("a.b axb", ".", "!").output).toBe("a!b axb");
  });

  it("counts distinct affected lines", () => {
    const r = findAndReplace("a a\nb\na", "a", "z");
    expect(r.output).toBe("z z\nb\nz");
    expect(r.linesAffected).toBe(2);
  });

  it("wholeWord uses Unicode word boundaries (Latin and Cyrillic)", () => {
    expect(
      findAndReplace("cat category bobcat cat_x", "cat", "X", { wholeWord: true }).output,
    ).toBe("X category bobcat cat_x");
    expect(findAndReplace("кот котёнок кот", "кот", "пёс", { wholeWord: true }).output).toBe(
      "пёс котёнок пёс",
    );
  });

  it("firstOnly replaces only the first match but counts all", () => {
    const r = findAndReplace("a a a", "a", "b", { firstOnly: true });
    expect(r.output).toBe("b a a");
    expect(r.matchCount).toBe(3);
    expect(r.replacements).toBe(1);
  });

  it("preserveCase mirrors lower, Capitalised and ALL CAPS", () => {
    const r = findAndReplace("cat Cat CAT cAt", "cat", "dog", { preserveCase: true });
    // mixed case "cAt" keeps the replacement as typed
    expect(r.output).toBe("dog Dog DOG dog");
    expect(findAndReplace("Кот", "кот", "пёс", { preserveCase: true }).output).toBe("Пёс");
    // a single upper-case letter counts as Capitalised, not ALL CAPS
    expect(findAndReplace("A", "a", "xy", { preserveCase: true }).output).toBe("Xy");
  });

  it("expands $1, named groups, $&, $$ and $` / $' in regex mode", () => {
    const opts = { useRegex: true, caseSensitive: true };
    expect(findAndReplace("John Smith", "(\\w+) (\\w+)", "$2, $1", opts).output).toBe(
      "Smith, John",
    );
    expect(
      findAndReplace("2026-11-14", "(?<y>\\d+)-(?<m>\\d+)-(?<d>\\d+)", "$<d>.$<m>.$<y>", opts)
        .output,
    ).toBe("14.11.2026");
    expect(findAndReplace("cost 5", "\\d", "$$$&", opts).output).toBe("cost $5");
    expect(findAndReplace("abc", "b", "[$`|$']", opts).output).toBe("a[a|c]c");
    // $12 with only one group = group 1 followed by "2"; $9 with no group 9 stays literal
    expect(findAndReplace("x", "(x)", "$12-$9", opts).output).toBe("x2-$9");
  });

  it("does not expand $ templates in literal mode", () => {
    expect(findAndReplace("a", "a", "$&$&").output).toBe("$&$&");
  });

  it("handles zero-length regex matches without looping forever", () => {
    expect(findAndReplace("ab\ncd", "^", "> ", { useRegex: true }).output).toBe("> ab\n> cd");
    const r = findAndReplace("abc", "x*", "-", { useRegex: true });
    // matches before a, b, c and at the end
    expect(r.output).toBe("-a-b-c-");
    expect(r.matchCount).toBe(4);
  });

  it("reports an invalid regex instead of throwing", () => {
    const r = findAndReplace("abc", "(", "x", { useRegex: true });
    expect(r.valid).toBe(false);
    expect(r.error).not.toBe("");
    expect(r.output).toBe("abc");
  });

  it("stops at 100,000 matches and flags the limit", () => {
    const r = findAndReplace("a".repeat(100_005), "a", "b");
    expect(r.matchCount).toBe(100_000);
    expect(r.limitReached).toBe(true);
    // the tail after the cap is left as it was
    expect(r.output).toBe(`${"b".repeat(100_000)}aaaaa`);
  });

  it("replaces emoji", () => {
    expect(findAndReplace("I 👍 it", "👍", "❤️").output).toBe("I ❤️ it");
  });
});
