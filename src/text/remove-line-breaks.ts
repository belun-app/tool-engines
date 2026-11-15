/**
 * Removes line breaks from text, either all of them or only inside paragraphs, joining the
 * lines with a chosen separator.
 */

export type RemoveLineBreaksMode = "all" | "paragraphs";

export interface RemoveLineBreaksOptions {
  mode: RemoveLineBreaksMode;
  separator: string;
}

export interface RemoveLineBreaksResult {
  output: string;
  inputLines: number;
  breaksRemoved: number;
  outputCharacters: number;
}

const DEFAULT_OPTIONS: RemoveLineBreaksOptions = {
  mode: "all",
  separator: " ",
};

export function removeLineBreaks(
  text: string,
  options: Partial<RemoveLineBreaksOptions> = {},
): RemoveLineBreaksResult {
  const { mode, separator } = { ...DEFAULT_OPTIONS, ...options };
  const normalized = text.replace(/\r\n?/g, "\n");

  if (!normalized.trim()) {
    return { output: "", inputLines: 0, breaksRemoved: 0, outputCharacters: 0 };
  }

  let output: string;
  if (mode === "paragraphs") {
    output = normalized
      .split(/\n\s*\n/)
      .map((paragraph) => joinLines(paragraph, separator))
      .filter((paragraph) => paragraph.length > 0)
      .join("\n\n");
  } else {
    output = joinLines(normalized, separator);
  }

  const breaksIn = countNewlines(normalized);
  const breaksOut = countNewlines(output);

  return {
    output,
    inputLines: normalized.split("\n").length,
    breaksRemoved: breaksIn - breaksOut,
    outputCharacters: output.length,
  };
}

function joinLines(text: string, separator: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(separator);
}

function countNewlines(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === "\n") count += 1;
  }
  return count;
}
