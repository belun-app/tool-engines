import { describe, expect, it } from "vitest";
import { testRegex } from "./regex-tester.js";

// Catastrophic-backtracking patterns (e.g. /(a+)+$/ on "aaaa…b") are not exercised: the
// engine runs RegExp synchronously with no timeout, so such a test would hang the worker.

describe("testRegex", () => {
  it("finds all matches with index and length (global is implied)", () => {
    const r = testRegex("\\d+", "", "a1 b22 c333");
    expect(r.valid).toBe(true);
    expect(r.matchCount).toBe(3);
    expect(r.matches.map((m) => [m.value, m.index, m.length])).toEqual([
      ["1", 1, 1],
      ["22", 4, 2],
      ["333", 8, 3],
    ]);
  });

  it("exposes named groups", () => {
    const r = testRegex("(?<y>\\d{4})-(?<m>\\d{2})", "", "2024-01 and 1999-12");
    expect(r.matches[0].groups).toEqual({ y: "2024", m: "01" });
    expect(r.matches[1].groups).toEqual({ y: "1999", m: "12" });
    // no named groups -> empty object
    expect(testRegex("a", "", "a").matches[0].groups).toEqual({});
  });

  it("applies flags and drops unknown ones", () => {
    expect(testRegex("abc", "i", "ABC abc").matchCount).toBe(2);
    expect(testRegex("^x", "m", "x\nx").matchCount).toBe(2);
    expect(testRegex("^x", "", "x\nx").matchCount).toBe(1);
    expect(testRegex("a.b", "s", "a\nb").matchCount).toBe(1);
    expect(testRegex("a", "gzq", "aa").matchCount).toBe(2);
  });

  it("matches the semantics of String.prototype.matchAll for zero-length matches", () => {
    const viaEngine = (p: string, t: string) =>
      testRegex(p, "", t).matches.map((m) => [m.value, m.index]);
    const viaJs = (p: string, t: string) =>
      [...t.matchAll(new RegExp(p, "g"))].map((m) => [m[0], m.index]);
    for (const [p, t] of [
      ["a*", "aab"],
      ["(?:)", "abc"],
      ["\\b", "hi there"],
      ["x?", "yxy"],
    ]) {
      expect(viaEngine(p, t), `${p} on ${t}`).toEqual(viaJs(p, t));
    }
  });

  it("works on Cyrillic and emoji text", () => {
    const r = testRegex("\\p{L}+", "u", "Привет, мир 😀");
    expect(r.matches.map((m) => m.value)).toEqual(["Привет", "мир"]);
    expect(testRegex("😀", "u", "a😀b").matches[0]).toMatchObject({ index: 1, length: 2 });
  });

  it("caps the result at 1000 matches", () => {
    expect(testRegex("a", "", "a".repeat(1500)).matchCount).toBe(1000);
  });

  it("returns a valid empty result for an empty pattern", () => {
    expect(testRegex("", "g", "anything")).toEqual({
      valid: true,
      error: "",
      matches: [],
      matchCount: 0,
    });
  });

  it("reports invalid patterns and flags without throwing", () => {
    const bad = testRegex("(unclosed", "", "x");
    expect(bad.valid).toBe(false);
    expect(bad.error).not.toBe("");
    expect(testRegex("a", "gg", "a").valid).toBe(false);
    expect(testRegex("[", "", "").valid).toBe(false);
  });

  it("returns no matches for empty text", () => {
    expect(testRegex("a", "", "").matchCount).toBe(0);
  });

  it("handles zero-length matches across an emoji without the u flag", () => {
    // without u the string is plain UTF-16 code units: indices 0, 1, 2
    expect(testRegex("(?:)", "", "😀").matches.map((m) => m.index)).toEqual([0, 1, 2]);
  });

  // Regression: the empty-match guard stepped into the middle of a surrogate pair and looped forever
  it("terminates on zero-length matches with the u flag on emoji text", () => {
    expect(testRegex("x*", "u", "a😀b").matches.map((m) => m.index)).toEqual([0, 1, 3, 4]);
    expect(testRegex("(?:)", "u", "😀😀").matches.map((m) => m.index)).toEqual(
      [..."😀😀".matchAll(/(?:)/gu)].map((m) => m.index),
    );
  });

  it("reports non-string input instead of throwing", () => {
    expect(testRegex(undefined as unknown as string, "", "a").valid).toBe(false);
    expect(testRegex("a", "", null as unknown as string).valid).toBe(false);
    expect(testRegex("a", undefined as unknown as string, "aa").matchCount).toBe(2);
  });
});
