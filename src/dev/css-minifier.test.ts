import { describe, expect, it } from "vitest";
import { minifyCss } from "./css-minifier.js";

describe("minifyCss", () => {
  it("strips comments, whitespace and the last semicolon in a block", () => {
    const css =
      "/* header */\nbody {\n  color: red;\n  margin: 0 auto;\n}\n\na > b , c ~ d {\n  top: 1px;\n}\n";
    const r = minifyCss(css);
    expect(r.minified).toBe("body{color:red;margin:0 auto}a>b,c~d{top:1px}");
    expect(r.originalBytes).toBe(css.length);
    expect(r.minifiedBytes).toBe(r.minified.length);
    // savings = round((orig - min) / orig * 100)
    expect(r.savingsPercent).toBe(
      Math.round(((css.length - r.minified.length) / css.length) * 100),
    );
  });

  it("returns zeros for empty and whitespace-only input", () => {
    expect(minifyCss("")).toEqual({
      minified: "",
      originalBytes: 0,
      minifiedBytes: 0,
      savingsPercent: 0,
    });
    expect(minifyCss("  \n\t ").minified).toBe("");
  });

  it("removes multi-line comments lazily (does not swallow code between comments)", () => {
    expect(minifyCss("/*a*/ p { x: 1 } /*b*/").minified).toBe("p{x:1}");
  });

  it("handles media queries and nested braces", () => {
    expect(minifyCss("@media (max-width: 600px) {\n  a { color: blue; }\n}").minified).toBe(
      "@media (max-width:600px){a{color:blue}}",
    );
  });

  it("keeps already-minified CSS as is with 0% savings", () => {
    const r = minifyCss("a{b:c}");
    expect(r.minified).toBe("a{b:c}");
    expect(r.savingsPercent).toBe(0);
  });

  it("keeps the required spaces around + in calc()", () => {
    expect(minifyCss("a { width: calc(100% + 10px); }").minified).toBe(
      "a{width:calc(100% + 10px)}",
    );
  });

  it("keeps the descendant combinator before a pseudo-class", () => {
    expect(minifyCss("div :first-child { color: red }").minified).toBe(
      "div :first-child{color:red}",
    );
  });

  it("does not alter whitespace inside strings", () => {
    expect(minifyCss('a::before { content: "a  b"; }').minified).toBe('a::before{content:"a  b"}');
    expect(minifyCss("a { content: '/* x */ ; }' }").minified).toBe("a{content:'/* x */ ; }'}");
  });

  it("keeps spaces around - in calc() and tidies commas in values", () => {
    expect(minifyCss("a { top: calc(1em - 2px); color: rgba(0, 0, 0, .5) }").minified).toBe(
      "a{top:calc(1em - 2px);color:rgba(0,0,0,.5)}",
    );
  });
});
