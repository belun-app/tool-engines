/**
 * Converts text to upper, lower, title, sentence, camel, Pascal, snake or kebab case.
 */

export type CaseType =
  | "upper"
  | "lower"
  | "title"
  | "sentence"
  | "camel"
  | "pascal"
  | "snake"
  | "kebab";

export interface TextCaseResult {
  output: string;
}

// Splits a string into words on separators AND on case boundaries, so that
// identifiers already written in camelCase/PascalCase round-trip correctly.
// The second replace keeps acronym runs intact: XMLHttpRequest -> XML Http Request.
function splitWords(text: string): string[] {
  return text
    .trim()
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    .split(/[\s_\-./\\]+/)
    .filter(Boolean);
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Word characters of any script (Cyrillic, accented Latin, …), not just ASCII \w.
function toTitleCase(text: string): string {
  return text.replace(
    /[\p{L}\p{N}_]\S*/gu,
    (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
  );
}

function toSentenceCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^\s*[\p{L}\p{N}]|[.!?…]\s+[\p{L}\p{N}])/gu, (c) => c.toUpperCase());
}

function toCamelCase(text: string): string {
  return splitWords(text)
    .map((w, i) => (i === 0 ? w.toLowerCase() : capitalise(w)))
    .join("");
}

function toPascalCase(text: string): string {
  return splitWords(text).map(capitalise).join("");
}

function toSnakeCase(text: string): string {
  return splitWords(text)
    .map((w) => w.toLowerCase())
    .join("_");
}

function toKebabCase(text: string): string {
  return splitWords(text)
    .map((w) => w.toLowerCase())
    .join("-");
}

export function convertCase(text: string, caseType: CaseType): TextCaseResult {
  if (!text) return { output: "" };

  switch (caseType) {
    case "upper":
      return { output: text.toUpperCase() };
    case "lower":
      return { output: text.toLowerCase() };
    case "title":
      return { output: toTitleCase(text) };
    case "sentence":
      return { output: toSentenceCase(text) };
    case "camel":
      return { output: toCamelCase(text) };
    case "pascal":
      return { output: toPascalCase(text) };
    case "snake":
      return { output: toSnakeCase(text) };
    case "kebab":
      return { output: toKebabCase(text) };
    default:
      return { output: text };
  }
}
