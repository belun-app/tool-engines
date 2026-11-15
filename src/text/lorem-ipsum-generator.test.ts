import { afterEach, describe, expect, it, vi } from "vitest";
import { seededRandom } from "../_random.js";
import {
  MAX_PARAGRAPHS,
  MAX_WORDS_PER_PARAGRAPH,
  MIN_PARAGRAPHS,
  MIN_WORDS_PER_PARAGRAPH,
  generateLoremIpsum,
} from "./lorem-ipsum-generator.js";

/** A source that always returns 0: every word is "lorem", every sentence 7 words long. */
const zero = () => 0;

const CLASSIC =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateLoremIpsum", () => {
  it("defaults to 3 paragraphs of 100 words starting with the classic sentence", () => {
    const r = generateLoremIpsum();
    const paras = r.text.split("\n\n");
    expect(r.paragraphCount).toBe(3);
    expect(paras).toHaveLength(3);
    expect(paras[0].startsWith(CLASSIC)).toBe(true);
    for (const p of paras) expect(countWords(p)).toBe(100);
    expect(r.wordCount).toBe(300);
  });

  it("produces exactly the requested words per paragraph without the classic start", () => {
    for (const wpp of [10, 11, 17, 23, 57, 500]) {
      const r = generateLoremIpsum(2, wpp, false);
      for (const p of r.text.split("\n\n")) expect(countWords(p)).toBe(wpp);
      expect(r.text.startsWith("Lorem ipsum dolor sit amet")).toBe(false);
    }
  });

  it("clamps paragraphs to 1..20 and words to 10..500, rounding", () => {
    expect([MIN_PARAGRAPHS, MAX_PARAGRAPHS]).toEqual([1, 20]);
    expect([MIN_WORDS_PER_PARAGRAPH, MAX_WORDS_PER_PARAGRAPH]).toEqual([10, 500]);
    expect(generateLoremIpsum(0, 50).paragraphCount).toBe(1);
    expect(generateLoremIpsum(-5, 50).paragraphCount).toBe(1);
    expect(generateLoremIpsum(99, 10).paragraphCount).toBe(20);
    expect(generateLoremIpsum(2.6, 50).paragraphCount).toBe(3);
    const small = generateLoremIpsum(1, 1, false);
    expect(small.wordCount).toBe(10);
    const big = generateLoremIpsum(1, 10_000, false);
    expect(big.wordCount).toBe(500);
  });

  it("builds sentences that start with a capital and end with a period", () => {
    const r = generateLoremIpsum(3, 80, false);
    for (const p of r.text.split("\n\n")) {
      expect(p).toMatch(/^[A-Z]/);
      expect(p.endsWith(".")).toBe(true);
    }
    expect(r.text).toMatch(/^[a-zA-Z ,.\n]+$/);
  });

  it("is deterministic with an injected source", () => {
    const r = generateLoremIpsum(1, 14, false, { rng: zero });
    expect(r.text).toBe(
      "Lorem lorem lorem lorem lorem lorem lorem. Lorem lorem lorem lorem lorem lorem lorem.",
    );
  });

  it("folds a short tail (< 4 words) into the previous sentence", () => {
    // 7 + 7 + tail of 2 -> the tail joins the second sentence after a comma
    const r = generateLoremIpsum(1, 16, false, { rng: zero });
    expect(r.text).toBe(
      "Lorem lorem lorem lorem lorem lorem lorem. Lorem lorem lorem lorem lorem lorem lorem, lorem lorem.",
    );
    expect(r.wordCount).toBe(16);
  });

  it("honours a small word count when starting with Lorem ipsum", () => {
    const r = generateLoremIpsum(1, 10, true);
    expect(r.wordCount).toBe(10);
    expect(r.text).toBe("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do.");
    for (const n of [19, 20, 22, 23, 24, 30]) {
      expect(generateLoremIpsum(1, n, true).wordCount).toBe(n);
    }
  });

  it("flags clamped counts and falls back to the defaults for non-numbers", () => {
    expect(generateLoremIpsum(3, 100).clamped).toBe(false);
    expect(generateLoremIpsum(99, 100).clamped).toBe(true);
    expect(generateLoremIpsum(3, 5).clamped).toBe(true);
    expect(generateLoremIpsum(2.6, 100).clamped).toBe(true);
    const junk = generateLoremIpsum(Number.NaN, Number.NaN, false);
    expect(junk).toMatchObject({ paragraphCount: 3, wordCount: 300, clamped: true, error: "" });
  });

  it("does not use Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    generateLoremIpsum(2, 50, false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("is reproducible with a seeded source", () => {
    const a = generateLoremIpsum(2, 40, false, { rng: seededRandom(11) }).text;
    expect(generateLoremIpsum(2, 40, false, { rng: seededRandom(11) }).text).toBe(a);
  });

  it("reports missing Web Crypto instead of throwing", () => {
    vi.stubGlobal("crypto", undefined);
    expect(generateLoremIpsum(1, 20, false)).toMatchObject({ text: "", error: "no-secure-random" });
    expect(generateLoremIpsum(1, 20, false, { rng: zero }).wordCount).toBe(20);
  });
});
