/**
 * Rule-based checks for English text: repeated words, "a" versus "an" by the next word's
 * sound, a lowercase pronoun "i", multiple spaces, and no space after punctuation.
 */

export interface GrammarIssue {
  message: string;
  offset: number;
  length: number;
  suggestion: string;
  category: "grammar" | "style" | "punctuation";
}

export interface GrammarCheckResult {
  issues: GrammarIssue[];
  issueCount: number;
}

function findDoubleSpaces(text: string): GrammarIssue[] {
  const issues: GrammarIssue[] = [];
  for (const m of text.matchAll(/ {2,}/g)) {
    issues.push({
      message: "Multiple consecutive spaces",
      offset: m.index ?? 0,
      length: m[0].length,
      suggestion: " ",
      category: "style",
    });
  }
  return issues;
}

function findRepeatedWords(text: string): GrammarIssue[] {
  const issues: GrammarIssue[] = [];
  for (const m of text.matchAll(/\b(\w+)\s+\1\b/gi)) {
    issues.push({
      message: `Repeated word: "${m[1].toLowerCase()}"`,
      offset: m.index ?? 0,
      length: m[0].length,
      suggestion: m[1],
      category: "grammar",
    });
  }
  return issues;
}

function findAAnMisuse(text: string): GrammarIssue[] {
  const issues: GrammarIssue[] = [];

  const consonantSoundVowelStarts = new Set([
    "one",
    "once",
    "european",
    "unique",
    "unit",
    "units",
    "united",
    "union",
    "unions",
    "uniform",
    "uniforms",
    "unicorn",
    "unicorns",
    "university",
    "universities",
    "use",
    "used",
    "user",
    "users",
    "using",
    "useful",
    "usually",
    "usual",
    "ukulele",
    "unanimous",
  ]);

  const vowelSoundConsonantStarts = new Set([
    "hour",
    "hours",
    "honest",
    "honesty",
    "honor",
    "honours",
    "honors",
    "heir",
    "heirs",
  ]);

  // lowercase "a" before a vowel-starting word → should be "an"
  for (const m of text.matchAll(/\ba\s+([a-z]\w*)/g)) {
    const word = m[1].toLowerCase();
    if (!/^[aeiou]/.test(word)) continue;
    if (consonantSoundVowelStarts.has(word)) continue;
    issues.push({
      message: `Use "an" before "${m[1]}" (vowel sound)`,
      offset: m.index ?? 0,
      length: 1,
      suggestion: "an",
      category: "grammar",
    });
  }

  // lowercase "an" before a consonant-starting word (excluding h) → should be "a"
  for (const m of text.matchAll(/\ban\s+([a-z]\w*)/g)) {
    const word = m[1].toLowerCase();
    if (/^[aeiou]/.test(word)) continue;
    if (word.startsWith("h")) continue;
    if (vowelSoundConsonantStarts.has(word)) continue;
    issues.push({
      message: `Use "a" before "${m[1]}" (consonant sound)`,
      offset: m.index ?? 0,
      length: 2,
      suggestion: "a",
      category: "grammar",
    });
  }

  return issues;
}

function findLowercaseI(text: string): GrammarIssue[] {
  const issues: GrammarIssue[] = [];
  for (const m of text.matchAll(/\bi\b/g)) {
    const idx = m.index ?? 0;
    // Skip "i.e." abbreviation
    if (text[idx + 1] === ".") continue;
    // Skip list markers like "i)" at line start
    const prev = idx > 0 ? text[idx - 1] : "\n";
    if (
      (prev === "\n" || prev === " " || idx === 0) &&
      (text[idx + 1] === ")" || text[idx + 1] === ".")
    )
      continue;
    issues.push({
      message: 'The pronoun "I" should be capitalized',
      offset: idx,
      length: 1,
      suggestion: "I",
      category: "grammar",
    });
  }
  return issues;
}

function findMissingSpaceAfterPunctuation(text: string): GrammarIssue[] {
  const issues: GrammarIssue[] = [];
  // Not at the end of the text ("Dear John,"), and not a comma between digits — a
  // thousands separator or decimal comma ("1,000", "3,5").
  for (const m of text.matchAll(/[,;](?!["\s\n]|$)/g)) {
    const at = m.index ?? 0;
    if (m[0] === "," && /\d/.test(text[at - 1] ?? "") && /\d/.test(text[at + 1] ?? "")) continue;
    issues.push({
      message: `Missing space after "${m[0]}"`,
      offset: (m.index ?? 0) + 1,
      length: 0,
      suggestion: " ",
      category: "punctuation",
    });
  }
  return issues;
}

export function checkGrammar(text: string): GrammarCheckResult {
  if (!text.trim()) return { issues: [], issueCount: 0 };

  const allIssues: GrammarIssue[] = [
    ...findDoubleSpaces(text),
    ...findRepeatedWords(text),
    ...findAAnMisuse(text),
    ...findLowercaseI(text),
    ...findMissingSpaceAfterPunctuation(text),
  ];

  const seen = new Set<number>();
  const issues = allIssues
    .filter((issue) => {
      if (seen.has(issue.offset)) return false;
      seen.add(issue.offset);
      return true;
    })
    .sort((a, b) => a.offset - b.offset);

  return { issues, issueCount: issues.length };
}
