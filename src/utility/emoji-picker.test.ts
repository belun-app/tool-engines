import { describe, expect, it } from "vitest";
import {
  EMOJI_GROUPS,
  EMOJI_LIST,
  SKIN_TONE_MODIFIERS,
  applySkinTone,
  findEmoji,
  searchEmoji,
  stripSkinTone,
  toCodePoints,
} from "./emoji-picker.js";

/**
 * `\p{RGI_Emoji}` needs the v flag (ES2024, Node 20+). The pattern is built at run time so
 * the file still parses and type-checks for older targets; where the flag is missing,
 * the two checks that need it are skipped.
 */
const RGI = (() => {
  try {
    // biome-ignore lint/complexity/useRegexLiterals: a v-flag literal does not parse on Node 18
    return new RegExp("^\\p{RGI_Emoji}$", "v");
  } catch {
    return null;
  }
})();
const isRgi = (s: string) => (RGI as RegExp).test(s);
const MODIFIER_BASE = /^\p{Emoji_Modifier_Base}/u;

describe("EMOJI_LIST data", () => {
  it("covers all nine groups", () => {
    expect(EMOJI_GROUPS.map((g) => g.id)).toEqual([
      "smileys",
      "people",
      "animals",
      "food",
      "activity",
      "travel",
      "objects",
      "symbols",
      "flags",
    ]);
    for (const g of EMOJI_GROUPS) expect(EMOJI_LIST.some((e) => e.group === g.id)).toBe(true);
  });

  it("has no duplicate characters", () => {
    const seen = new Map<string, number>();
    for (const e of EMOJI_LIST) seen.set(e.char, (seen.get(e.char) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([c]) => c)).toEqual([]);
  });

  it.skipIf(!RGI)(
    "every entry is a fully-qualified RGI emoji with EN and RU names and keywords",
    () => {
      const bad = EMOJI_LIST.filter(
        (e) =>
          !isRgi(e.char) ||
          !e.name ||
          !e.nameRu ||
          e.keywords.length === 0 ||
          e.keywordsRu.length === 0,
      ).map((e) => e.char);
      expect(bad).toEqual([]);
    },
  );

  it("only marks real Emoji_Modifier_Base characters as tone-able", () => {
    const bad = EMOJI_LIST.filter((e) => e.tone && !MODIFIER_BASE.test(e.char)).map((e) => e.char);
    expect(bad).toEqual([]);
  });

  it("parses rows into structured entries", () => {
    expect(findEmoji("👍")).toEqual({
      char: "👍",
      name: "thumbs up",
      nameRu: "палец вверх",
      keywords: ["like", "yes", "approve"],
      keywordsRu: ["лайк", "одобрение"],
      group: "people",
      tone: true,
    });
    expect(findEmoji("🔥")?.tone).toBe(false);
  });
});

describe("skin tones", () => {
  it("lists the five Fitzpatrick modifiers after the default", () => {
    expect(SKIN_TONE_MODIFIERS.map((m) => m.codePointAt(0)?.toString(16))).toEqual([
      undefined,
      "1f3fb",
      "1f3fc",
      "1f3fd",
      "1f3fe",
      "1f3ff",
    ]);
  });

  it("puts the modifier right after the base code point", () => {
    expect(applySkinTone("👍", 3)).toBe("👍\u{1F3FD}");
    // ZWJ sequence: 👩 + tone + ZWJ + 💻
    expect(applySkinTone("👩‍💻", 1)).toBe("👩\u{1F3FB}‍💻");
  });

  it("drops the emoji presentation selector when toning (✌️ -> ✌🏽)", () => {
    expect(applySkinTone("✌️", 3)).toBe("✌\u{1F3FD}");
  });

  it("replaces an existing tone and strips it for tone 0 / unknown tones", () => {
    expect(applySkinTone("👍\u{1F3FB}", 5)).toBe("👍\u{1F3FF}");
    expect(applySkinTone("👍\u{1F3FB}", 0)).toBe("👍");
    expect(applySkinTone("👍", 9)).toBe("👍");
    expect(applySkinTone("", 2)).toBe("");
  });

  it.skipIf(!RGI)(
    "produces RGI sequences for every tone-able emoji without an FE0F after a ZWJ",
    () => {
      const vsAfterZwj = (c: string) => /‍.*️/u.test(c);
      const bad = EMOJI_LIST.filter((e) => e.tone && !vsAfterZwj(e.char))
        .flatMap((e) => [1, 2, 3, 4, 5].map((t) => applySkinTone(e.char, t)))
        .filter((s) => !isRgi(s));
      expect(bad).toEqual([]);
    },
  );

  it("keeps the FE0F of the last ZWJ component (👩‍⚕️ + tone -> 👩🏽‍⚕️)", () => {
    expect(applySkinTone("👩‍⚕️", 3)).toBe("👩\u{1F3FD}‍⚕️");
  });

  it("strips modifiers and finds toned emoji", () => {
    expect(stripSkinTone("👍\u{1F3FE}")).toBe("👍");
    expect(findEmoji("👍\u{1F3FE}")?.name).toBe("thumbs up");
    expect(findEmoji("not an emoji")).toBeUndefined();
  });
});

describe("toCodePoints", () => {
  it("lists U+ code points, padded to 4 hex digits", () => {
    expect(toCodePoints("👩‍💻")).toBe("U+1F469 U+200D U+1F4BB");
    expect(toCodePoints("❤️")).toBe("U+2764 U+FE0F");
    expect(toCodePoints("A")).toBe("U+0041");
    expect(toCodePoints("")).toBe("");
  });
});

describe("searchEmoji", () => {
  it("returns everything for an empty query", () => {
    const r = searchEmoji("   ");
    expect(r.total).toBe(EMOJI_LIST.length);
    expect(r.group).toBe("all");
  });

  it("matches a repeated word once but counts it every time it was typed", () => {
    const once = searchEmoji("red heart").items.map((i) => i.char);
    expect(
      searchEmoji("red red heart")
        .items.map((i) => i.char)
        .sort(),
    ).toEqual([...once].sort());
    // Thousands of repeated words cost no more than one.
    const long = searchEmoji("heart ".repeat(20_000));
    expect(long.total).toBe(searchEmoji("heart").total);
    expect(long.items[0].char).toBe(searchEmoji("heart").items[0].char);
    expect(searchEmoji(`${" ".repeat(40_000)}fire`).items[0].char).toBe("🔥");
  });

  it("ranks an exact name match first", () => {
    expect(searchEmoji("fire").items[0].char).toBe("🔥");
    expect(searchEmoji("огонь", { locale: "ru" }).items[0]).toMatchObject({
      char: "🔥",
      name: "огонь",
    });
  });

  it("keeps the other language searchable", () => {
    expect(searchEmoji("fire", { locale: "ru" }).items.map((i) => i.char)).toContain("🔥");
    expect(searchEmoji("огонь", { locale: "en" }).items.map((i) => i.char)).toContain("🔥");
  });

  it("requires every token to match (AND)", () => {
    const r = searchEmoji("thumbs up");
    expect(r.items[0].char).toBe("👍");
    expect(searchEmoji("thumbs zzzz").total).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(searchEmoji("FIRE").items[0].char).toBe("🔥");
  });

  it("filters by group and limits results while reporting the total", () => {
    const flags = searchEmoji("", { group: "flags" });
    expect(flags.items.every((i) => i.group === "flags")).toBe(true);
    expect(searchEmoji("", { group: "flags", limit: 3 })).toMatchObject({ total: flags.total });
    expect(searchEmoji("", { group: "flags", limit: 3 }).items).toHaveLength(3);
    expect(searchEmoji("fire", { group: "flags" }).total).toBe(0);
  });

  it("applies the requested tone only to tone-able emoji, clamping the tone", () => {
    const thumbs = searchEmoji("thumbs up", { tone: 2 }).items[0];
    expect(thumbs).toMatchObject({ char: "👍\u{1F3FC}", base: "👍", tone: true });
    expect(searchEmoji("fire", { tone: 2 }).items[0].char).toBe("🔥");
    expect(searchEmoji("thumbs up", { tone: 42 }).items[0].char).toBe("👍\u{1F3FF}");
    expect(searchEmoji("thumbs up", { tone: Number.NaN }).items[0].char).toBe("👍");
  });

  it("returns nothing for gibberish without throwing", () => {
    expect(searchEmoji("qqqxxxzzz")).toMatchObject({ items: [], total: 0 });
    expect(() => searchEmoji("(.*[")).not.toThrow();
  });
});
