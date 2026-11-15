import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, encodeHtmlEntities } from "./html-entity-encoder.js";

describe("encodeHtmlEntities", () => {
  it("escapes the five markup characters", () => {
    expect(encodeHtmlEntities(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
  });

  it("leaves non-ASCII alone by default", () => {
    expect(encodeHtmlEntities("Привет © 😀")).toBe("Привет © 😀");
  });

  it("encodes every code point above U+007F as hex entity when asked (surrogates intact)", () => {
    // é = U+E9, П = U+41F, 😀 = U+1F600
    expect(encodeHtmlEntities("é П 😀 a<", true)).toBe("&#xE9; &#x41F; &#x1F600; a&lt;");
  });

  it("returns empty for empty input", () => {
    expect(encodeHtmlEntities("")).toBe("");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes named entities, including whitespace ones", () => {
    expect(decodeHtmlEntities("&lt;b&gt; &amp; &quot;q&quot; &apos;").result).toBe(`<b> & "q" '`);
    expect(decodeHtmlEntities("&copy;&mdash;&euro;&laquo;&raquo;").result).toBe("©—€«»");
    expect(decodeHtmlEntities("a&nbsp;b").result).toBe("a b");
    expect(decodeHtmlEntities("&Omega;&omega;").result).toBe("Ωω");
  });

  it("decodes decimal and hex numeric entities, including astral code points", () => {
    expect(decodeHtmlEntities("&#38;&#x26;&#128512;&#x1F600;").result).toBe("&&😀😀");
  });

  it("decodes hex references with an uppercase X", () => {
    expect(decodeHtmlEntities("&#X26;").result).toBe("&");
  });

  it("decodes only one level (&amp;lt; -> &lt;)", () => {
    expect(decodeHtmlEntities("&amp;lt;").result).toBe("&lt;");
  });

  it("leaves unknown, out-of-range and unterminated entities untouched", () => {
    expect(decodeHtmlEntities("&foo; &#x110000; &amp &#xZZ;").result).toBe(
      "&foo; &#x110000; &amp &#xZZ;",
    );
  });

  it("is case-sensitive for names (&AMP; is not in the map)", () => {
    expect(decodeHtmlEntities("&AMP;").result).toBe("&AMP;");
  });

  it("round-trips with the encoder", () => {
    const s = `<p class="x">Ünïcödé & 'quotes' 👋</p>`;
    expect(decodeHtmlEntities(encodeHtmlEntities(s, true)).result).toBe(s);
    expect(decodeHtmlEntities(encodeHtmlEntities(s)).result).toBe(s);
  });

  it("returns empty for empty input and never sets error", () => {
    expect(decodeHtmlEntities("")).toEqual({ result: "", error: null });
    expect(decodeHtmlEntities("&#99999999999;").error).toBeNull();
  });
});
