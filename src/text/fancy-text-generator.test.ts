import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  FANCY_TEXT_STYLES,
  MAX_INPUT_LENGTH,
  generateFancyText,
  styleText,
} from "./fancy-text-generator.js";

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join(
  "",
);

/** The 24 reserved slots in U+1D400..U+1D7FF (letters pre-encoded in Letterlike Symbols). */
const RESERVED_MATH_HOLES = [
  0x1d455, 0x1d49d, 0x1d4a0, 0x1d4a1, 0x1d4a3, 0x1d4a4, 0x1d4a7, 0x1d4a8, 0x1d4ad, 0x1d4ba, 0x1d4bc,
  0x1d4c4, 0x1d506, 0x1d50b, 0x1d50c, 0x1d515, 0x1d51d, 0x1d53a, 0x1d53f, 0x1d545, 0x1d547, 0x1d548,
  0x1d549, 0x1d551,
];

describe("style catalogue", () => {
  it("exposes the default style and unique ids", () => {
    expect(DEFAULT_STYLE).toBe("bold");
    const ids = FANCY_TEXT_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports hasLowercase / hasDigits per style", () => {
    const byId = Object.fromEntries(FANCY_TEXT_STYLES.map((s) => [s.id, s]));
    expect(byId.bold).toMatchObject({ hasLowercase: true, hasDigits: true });
    expect(byId.italic).toMatchObject({ hasLowercase: true, hasDigits: false });
    expect(byId.circled).toMatchObject({ hasLowercase: true, hasDigits: true });
    expect(byId["circled-filled"]).toMatchObject({ hasLowercase: false, hasDigits: true });
    expect(byId.squared).toMatchObject({ hasLowercase: false, hasDigits: false });
    expect(byId.parenthesised).toMatchObject({ hasLowercase: true, hasDigits: false });
    expect(byId.superscript).toMatchObject({ hasLowercase: false, hasDigits: true });
    expect(byId.fullwidth).toMatchObject({ hasLowercase: true, hasDigits: true });
  });

  it("never emits an unassigned code point or a reserved maths-block hole", () => {
    for (const { id } of FANCY_TEXT_STYLES) {
      const out = styleText(ASCII, id).text;
      for (const ch of out) {
        expect(/\p{Cn}/u.test(ch), `${id}: U+${ch.codePointAt(0)?.toString(16)}`).toBe(false);
        expect(RESERVED_MATH_HOLES).not.toContain(ch.codePointAt(0));
      }
    }
  });
});

describe("styleText", () => {
  it("maps bold letters and digits by offset", () => {
    // A = U+1D400, a = U+1D41A, 0 = U+1D7CE
    expect(styleText("Aa0", "bold").text).toBe(cp(0x1d400, 0x1d41a, 0x1d7ce));
  });

  it("patches the letterlike-symbol holes", () => {
    expect(styleText("h", "italic").text).toBe("ℎ");
    expect(styleText("B", "script").text).toBe("ℬ");
    expect(styleText("CR", "double-struck").text).toBe("ℂℝ");
    expect(styleText("Z", "fraktur").text).toBe("ℨ");
  });

  it("maps enclosed alphanumerics including the separate zero", () => {
    // Ⓐ U+24B6, ⓐ U+24D0, ① U+2460, ⓪ U+24EA
    expect(styleText("Aa10", "circled").text).toBe("Ⓐⓐ①⓪");
    // filled circles fold lower onto upper: a -> U+1F150 ; 0 -> ⓿ U+24FF ; 1 -> ❶ U+2776
    expect(styleText("a01", "circled-filled").text).toBe(cp(0x1f150, 0x24ff, 0x2776));
    // parenthesised: ⒜ U+249C, ⑴ U+2474, no zero glyph
    expect(styleText("a10", "parenthesised").text).toBe("⒜⑴" + "0");
  });

  it("shifts ASCII into fullwidth forms and maps space to an ideographic space", () => {
    expect(styleText("A b!", "fullwidth").text).toBe("Ａ　ｂ！");
  });

  it("small caps keep capitals and convert lowercase", () => {
    expect(styleText("Hello", "small-caps").text).toBe("Hᴇʟʟᴏ");
  });

  it("superscript / subscript report letters without a glyph", () => {
    const sup = styleText("Aq2", "superscript");
    // A folds onto ᵃ, q has no superscript form, 2 -> ²
    expect(sup.text).toBe("ᵃq²");
    expect(sup.unsupported).toEqual(["q"]);
    expect(styleText("b", "subscript").unsupported).toEqual(["b"]);
  });

  it("upside-down rotates and reverses", () => {
    expect(styleText("Hello!", "upside-down").text).toBe("¡ollǝH");
  });

  it("passes non-Latin letters through and reports them once each, in order", () => {
    const r = styleText("Да да!", "bold");
    expect(r.text).toBe("Да да!");
    expect(r.unsupported).toEqual(["Д", "а", "д"]);
  });

  it("does not report digits, punctuation or emoji as unsupported", () => {
    expect(styleText("x1 😀!", "italic").unsupported).toEqual([]);
  });

  it("appends a combining decoration to every character, welded through reversal", () => {
    expect(styleText("ab", "small-caps", { decoration: "strikethrough" }).text).toBe("ᴀ̶ʙ̶");
    // reversed cells keep the mark after its own base character
    expect(styleText("ab", "upside-down", { decoration: "underline" }).text).toBe("q̲ɐ̲");
  });

  it("wraps a non-empty result with a flourish", () => {
    expect(styleText("Hi", "small-caps", { flourish: "hearts" }).text).toBe("♡ Hɪ ♡");
    expect(styleText("", "bold", { flourish: "hearts" }).text).toBe("");
  });

  it("falls back to bold for an unknown style and ignores unknown decorations", () => {
    const r = styleText("A", "nope", { decoration: "nope", flourish: "nope" });
    expect(r.id).toBe("bold");
    expect(r.text).toBe(cp(0x1d400));
  });

  it("reports code-point and UTF-16 lengths", () => {
    const r = styleText("Hi", "bold");
    expect(r.length).toBe(2);
    expect(r.utf16Length).toBe(4);
  });

  it("returns empty output for empty input", () => {
    expect(styleText("", "bold")).toMatchObject({ text: "", length: 0, unsupported: [] });
  });
});

describe("generateFancyText", () => {
  it("runs every style by default", () => {
    const r = generateFancyText("abc");
    expect(r.variants.map((v) => v.id)).toEqual(FANCY_TEXT_STYLES.map((s) => s.id));
    expect(r.truncated).toBe(false);
    expect(r.inputLength).toBe(3);
  });

  it("restricts to requested styles in order and drops unknown ids", () => {
    const r = generateFancyText("a", { styles: ["mono", "nope", "bold"] });
    expect(r.variants.map((v) => v.id)).toEqual(["mono", "bold"]);
  });

  it("truncates input longer than MAX_INPUT_LENGTH code points", () => {
    const r = generateFancyText("😀".repeat(MAX_INPUT_LENGTH + 5), { styles: ["bold"] });
    expect(r.truncated).toBe(true);
    expect(r.inputLength).toBe(MAX_INPUT_LENGTH);
    expect(r.variants[0].length).toBe(MAX_INPUT_LENGTH);
  });

  it("handles empty input", () => {
    const r = generateFancyText("", { styles: ["bold"] });
    expect(r.inputLength).toBe(0);
    expect(r.variants[0].text).toBe("");
  });
});
