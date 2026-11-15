import { describe, expect, it } from "vitest";
import { slugify } from "./url-slug-generator.js";

const hy = { separator: "-" as const, lowercase: true };
const us = { separator: "_" as const, lowercase: true };

describe("slugify", () => {
  it("returns an empty slug for empty / whitespace input", () => {
    expect(slugify("", hy)).toEqual({ slug: "", length: 0 });
    expect(slugify("   \n", hy)).toEqual({ slug: "", length: 0 });
  });

  it("lowercases and joins words with the separator", () => {
    expect(slugify("Hello World", hy)).toEqual({ slug: "hello-world", length: 11 });
    expect(slugify("Hello World", us).slug).toBe("hello_world");
  });

  it("collapses punctuation runs and trims leading/trailing separators", () => {
    expect(slugify("  --Hello,   World!!  ", hy).slug).toBe("hello-world");
    expect(slugify("a___b", us).slug).toBe("a_b");
    expect(slugify("10 Tips & Tricks (2024)", hy).slug).toBe("10-tips-tricks-2024");
  });

  it("keeps case when lowercase is off", () => {
    expect(slugify("Hello World", { separator: "-", lowercase: false }).slug).toBe("Hello-World");
  });

  it("strips Latin diacritics (page example: Café münchen)", () => {
    expect(slugify("Café münchen", hy).slug).toBe("cafe-munchen");
    expect(slugify("Ñandú", hy).slug).toBe("nandu");
  });

  it("transliterates Russian Cyrillic", () => {
    expect(slugify("Привет мир", hy).slug).toBe("privet-mir");
    expect(slugify("Щука и ёжик", hy).slug).toBe("shchuka-i-ezhik");
    // ъ and ь vanish
    expect(slugify("подъезд мальчик", hy).slug).toBe("podezd-malchik");
    // Upper-case multi-letter mappings keep a capital only on the first letter
    expect(slugify("Жук", { separator: "-", lowercase: false }).slug).toBe("Zhuk");
  });

  it("falls back to the hyphen for an unknown separator", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing a runtime guard
    expect(slugify("a b", { separator: "+" as any, lowercase: true }).slug).toBe("a-b");
  });

  it("returns an empty slug when nothing survives", () => {
    expect(slugify("!!! 👍 ???", hy).slug).toBe("");
    expect(slugify("中文", hy).slug).toBe("");
  });

  it("transliterates Ukrainian letters", () => {
    expect(slugify("Київ", hy).slug).toBe("kyiv");
    expect(slugify("Євген Їжак, Харків", hy).slug).toBe("yevhen-yizhak-kharkiv");
    // Russian text keeps the Russian table
    expect(slugify("Химия", hy).slug).toBe("himiya");
  });

  it("maps ß to ss", () => {
    expect(slugify("Straße", hy).slug).toBe("strasse");
  });

  it("defaults to a lowercase hyphen slug when options are left out", () => {
    expect(slugify("Hello World").slug).toBe("hello-world");
    expect(slugify("Hello World", {}).slug).toBe("hello-world");
    expect(slugify("Hello World", { separator: "_" }).slug).toBe("hello_world");
    expect(slugify("Hello World", { lowercase: false }).slug).toBe("Hello-World");
  });

  it("returns an empty slug for non-string input", () => {
    for (const bad of [undefined, null, 42, {}]) {
      expect(slugify(bad as unknown as string)).toEqual({ slug: "", length: 0 });
    }
  });
});
