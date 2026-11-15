import { describe, expect, it } from "vitest";
import { checkGrammar } from "./grammar-checker.js";

const cats = (text: string) => checkGrammar(text).issues.map((i) => i.category);

describe("checkGrammar", () => {
  it("returns no issues for empty or whitespace input", () => {
    expect(checkGrammar("")).toEqual({ issues: [], issueCount: 0 });
    expect(checkGrammar("   \n")).toEqual({ issues: [], issueCount: 0 });
  });

  it("returns no issues for a clean sentence", () => {
    expect(checkGrammar("I have an apple and a banana, thanks.").issueCount).toBe(0);
  });

  it("flags double spaces with offset and length", () => {
    // "Hello   world": three spaces at index 5
    const [i] = checkGrammar("Hello   world").issues;
    expect(i).toMatchObject({ offset: 5, length: 3, suggestion: " ", category: "style" });
  });

  it("flags repeated words case-insensitively", () => {
    // "This is the The end" -> "the The" at index 8, length 7
    const [i] = checkGrammar("This is the The end").issues;
    expect(i).toMatchObject({ offset: 8, length: 7, suggestion: "the", category: "grammar" });
    expect(i.message).toBe('Repeated word: "the"');
  });

  it("flags 'a' before a vowel sound, with exceptions for consonant sounds", () => {
    const r = checkGrammar("I ate a apple.");
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ offset: 6, length: 1, suggestion: "an" });
    expect(checkGrammar("It is a unique university and a user.").issueCount).toBe(0);
  });

  it("flags 'an' before a consonant, but not before h-words", () => {
    const r = checkGrammar("It was an car.");
    expect(r.issues[0]).toMatchObject({ offset: 7, length: 2, suggestion: "a" });
    expect(checkGrammar("Wait an hour or an honest minute.").issueCount).toBe(0);
  });

  it("flags lowercase pronoun i but not i.e. or list markers", () => {
    expect(checkGrammar("Yes i can").issues[0]).toMatchObject({
      offset: 4,
      suggestion: "I",
      category: "grammar",
    });
    expect(checkGrammar("Fruit, i.e. apples").issueCount).toBe(0);
    expect(checkGrammar("i) first item").issueCount).toBe(0);
  });

  it("flags a missing space after comma or semicolon", () => {
    const [i] = checkGrammar("red,green").issues;
    expect(i).toMatchObject({ offset: 4, length: 0, category: "punctuation" });
    expect(cats("one;two")).toEqual(["punctuation"]);
  });

  it("sorts issues by offset", () => {
    const offsets = checkGrammar("a apple  and,then i").issues.map((i) => i.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(offsets.length).toBe(4);
  });

  it("does not throw on Cyrillic or emoji", () => {
    expect(() => checkGrammar("Привет  мир 👋")).not.toThrow();
    expect(checkGrammar("Привет  мир 👋").issueCount).toBe(1); // the double space
  });

  it("does not flag a comma inside a number", () => {
    expect(checkGrammar("It costs 1,000 dollars.").issueCount).toBe(0);
  });

  it("does not flag a trailing comma at end of text", () => {
    expect(checkGrammar("Dear John,").issueCount).toBe(0);
  });
});
