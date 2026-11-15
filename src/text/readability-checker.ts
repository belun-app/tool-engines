/**
 * Readability of English or Russian text: Flesch Reading Ease and grade level (Oborneva's
 * coefficients for Russian), with word, sentence and syllable counts.
 */

export interface ReadabilityResult {
  words: number;
  sentences: number;
  syllables: number;
  fleschScore: number;
  gradeLevel: number;
  readabilityLabel: string;
  avgWordsPerSentence: number;
  avgSyllablesPerWord: number;
}

const CYRILLIC_VOWELS = /[аеёиоуыэюя]/g;

function countSyllables(word: string): number {
  // A Russian word has exactly as many syllables as vowels.
  const cyrillic = (word.toLowerCase().match(CYRILLIC_VOWELS) ?? []).length;
  if (cyrillic > 0) return cyrillic;

  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w.length) return 0;
  if (w.length <= 3) return 1;

  let count = 0;
  let inVowel = false;

  for (const ch of w) {
    const isVowel = "aeiouy".includes(ch);
    if (isVowel && !inVowel) {
      count++;
      inVowel = true;
    } else if (!isVowel) {
      inVowel = false;
    }
  }

  // Subtract silent trailing 'e'
  if (w.endsWith("e") && count > 1) count--;

  return Math.max(1, count);
}

function getLabel(score: number): string {
  if (score >= 90) return "Very Easy";
  if (score >= 80) return "Easy";
  if (score >= 70) return "Fairly Easy";
  if (score >= 60) return "Standard";
  if (score >= 50) return "Fairly Difficult";
  if (score >= 30) return "Difficult";
  return "Very Difficult";
}

export function checkReadability(text: string): ReadabilityResult {
  const trimmed = text.trim();

  if (!trimmed) {
    return {
      words: 0,
      sentences: 0,
      syllables: 0,
      fleschScore: 0,
      gradeLevel: 0,
      readabilityLabel: "—",
      avgWordsPerSentence: 0,
      avgSyllablesPerWord: 0,
    };
  }

  const wordList = trimmed.split(/\s+/).filter(Boolean);
  const words = wordList.length;

  const sentenceList = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentences = Math.max(1, sentenceList.length);

  const syllables = wordList.reduce((sum, w) => sum + countSyllables(w), 0);

  const avgWordsPerSentence = words / sentences;
  const avgSyllablesPerWord = syllables / words;

  // Russian words are longer in syllables, so mostly-Cyrillic text uses Oborneva's (2006)
  // adaptation of both formulas; English text keeps the original coefficients.
  const cyrillicLetters = (trimmed.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const latinLetters = (trimmed.match(/\p{Script=Latin}/gu) ?? []).length;
  const russian = cyrillicLetters > latinLetters;

  // Flesch Reading Ease (0–100, higher = easier)
  const rawFlesch = russian
    ? 206.835 - 1.3 * avgWordsPerSentence - 60.1 * avgSyllablesPerWord
    : 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;
  const fleschScore = Math.max(0, Math.min(100, rawFlesch));

  // Flesch-Kincaid Grade Level
  const rawGrade = russian
    ? 0.5 * avgWordsPerSentence + 8.4 * avgSyllablesPerWord - 15.59
    : 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;
  const gradeLevel = Math.max(0, rawGrade);

  return {
    words,
    sentences,
    syllables,
    fleschScore: Math.round(fleschScore * 10) / 10,
    gradeLevel: Math.round(gradeLevel * 10) / 10,
    readabilityLabel: getLabel(fleschScore),
    avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
    avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100,
  };
}
