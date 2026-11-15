import { describe, expect, it } from "vitest";
import { formatXML, minifyXML, validateXML } from "./xml-formatter.js";

describe("formatXML", () => {
  it("indents nested elements and keeps leaf text inline", () => {
    const r = formatXML(
      '<?xml version="1.0"?><root><item id="1">Apple</item><empty></empty><br/></root>',
    );
    expect(r).toEqual({
      formatted: [
        '<?xml version="1.0"?>',
        "<root>",
        '  <item id="1">Apple</item>',
        "  <empty></empty>",
        "  <br/>",
        "</root>",
      ].join("\n"),
      error: null,
      isValid: true,
    });
  });

  it("honours indent size", () => {
    expect(formatXML("<a><b/></a>", 4).formatted).toBe("<a>\n    <b/>\n</a>");
    expect(formatXML("<a><b/></a>", 0).formatted).toBe("<a>\n<b/>\n</a>");
  });

  it("normalises whitespace inside tags but not inside quoted values", () => {
    expect(formatXML("<a   x=\"1   2\"\n   y='>' ><b   /></a >").formatted).toBe(
      "<a x=\"1   2\" y='>'>\n  <b/>\n</a>",
    );
  });

  it("keeps comments, CDATA and DOCTYPE verbatim", () => {
    const r = formatXML("<!DOCTYPE note><note><!-- hi --><![CDATA[ <x> & ]]></note>");
    expect(r.formatted).toBe(
      "<!DOCTYPE note>\n<note>\n  <!-- hi -->\n  <![CDATA[ <x> & ]]>\n</note>",
    );
  });

  it("handles namespaces and Unicode text", () => {
    expect(formatXML("<ns:a><ns:b>Привет 😀</ns:b></ns:a>").formatted).toBe(
      "<ns:a>\n  <ns:b>Привет 😀</ns:b>\n</ns:a>",
    );
  });

  it("reports structural errors", () => {
    expect(formatXML("<a><b></a>")).toEqual({
      formatted: null,
      error: "Mismatched tag: expected </b> but found </a>",
      isValid: false,
    });
    expect(formatXML("</a>").error).toBe("Unexpected closing tag </a>");
    expect(formatXML("<a><b>").error).toBe("Unclosed tags: <b>, <a>");
    expect(formatXML("<a>").error).toBe("Unclosed tag: <a>");
  });

  it("returns an empty, invalid, error-free result for blank input", () => {
    expect(formatXML("  \n")).toEqual({ formatted: "", error: null, isValid: false });
  });
});

describe("minifyXML", () => {
  it("removes whitespace between tags", () => {
    expect(minifyXML("<a>\n  <b  x='1' >t</b>\n  <c/>\n</a>")).toEqual({
      formatted: "<a><b x='1'>t</b><c/></a>",
      error: null,
      isValid: true,
    });
  });

  it("reports the same errors as the formatter", () => {
    expect(minifyXML("<a></b>").error).toBe("Mismatched tag: expected </a> but found </b>");
    expect(minifyXML("</a>").isValid).toBe(false);
    expect(minifyXML("<a>").error).toBe("Unclosed tag: <a>");
    expect(minifyXML("").isValid).toBe(false);
  });

  it("keeps significant whitespace in mixed content", () => {
    expect(minifyXML("<p>Hello <b>world</b></p>").formatted).toBe("<p>Hello <b>world</b></p>");
  });
});

describe("validateXML", () => {
  it("validates", () => {
    expect(validateXML("<a/>")).toEqual({ isValid: true, error: null });
    expect(validateXML("<a>").isValid).toBe(false);
    expect(validateXML("")).toEqual({ isValid: false, error: null });
  });
});
