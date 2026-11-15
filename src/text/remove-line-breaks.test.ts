import { describe, expect, it } from "vitest";
import { removeLineBreaks } from "./remove-line-breaks.js";

describe("removeLineBreaks", () => {
  it("returns the empty result for empty or whitespace-only input", () => {
    for (const text of ["", "  ", "\n\r\n\t"]) {
      expect(removeLineBreaks(text)).toEqual({
        output: "",
        inputLines: 0,
        breaksRemoved: 0,
        outputCharacters: 0,
      });
    }
  });

  it("joins all lines with a space by default, trimming each line", () => {
    // 3 lines, 2 newlines removed, "one two three" = 13 chars
    expect(removeLineBreaks("one\n  two  \nthree")).toEqual({
      output: "one two three",
      inputLines: 3,
      breaksRemoved: 2,
      outputCharacters: 13,
    });
  });

  it("normalises CRLF and CR line endings", () => {
    const r = removeLineBreaks("a\r\nb\rc");
    expect(r.output).toBe("a b c");
    expect(r.inputLines).toBe(3);
    expect(r.breaksRemoved).toBe(2);
  });

  it("drops blank lines in 'all' mode", () => {
    const r = removeLineBreaks("a\n\n\nb");
    expect(r.output).toBe("a b");
    expect(r.breaksRemoved).toBe(3);
  });

  it("uses a custom separator (including empty)", () => {
    expect(removeLineBreaks("a\nb\nc", { separator: ", " }).output).toBe("a, b, c");
    expect(removeLineBreaks("a\nb", { separator: "" }).output).toBe("ab");
  });

  it("keeps paragraph breaks in 'paragraphs' mode", () => {
    // newlines in: 1 + 4 + 1 = 6; out: 2 -> removed 4
    const r = removeLineBreaks("line one\nline two\n\n\n\npara two\nend", { mode: "paragraphs" });
    expect(r.output).toBe("line one line two\n\npara two end");
    expect(r.breaksRemoved).toBe(4);
    expect(r.inputLines).toBe(7);
  });

  it("handles Cyrillic and emoji without corruption", () => {
    expect(removeLineBreaks("Привет\nмир 👋").output).toBe("Привет мир 👋");
  });
});
