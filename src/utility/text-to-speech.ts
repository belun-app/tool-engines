/**
 * Text-to-speech helpers: splits text into chunks the Web Speech API can speak, estimates
 * the spoken duration, and sorts and picks voices.
 */

export interface SpeechStats {
  words: number;
  characters: number;
  /** Rough spoken length in seconds at the given rate (1 = normal). */
  estimatedSeconds: number;
}

/** Average speaking pace in words per minute at rate 1.0. */
const BASE_WPM = 150;

/**
 * Word count, character count, and an estimated spoken duration.
 * Empty input returns all zeros — never throws.
 */
export function analyzeSpeech(text: string, rate = 1): SpeechStats {
  const trimmed = text.trim();
  if (!trimmed) {
    return { words: 0, characters: 0, estimatedSeconds: 0 };
  }
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const estimatedSeconds = Math.round((words / (BASE_WPM * safeRate)) * 60);
  return { words, characters: text.length, estimatedSeconds };
}

/**
 * Split text into speakable chunks no longer than `maxChars`.
 *
 * Chrome's SpeechSynthesis silently stops after roughly 15 seconds of a single
 * long utterance, so long text has to be fed sentence by sentence. This breaks
 * on sentence boundaries first, then on words when a sentence is still too long.
 */
export function chunkText(text: string, maxChars = 200): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const limit = Math.max(20, maxChars);

  // Keep the punctuation that ends each sentence.
  const sentences = trimmed.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [trimmed];
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > limit) {
      flush();
      // Sentence alone exceeds the limit — split it word by word.
      let piece = "";
      for (const word of sentence.split(/\s+/)) {
        if (piece && piece.length + word.length + 1 > limit) {
          chunks.push(piece.trim());
          piece = "";
        }
        piece += (piece ? " " : "") + word;
      }
      if (piece.trim()) chunks.push(piece.trim());
      continue;
    }
    if (current.length + sentence.length > limit) flush();
    current += sentence;
  }
  flush();
  return chunks;
}

/** Format a number of seconds as m:ss (e.g. 75 → "1:15"). */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Minimal structural shape of the browser's SpeechSynthesisVoice. */
export interface VoiceLike {
  name: string;
  lang: string;
  default?: boolean;
  localService?: boolean;
}

/**
 * Sort voices so the most useful ones surface first: the browser default,
 * then locally installed (offline) voices, then alphabetically by language. `locale`
 * (BCP 47) sets the alphabetical order; default the host's default locale.
 */
export function sortVoices<T extends VoiceLike>(
  voices: readonly T[],
  locale?: string | string[],
): T[] {
  const compare = textCompare(locale);
  return [...voices].sort((a, b) => {
    if (a.default !== b.default) return a.default ? -1 : 1;
    if (a.localService !== b.localService) return a.localService ? -1 : 1;
    const byLang = compare(a.lang, b.lang);
    return byLang !== 0 ? byLang : compare(a.name, b.name);
  });
}

/** String comparison for the locale; an invalid locale falls back to the host default. */
function textCompare(locale?: string | string[]): (a: string, b: string) => number {
  try {
    return new Intl.Collator(locale).compare;
  } catch {
    return new Intl.Collator().compare;
  }
}

/**
 * Pick a sensible starting voice: prefer one matching the preferred BCP-47
 * language prefix (e.g. "en"), fall back to the flagged default, then the first.
 */
export function pickDefaultVoice<T extends VoiceLike>(
  voices: readonly T[],
  preferredLang = "en",
): T | null {
  if (voices.length === 0) return null;
  const prefix = preferredLang.toLowerCase().split("-")[0];
  const byLang = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  if (byLang) return byLang;
  return voices.find((v) => v.default) ?? voices[0];
}

/** A short human label for a voice, e.g. "Samantha — en-US". */
export function voiceLabel(voice: VoiceLike): string {
  const offline = voice.localService ? "" : " · online";
  return `${voice.name} — ${voice.lang}${offline}`;
}

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2, Math.max(0.5, rate));
}

export function clampPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return 1;
  return Math.min(2, Math.max(0, pitch));
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}
