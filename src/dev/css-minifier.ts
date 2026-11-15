/**
 * Minifies CSS: drops comments and redundant whitespace and the last semicolon of each
 * block, copies string literals verbatim, and reports the size saving.
 */

export interface CssMinifyResult {
  minified: string;
  originalBytes: number;
  minifiedBytes: number;
  savingsPercent: number;
}

// Private-use placeholders for string literals while whitespace is rewritten.
const STR_OPEN = "\uE000";
const STR_CLOSE = "\uE001";

/**
 * Selector or at-rule prelude. Spaces around the combinators > ~ + and the comma go,
 * but a space before ":" stays — "div :hover" (descendant) is not "div:hover".
 * In an at-rule ("@media (max-width : 600px)") the colon is a feature separator.
 */
function tidyPrelude(segment: string): string {
  let s = segment.replace(/\s*([>~+,])\s*/g, "$1");
  if (s.startsWith("@")) s = s.replace(/\s*:\s*/g, ":");
  return s;
}

/**
 * Declaration "prop : value". Only the space around the property colon and after
 * commas goes; operators inside values keep their spaces, because calc(100% + 10px)
 * is invalid CSS without them.
 */
function tidyDeclaration(segment: string): string {
  return segment.replace(/^([^:]*?)\s*:\s*/, "$1:").replace(/\s*,\s*/g, ",");
}

export function minifyCss(css: string): CssMinifyResult {
  const originalBytes = css.length;

  if (!css.trim()) {
    return { minified: "", originalBytes: 0, minifiedBytes: 0, savingsPercent: 0 };
  }

  // 1. Strings are copied verbatim and swapped for placeholders; comments are dropped.
  const strings: string[] = [];
  let text = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      text += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      text += `${STR_OPEN}${strings.length}${STR_CLOSE}`;
      strings.push(css.slice(i, Math.min(j + 1, css.length)));
      i = j;
      continue;
    }
    text += c;
  }

  // 2. Collapse whitespace, then tidy each segment by its role. A segment followed by
  //    "{" is a selector or at-rule prelude; anything else is a declaration.
  text = text.replace(/\s+/g, " ");
  const parts = text.split(/([{};])/);
  let out = "";
  for (let k = 0; k < parts.length; k += 2) {
    const segment = parts[k].trim();
    const delimiter = parts[k + 1] ?? "";
    out += delimiter === "{" ? tidyPrelude(segment) : tidyDeclaration(segment);
    out += delimiter;
  }

  // 3. Drop empty declarations and the last semicolon in a block.
  out = out
    .replace(/;+/g, ";")
    .replace(/([{;]);/g, "$1")
    .replace(/;}/g, "}");
  out = out.trim();
  out = out.replace(new RegExp(`${STR_OPEN}(\\d+)${STR_CLOSE}`, "g"), (_, n) => strings[+n]);

  const minifiedBytes = out.length;
  const savingsPercent =
    originalBytes > 0 ? Math.round(((originalBytes - minifiedBytes) / originalBytes) * 100) : 0;

  return { minified: out, originalBytes, minifiedBytes, savingsPercent };
}
