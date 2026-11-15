import { describe, expect, it } from "vitest";
import { STOP_WORDS } from "./_stop-words.js";

describe("STOP_WORDS", () => {
  it("holds common English function words", () => {
    for (const w of ["a", "the", "and", "of", "to", "in", "is", "it", "you", "which"]) {
      expect(STOP_WORDS.has(w), w).toBe(true);
    }
  });

  it("holds common Russian function words", () => {
    for (const w of ["и", "в", "не", "на", "что", "как", "это", "я", "через", "чтобы"]) {
      expect(STOP_WORDS.has(w), w).toBe(true);
    }
  });

  it("includes English contractions with a straight apostrophe", () => {
    for (const w of ["don't", "it's", "you're", "won't", "i'm"]) {
      expect(STOP_WORDS.has(w), w).toBe(true);
    }
  });

  it("lists Russian words both with and without the letter ё where both spellings are used", () => {
    expect(STOP_WORDS.has("ещё")).toBe(true);
    expect(STOP_WORDS.has("еще")).toBe(true);
    expect(STOP_WORDS.has("всё")).toBe(true);
    expect(STOP_WORDS.has("все")).toBe(true);
  });

  it("keeps hyphenated Russian particles as one entry", () => {
    expect(STOP_WORDS.has("что-то")).toBe(true);
  });

  it("stores entries in lower case only, so callers must lower-case before lookup", () => {
    for (const w of STOP_WORDS) expect(w, w).toBe(w.toLowerCase());
    expect(STOP_WORDS.has("The")).toBe(false);
    expect(STOP_WORDS.has("И")).toBe(false);
  });

  it("does not contain content words", () => {
    for (const w of ["pdf", "calculator", "password", "дом", "работа", "москва"]) {
      expect(STOP_WORDS.has(w), w).toBe(false);
    }
  });

  it("has no empty or padded entries", () => {
    for (const w of STOP_WORDS) {
      expect(w.length, JSON.stringify(w)).toBeGreaterThan(0);
      expect(w.trim(), JSON.stringify(w)).toBe(w);
    }
  });
});
