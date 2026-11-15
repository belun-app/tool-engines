/**
 * Reads Hunspell .aff/.dic dictionaries and checks words against them, with affix stripping
 * instead of expanding every word form.
 *
 * A small Hunspell reader: enough of the .aff/.dic format to check words against the
 * en_US (SCOWL) and ru_RU (Lebedev) dictionaries in the browser, without expanding every
 * word form up front. A word is accepted when it is a dictionary stem, or when stripping
 * one suffix and/or one prefix rule leaves a stem that carries that rule's flag — the way
 * Hunspell itself checks. Supported: single-character flags, PFX/SFX with conditions and
 * cross products, NOSUGGEST, ONLYINCOMPOUND, NEEDAFFIX, FORBIDDENWORD, TRY, REP, ICONV.
 * Not supported (neither dictionary needs them): compounding, continuation classes
 * (two-level suffixes), long/numeric flag formats.
 */

interface AffixRule {
  flag: string;
  strip: string;
  add: string;
  /** Tested against the stem (the dictionary word); null when the condition is ".". */
  cond: RegExp | null;
  cross: boolean;
}

export class Hunspell {
  /** Stem → its flags, one character per flag. Homonyms' flags are merged. */
  private readonly words = new Map<string, string>();
  /** Suffix rules keyed by the text they add to the end of a word. */
  private readonly sfx = new Map<string, AffixRule[]>();
  /** Prefix rules keyed by the text they add to the start of a word. */
  private readonly pfx = new Map<string, AffixRule[]>();
  private maxSfxAdd = 0;
  private maxPfxAdd = 0;
  private noSuggestFlag = "";
  private onlyInCompoundFlag = "";
  private needAffixFlag = "";
  private forbiddenFlag = "";
  private readonly iconv: [string, string][] = [];
  /** Letters Hunspell tries first when it makes suggestions, most common first. */
  tryChars = "";
  /** Typical misspellings: replace `from` with `to` ("_" in `to` is a space). */
  readonly rep: [string, string][] = [];

  constructor(aff: string, dic: string) {
    this.parseAff(aff);
    this.parseDic(dic);
  }

  get size(): number {
    return this.words.size;
  }

  private parseAff(aff: string): void {
    const headers = new Set<string>();
    const cross = new Map<string, boolean>();
    for (const rawLine of aff.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const f = line.split(/\s+/);
      switch (f[0]) {
        case "TRY":
          this.tryChars = f[1] ?? "";
          break;
        case "NOSUGGEST":
          this.noSuggestFlag = f[1] ?? "";
          break;
        case "ONLYINCOMPOUND":
          this.onlyInCompoundFlag = f[1] ?? "";
          break;
        case "NEEDAFFIX":
          this.needAffixFlag = f[1] ?? "";
          break;
        case "FORBIDDENWORD":
          this.forbiddenFlag = f[1] ?? "";
          break;
        case "REP":
          if (f.length >= 3) this.rep.push([f[1], f[2]]);
          break;
        case "ICONV":
          if (f.length >= 3) this.iconv.push([f[1], f[2]]);
          break;
        case "PFX":
        case "SFX": {
          const key = `${f[0]}:${f[1]}`;
          if (!headers.has(key)) {
            headers.add(key);
            cross.set(key, f[2] === "Y");
            break;
          }
          if (f.length < 4) break;
          const strip = f[2] === "0" ? "" : f[2];
          const add = (f[3] === "0" ? "" : f[3]).split("/")[0];
          const condText = f[4] ?? ".";
          const isSuffix = f[0] === "SFX";
          const rule: AffixRule = {
            flag: f[1],
            strip,
            add,
            cond: condText === "." ? null : new RegExp(isSuffix ? `${condText}$` : `^${condText}`),
            cross: cross.get(key) ?? false,
          };
          const table = isSuffix ? this.sfx : this.pfx;
          const list = table.get(add);
          if (list) list.push(rule);
          else table.set(add, [rule]);
          if (isSuffix) this.maxSfxAdd = Math.max(this.maxSfxAdd, add.length);
          else this.maxPfxAdd = Math.max(this.maxPfxAdd, add.length);
          break;
        }
        default:
          break;
      }
    }
  }

  private parseDic(dic: string): void {
    const lines = dic.split("\n");
    // The first line is the (approximate) word count.
    for (let i = /^\d+\s*$/.test(lines[0] ?? "") ? 1 : 0; i < lines.length; i++) {
      let line = lines[i];
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line) continue;
      const tab = line.indexOf("\t");
      if (tab >= 0) line = line.slice(0, tab);
      const slash = line.indexOf("/");
      const word = (slash >= 0 ? line.slice(0, slash) : line).trim();
      const flags = slash >= 0 ? line.slice(slash + 1).trim() : "";
      if (!word) continue;
      const prev = this.words.get(word);
      this.words.set(word, prev === undefined ? flags : prev + flags);
    }
  }

  /** Applies the dictionary's input conversions (en_US: typographic apostrophe → '). */
  normalize(word: string): string {
    let w = word;
    for (const [from, to] of this.iconv) w = w.split(from).join(to);
    return w;
  }

  /** Stem lookup: the word exists, is allowed on its own, and has every required flag. */
  private root(word: string, ...need: string[]): boolean {
    const flags = this.words.get(word);
    if (flags === undefined) return false;
    if (this.forbiddenFlag && flags.includes(this.forbiddenFlag)) return false;
    if (this.onlyInCompoundFlag && flags.includes(this.onlyInCompoundFlag)) return false;
    if (need.length === 0 && this.needAffixFlag && flags.includes(this.needAffixFlag)) return false;
    for (const flag of need) if (!flags.includes(flag)) return false;
    return true;
  }

  /** Strips one prefix rule; with `sfxFlag`, the stem must also carry that suffix flag. */
  private checkPrefix(word: string, sfxFlag?: string): boolean {
    const max = Math.min(this.maxPfxAdd, word.length);
    for (let k = 0; k <= max; k++) {
      const rules = this.pfx.get(word.slice(0, k));
      if (!rules) continue;
      const rest = word.slice(k);
      for (const r of rules) {
        if (sfxFlag !== undefined && !r.cross) continue;
        const base = r.strip + rest;
        if (!base || (r.cond && !r.cond.test(base))) continue;
        if (sfxFlag === undefined ? this.root(base, r.flag) : this.root(base, r.flag, sfxFlag)) {
          return true;
        }
      }
    }
    return false;
  }

  /** True when `word` (exact case) is a valid word form of the dictionary. */
  check(word: string): boolean {
    if (!word) return false;
    if (this.root(word)) return true;
    const len = word.length;
    const max = Math.min(this.maxSfxAdd, len);
    for (let k = 0; k <= max; k++) {
      const rules = this.sfx.get(word.slice(len - k));
      if (!rules) continue;
      const head = word.slice(0, len - k);
      for (const r of rules) {
        const base = head + r.strip;
        if (!base || (r.cond && !r.cond.test(base))) continue;
        if (this.root(base, r.flag)) return true;
        // Prefix and suffix together ("un-" + "do" + "-ing"), when both rules allow it.
        if (r.cross && this.maxPfxAdd > 0 && this.checkPrefix(base, r.flag)) return true;
      }
    }
    return this.maxPfxAdd > 0 && this.checkPrefix(word);
  }

  /** Words marked NOSUGGEST (slurs, in en_US) are accepted but never offered. */
  suggestable(word: string): boolean {
    if (!this.noSuggestFlag) return true;
    const flags = this.words.get(word);
    return flags === undefined || !flags.includes(this.noSuggestFlag);
  }
}
