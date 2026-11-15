import { describe, expect, it } from "vitest";
import { diffTexts } from "./text-diff.js";

describe("diffTexts", () => {
  it("returns an empty diff when both texts are empty", () => {
    expect(diffTexts("", "")).toEqual({ lines: [], additions: 0, deletions: 0, equal: 0 });
  });

  it("reports identical texts as all equal", () => {
    const r = diffTexts("a\nb\nc", "a\nb\nc");
    expect(r.equal).toBe(3);
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(0);
  });

  it("finds a changed line as one removal plus one addition", () => {
    const r = diffTexts("a\nb\nc", "a\nB\nc");
    expect(r.lines).toEqual([
      { type: "equal", text: "a" },
      { type: "removed", text: "b" },
      { type: "added", text: "B" },
      { type: "equal", text: "c" },
    ]);
    expect([r.additions, r.deletions, r.equal]).toEqual([1, 1, 2]);
  });

  it("finds an inserted and a deleted line with the LCS kept", () => {
    // LCS of [a,b,c,d] and [a,c,d,e] is [a,c,d]
    const r = diffTexts("a\nb\nc\nd", "a\nc\nd\ne");
    expect(r.lines).toEqual([
      { type: "equal", text: "a" },
      { type: "removed", text: "b" },
      { type: "equal", text: "c" },
      { type: "equal", text: "d" },
      { type: "added", text: "e" },
    ]);
  });

  it("compares Cyrillic and emoji lines exactly", () => {
    const r = diffTexts("привет\n👋", "привет\n👍");
    expect([r.additions, r.deletions, r.equal]).toEqual([1, 1, 1]);
  });

  it("only diffs the first 2000 lines of each text", () => {
    const a = Array.from({ length: 2005 }, (_, i) => `l${i}`).join("\n");
    const r = diffTexts(a, a);
    expect(r.equal).toBe(2000);
  });

  it("reports only an addition when the original is empty", () => {
    const r = diffTexts("", "a");
    expect(r.deletions).toBe(0);
    expect(r.lines).toEqual([{ type: "added", text: "a" }]);
  });
});
