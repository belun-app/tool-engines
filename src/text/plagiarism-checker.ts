/**
 * Similarity between two texts: the share of distinct words they have in common (Jaccard
 * index) and how many sentences of the first text appear in the second.
 */

export interface PlagiarismResult {
  similarityPercent: number;
  matchingSentences: number;
  totalSentencesA: number;
  commonWords: number;
  uniqueWordsA: number;
  uniqueWordsB: number;
}

export function checkPlagiarism(textA: string, textB: string): PlagiarismResult {
  const empty: PlagiarismResult = {
    similarityPercent: 0,
    matchingSentences: 0,
    totalSentencesA: 0,
    commonWords: 0,
    uniqueWordsA: 0,
    uniqueWordsB: 0,
  };

  if (!textA.trim() || !textB.trim()) return empty;

  const sentencesA = splitSentences(textA);
  const normalizedB = new Set(splitSentences(textB).map(normalizeSentence));

  let matchingSentences = 0;
  for (const s of sentencesA) {
    const n = normalizeSentence(s);
    // a sentence with no letters or digits ("...", "!!!") is not evidence of copying
    if (n && normalizedB.has(n)) matchingSentences++;
  }

  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);

  let commonWords = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) commonWords++;
  }

  const union = wordsA.size + wordsB.size - commonWords;
  const similarityPercent = union > 0 ? Math.round((commonWords / union) * 100) : 0;

  return {
    similarityPercent,
    matchingSentences,
    totalSentencesA: sentencesA.length,
    commonWords,
    uniqueWordsA: wordsA.size,
    uniqueWordsB: wordsB.size,
  };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Letters of any script (Cyrillic included), combining marks and digits.
function normalizeSentence(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  return new Set(words);
}
