import { describe, expect, it } from "vitest";
import {
  type AiTextCleanerOptions,
  DEFAULT_OPTIONS,
  cleanAiText,
  cleanAiTextWithStats,
  countAiMarkers,
  totalMarkers,
} from "./ai-text-cleaner.js";

const OFF: AiTextCleanerOptions = {
  dashMode: "keep",
  quoteMode: "keep",
  removeZeroWidth: false,
  fixUnicodeSpaces: false,
  normalizeEllipsis: false,
  normalizeBullets: false,
  removeBoldMarkers: false,
  removeEmoji: false,
  tidyWhitespace: false,
};
const clean = (text: string, o: Partial<AiTextCleanerOptions>) =>
  cleanAiText(text, { ...OFF, ...o });

describe("countAiMarkers / totalMarkers", () => {
  it("returns zeros for empty text", () => {
    expect(totalMarkers(countAiMarkers(""))).toBe(0);
  });

  it("counts each marker type (hand-counted)", () => {
    const c = countAiMarkers("It’s — “great”… **x**  \u{1F680}");
    expect(c).toEqual({
      emDashes: 1,
      enDashes: 0,
      smartQuotes: 3,
      zeroWidth: 0,
      unicodeSpaces: 0,
      ellipses: 1,
      bullets: 0,
      boldMarkers: 1,
      emoji: 1,
      doubleSpaces: 1,
    });
    expect(totalMarkers(c)).toBe(8);
  });

  it("does not count (c), (R), TM signs as emoji", () => {
    expect(countAiMarkers("© ® ™").emoji).toBe(0);
  });
});

describe("cleanAiText", () => {
  it("returns an empty string for empty input", () => {
    expect(cleanAiText("", DEFAULT_OPTIONS)).toBe("");
  });

  it("with all rules off only normalises line endings", () => {
    expect(clean("a — b\r\nc\rd", {})).toBe("a — b\nc\nd");
  });

  describe("dashes", () => {
    it("comma mode turns a spaced or unspaced em dash into a comma", () => {
      expect(clean("It works — mostly.", { dashMode: "comma" })).toBe("It works, mostly.");
      expect(clean("word—word", { dashMode: "comma" })).toBe("word, word");
      expect(clean("a ― b – c", { dashMode: "comma" })).toBe("a, b, c");
    });

    it("comma mode does not double an existing punctuation mark", () => {
      expect(clean("Wait, — he said", { dashMode: "comma" })).toBe("Wait, he said");
    });

    it("hyphen and space modes", () => {
      expect(clean("a — b", { dashMode: "hyphen" })).toBe("a - b");
      expect(clean("a — b", { dashMode: "space" })).toBe("a b");
    });

    it("collapses numeric ranges to a plain hyphen in every rewriting mode", () => {
      for (const dashMode of ["comma", "hyphen", "space"] as const) {
        expect(clean("1990—2000, pages 5 – 10, −3 to 4−5", { dashMode })).toBe(
          "1990-2000, pages 5-10, −3 to 4-5",
        );
      }
    });

    it("keeps a dash that opens a line (dialogue / list)", () => {
      expect(clean("— Привет!\n  — Пока.", { dashMode: "comma" })).toBe("— Привет!\n  — Пока.");
    });

    it("drops a dangling dash at the end of a line", () => {
      expect(clean("So —\nnext —", { dashMode: "comma" })).toBe("So\nnext");
    });

    it("keep mode leaves dashes alone", () => {
      expect(clean("a — b", { dashMode: "keep" })).toBe("a — b");
    });
  });

  describe("quotes", () => {
    it("straightens curly quotes and primes", () => {
      expect(
        clean("“Hi,” she said. It’s „ok“ 5′ 6″", {
          quoteMode: "straight",
        }),
      ).toBe(`"Hi," she said. It's "ok" 5' 6"`);
    });

    it("converts to guillemets by context, not by alternation", () => {
      expect(clean("“Hi,” she said", { quoteMode: "guillemets" })).toBe("«Hi,» she said");
      // a stray closing quote does not flip later pairs
      expect(clean('x" and "y"', { quoteMode: "guillemets" })).toBe("x» and «y»");
    });
  });

  it("removes zero-width characters, soft hyphens and BOMs but not emoji ZWJ", () => {
    expect(clean("a​b­c﻿d‌e⁠f", { removeZeroWidth: true })).toBe("abcdef");
    const coder = "\u{1F469}‍\u{1F4BB}";
    expect(clean(coder, { removeZeroWidth: true })).toBe(coder);
  });

  it("turns Unicode spaces into plain spaces", () => {
    expect(clean("a b c　d e", { fixUnicodeSpaces: true })).toBe("a b c d e");
  });

  it("expands the ellipsis character", () => {
    expect(clean("Wait…", { normalizeEllipsis: true })).toBe("Wait...");
  });

  it("normalises line-start bullets to hyphens, keeping indentation", () => {
    expect(clean("• one\n  ● two\nmid • dot", { normalizeBullets: true })).toBe(
      "- one\n  - two\nmid • dot",
    );
  });

  it("strips Markdown bold and italic markers but not snake_case or arithmetic", () => {
    expect(
      clean("**bold** and __under__ and *it* but snake_case_x and 2*3*4", {
        removeBoldMarkers: true,
      }),
    ).toBe("bold and under and it but snake_case_x and 2*3*4");
  });

  it("removes emoji including ZWJ sequences but keeps (c)/(R)/TM", () => {
    expect(clean("Ship \u{1F680}✨ it \u{1F469}‍\u{1F4BB} ©™", { removeEmoji: true })).toBe(
      "Ship  it  ©™",
    );
  });

  it("tidies runs of spaces and trailing whitespace per line", () => {
    expect(clean("a   b  \nc\t\t", { tidyWhitespace: true })).toBe("a b\nc");
  });

  it("removes skin-tone modifiers with their emoji", () => {
    expect(clean("Nice \u{1F44D}\u{1F3FD} job", { removeEmoji: true, tidyWhitespace: true })).toBe(
      "Nice job",
    );
  });

  it("removes flag emoji", () => {
    expect(clean("USA \u{1F1FA}\u{1F1F8} win", { removeEmoji: true, tidyWhitespace: true })).toBe(
      "USA win",
    );
  });
});

describe("cleanAiTextWithStats", () => {
  it("returns zero stats for empty input", () => {
    const r = cleanAiTextWithStats("");
    expect(r.text).toBe("");
    expect(r.fixes).toBe(0);
    expect(r.words).toBe(0);
    expect(r.charactersBefore).toBe(0);
  });

  it("cleans with default options and reports fixes", () => {
    const input = "It’s — “great”… **x**  \u{1F680}";
    const r = cleanAiTextWithStats(input);
    expect(r.text).toBe(`It's, "great"... **x** \u{1F680}`);
    // before 8 markers; after: bold 1 + emoji 1 = 2 (default keeps both) -> 6 fixes
    expect(totalMarkers(r.after)).toBe(2);
    expect(r.fixes).toBe(6);
    expect(r.charactersBefore).toBe(input.length);
    expect(r.charactersAfter).toBe(r.text.length);
    expect(r.words).toBe(4);
  });
});
