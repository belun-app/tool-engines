import { describe, expect, it } from "vitest";
import { convertCase } from "./text-case-converter.js";

const c = (text: string, type: Parameters<typeof convertCase>[1]) => convertCase(text, type).output;

describe("convertCase", () => {
  it("returns empty output for empty input", () => {
    expect(c("", "upper")).toBe("");
    expect(c("", "camel")).toBe("");
  });

  it("upper/lower handle Latin, Cyrillic and ß", () => {
    expect(c("Hello Мир", "upper")).toBe("HELLO МИР");
    expect(c("Hello МИР", "lower")).toBe("hello мир");
    expect(c("straße", "upper")).toBe("STRASSE");
  });

  it("title case capitalises each word and lowercases the rest", () => {
    expect(c("the qUICK brown fox", "title")).toBe("The Quick Brown Fox");
    expect(c("hello-world it's", "title")).toBe("Hello-world It's");
  });

  it("sentence case capitalises after . ! ? and at the start", () => {
    expect(c("HELLO there. how ARE you? fine! ok", "sentence")).toBe(
      "Hello there. How are you? Fine! Ok",
    );
    expect(c("  leading space", "sentence")).toBe("  Leading space");
  });

  it("camel / pascal / snake / kebab from words with mixed separators", () => {
    const s = "Hello world-foo_bar.baz";
    expect(c(s, "camel")).toBe("helloWorldFooBarBaz");
    expect(c(s, "pascal")).toBe("HelloWorldFooBarBaz");
    expect(c(s, "snake")).toBe("hello_world_foo_bar_baz");
    expect(c(s, "kebab")).toBe("hello-world-foo-bar-baz");
  });

  it("splits existing camelCase and keeps acronym runs together", () => {
    expect(c("someVariableName", "kebab")).toBe("some-variable-name");
    expect(c("XMLHttpRequest", "snake")).toBe("xml_http_request");
    expect(c("user_account_settings", "pascal")).toBe("UserAccountSettings");
    expect(c("version2Update", "snake")).toBe("version2_update");
  });

  it("whitespace-only input gives empty identifier output", () => {
    expect(c("   ", "camel")).toBe("");
    expect(c("   ", "snake")).toBe("");
  });

  it("camel/pascal capitalise Cyrillic words", () => {
    expect(c("привет мир", "camel")).toBe("приветМир");
    expect(c("привет мир", "pascal")).toBe("ПриветМир");
    expect(c("привет мир", "snake")).toBe("привет_мир");
  });

  it("returns the input unchanged for an unknown case type", () => {
    expect(c("AbC", "nope" as never)).toBe("AbC");
  });

  it("title-cases Cyrillic words", () => {
    expect(c("привет мир", "title")).toBe("Привет Мир");
  });

  it("title-cases words starting with an accented letter", () => {
    expect(c("élan vital", "title")).toBe("Élan Vital");
  });

  it("sentence-cases Cyrillic text", () => {
    expect(c("ПРИВЕТ. КАК ДЕЛА?", "sentence")).toBe("Привет. Как дела?");
  });

  it("splits Cyrillic camelCase on its case boundaries", () => {
    expect(c("приветМир", "snake")).toBe("привет_мир");
    expect(c("ПриветМир", "kebab")).toBe("привет-мир");
  });
});
