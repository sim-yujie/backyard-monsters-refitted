/**
 * The word filter's matcher (owner, 4 Nov 2026: "Can we automate scanning of
 * world chat for profanity? Seems like some stuff still go through").
 *
 * A copy of the line is normalised before matching, keeping track of which
 * of the player's characters each normalised letter came from, so a word
 * that is caught is masked where the player typed it:
 *
 * - lower case; accents, fullwidth and fancy Unicode letters to plain ones
 *   (NFKC, then accents dropped); zero-width and invisible characters out;
 * - Cyrillic and Greek look-alike letters to Latin ("fuсk" with a Cyrillic
 *   "с"), but only inside a word that also has a Latin letter, so Russian or
 *   Greek written as such is left alone;
 * - leetspeak: 0 o, 1 ! | i, 3 e, 4 @ a, 5 $ s, 7 + t, 8 b ("sh1t", "@$$");
 *   a word of digits only is never read this way (scores like 455 stay);
 * - "v" read as "u" when that makes a listed word ("fvck");
 * - letters repeated three or more times read as one or as the word has them
 *   ("fuuuck", "puuuta"); a doubled letter is not enough, so "noob" is not "nob";
 * - letters split by spaces, dots, dashes, underscores or asterisks joined
 *   ("f u c k", "f.u.c.k", "f-u-c-k"), three letters or more;
 * - an asterisk inside a word stands for any letter that makes a listed word
 *   ("f*ck", "sh*t"), with at least two real letters;
 * - two words joined when the list has them as one phrase ("blow job").
 *
 * Words are matched whole. A few stems ({@link STEMS}) are also found inside
 * longer words ("putanginamo", "fuckface"), except in the ordinary words of
 * {@link ORDINARY_WORDS} ("shiitake"). Those ordinary words never match at
 * all, however they are spelled.
 */

/** Where a caught word sits in the player's line, and what it was read as. */
export interface WordHit {
  /** The listed word it was read as, lower case. */
  word: string;
  /** The player's characters that made it: `[start, end)` in the line. */
  start: number;
  end: number;
  /** The player's own spelling is not the listed word as such. */
  disguised: boolean;
}

/** A line as players see it, and what was caught in it. */
export interface WordScan {
  shown: string;
  hits: WordHit[];
}

/**
 * Stems also caught inside longer words. Only ones no ordinary word holds,
 * or whose ordinary words are in {@link ORDINARY_WORDS}.
 */
export const STEMS: readonly string[] = [
  "fuck",
  "motherfuck",
  "shit",
  "bitch",
  "faggot",
  "cocksuck",
  "putangina",
  "tangina",
  "pakyu",
];

/**
 * Ordinary words that are never caught, however they are spelled: words that
 * hold a stem or look like a listed word once disguises are read
 * (Scunthorpe-style false hits).
 */
export const ORDINARY_WORDS: readonly string[] = [
  "puke",
  "class",
  "classic",
  "assess",
  "assassin",
  "bass",
  "pass",
  "dickens",
  "pakistan",
  "scunthorpe",
  "shitake",
  "shiitake",
  "mishit",
  "mishits",
  "cockpit",
  "cocktail",
  "hancock",
  "therapist",
  "analysis",
  "japan",
  "spice",
  "spicy",
  "snigger",
  "sniggers",
  "sniggered",
  "sniggering",
  "niggard",
  "niggardly",
  "computation",
  "reputation",
  "dispute",
];

/** Invisible characters: zero-width spaces and joiners, soft hyphens, direction marks. */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁪-⁯﻿]/u;

/** Cyrillic and Greek letters that look like Latin ones, and a few Latin oddities. */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  і: "i", ї: "i", ј: "j", ѕ: "s", ԁ: "d", ԛ: "q", ԝ: "w", ӏ: "l", ү: "y",
  α: "a", β: "b", γ: "y", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
  ɡ: "g", ƒ: "f", ı: "i", ł: "l", ø: "o", đ: "d", ß: "ss", ŋ: "n",
};

/** Leetspeak digits and symbols, read as letters. */
const LEET: Readonly<Record<string, string>> = {
  "0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "+": "t",
  "8": "b",
};

const isLetter = (c: string) => c >= "a" && c <= "z";
const isDigit = (c: string) => c >= "0" && c <= "9";
const isLeetSymbol = (c: string) => c === "!" || c === "|" || c === "@" || c === "$" || c === "+";
/** Between letters split apart: "f u c k", "f.u.c.k", "f-u-c-k", "f_u_c_k", "f*u*c*k". */
const isSplitter = (c: string) => c === " " || c === "." || c === "-" || c === "_" || c === "*" || c === "\t";

/** One character of the normalised copy and where it came from. */
interface Norm {
  c: string;
  from: number;
  to: number;
  /** Came from a Cyrillic or Greek look-alike. */
  look: boolean;
}

const normalise = (text: string): Norm[] => {
  const out: Norm[] = [];
  let i = 0;
  for (const ch of text) {
    const from = i;
    i += ch.length;
    if (INVISIBLE.test(ch)) continue;
    const plain = ch.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (const c of plain) {
      const look = LOOK_ALIKES[c];
      if (look !== undefined) for (const l of look) out.push({ c: l, from, to: i, look: true });
      else out.push({ c, from, to: i, look: false });
    }
  }
  return out;
};

/** Letters and their run lengths: "fuuuck" is f1 u3 c1 k1. */
const runs = (word: string): { letters: string; counts: number[] } => {
  let letters = "";
  const counts: number[] = [];
  for (const c of word) {
    if (letters.endsWith(c)) counts[counts.length - 1]!++;
    else {
      letters += c;
      counts.push(1);
    }
  }
  return { letters, counts };
};

/** Turns a list entry into the form it is matched in, or null when it cannot be matched. */
const entryForm = (entry: string): { word: string; phrase: boolean } | null => {
  const lower = entry.trim().toLowerCase();
  // Entries with wildcards or dots ("fag*", "s.o.b.") never matched before either.
  if (!lower || /[*.(;]/.test(lower)) return null;
  const parts = lower.split(/[\s_-]+/).filter(Boolean);
  const joined = parts.join("");
  let word = "";
  for (const c of joined) word += LEET[c] ?? c;
  if (!/^[a-z]{2,}$/.test(word)) return null;
  // "blow job" is a phrase; "f u c k" and "s hit" are a word split up.
  const phrase = parts.length > 1 && parts.every((part) => part.length >= 3);
  return { word, phrase };
};

/**
 * The word a list entry is caught as ("n1gga" is caught as "nigga"), as
 * {@link WordHit.word} reports it, or null for an entry that is never matched.
 */
export const listedWord = (entry: string): string | null => entryForm(entry)?.word ?? null;

export interface WordMatcherOptions {
  /** Words never caught (and taken off the list): ordinary words that the list has. */
  allowed?: readonly string[];
}

/** The matcher for one word list. */
export class WordMatcher {
  /** Listed words by their letters with repeats taken out. */
  private readonly byLetters = new Map<string, { word: string; counts: number[] }[]>();
  /** Listed words by length, for "f*ck". */
  private readonly byLength = new Map<number, string[]>();
  private readonly phrases = new Set<string>();
  private readonly ordinary: ReadonlySet<string>;
  private readonly stems: { stem: string; pattern: RegExp }[];

  constructor(entries: readonly string[], options: WordMatcherOptions = {}) {
    const allowed = new Set((options.allowed ?? []).map((word) => word.toLowerCase()));
    this.ordinary = new Set([...ORDINARY_WORDS, ...allowed]);
    const words = new Set<string>();
    for (const entry of entries) {
      const form = entryForm(entry);
      if (!form || allowed.has(form.word)) continue;
      words.add(form.word);
      if (form.phrase) this.phrases.add(form.word);
    }
    for (const word of words) {
      const { letters, counts } = runs(word);
      const same = this.byLetters.get(letters) ?? [];
      same.push({ word, counts });
      this.byLetters.set(letters, same);
      const sameLength = this.byLength.get(word.length) ?? [];
      sameLength.push(word);
      this.byLength.set(word.length, sameLength);
    }
    this.stems = STEMS.map((stem) => ({
      stem,
      pattern: new RegExp([...stem].map((c) => `${c}+`).join("")),
    }));
  }

  /** The listed word `candidate` (letters a-z) is, read whole, or null. */
  private whole(candidate: string): string | null {
    if (this.ordinary.has(candidate)) return null;
    const { letters, counts } = runs(candidate);
    for (const { word, counts: need } of this.byLetters.get(letters) ?? []) {
      // Each letter as often as the word has it, or three times and more ("fuuuck").
      if (counts.every((n, k) => n === need[k] || (n > need[k]! && n >= 3))) return word;
    }
    return null;
  }

  /** "f*ck": the listed word an asterisked candidate fits, or null. */
  private starred(candidate: string): string | null {
    const stars = [...candidate].filter((c) => c === "*").length;
    if (stars === 0 || candidate.length - stars < 2 || stars * 2 > candidate.length) return null;
    const pattern = new RegExp(`^${candidate.replace(/\*/g, "[a-z]")}$`);
    for (const word of this.byLength.get(candidate.length) ?? []) {
      if (pattern.test(word) && !this.ordinary.has(word)) return word;
    }
    return null;
  }

  /** A stem inside a longer word, or null. */
  private stem(candidate: string): string | null {
    if (this.ordinary.has(candidate)) return null;
    for (const { stem, pattern } of this.stems) if (pattern.test(candidate)) return stem;
    return null;
  }

  /** What a candidate is read as: whole, starred, a stem, then all of those with "v" as "u". */
  private read(candidate: string, stems: boolean): string | null {
    const tries = candidate.includes("v") ? [candidate, candidate.replace(/v/g, "u")] : [candidate];
    for (const t of tries) {
      const found = t.includes("*") ? this.starred(t) : (this.whole(t) ?? (stems ? this.stem(t) : null));
      if (found) return found;
    }
    return null;
  }

  /** Every caught word in a line, in order, none overlapping. */
  hits(text: string): WordHit[] {
    const norm = normalise(text);
    const tokens = this.tokens(norm);
    const hits: WordHit[] = [];
    const used = new Set<number>();
    const hit = (word: string, start: number, end: number) => {
      const raw = text.slice(start, end).toLowerCase();
      hits.push({ word, start, end, disguised: !raw.includes(word) });
    };

    // Letters split apart: "f u c k", "f.u.c.k".
    for (let t = 0; t < tokens.length; ) {
      let u = t;
      while (u < tokens.length && tokens[u]!.text.length === 1 && (u === t || tokens[u]!.splitFromLast)) u++;
      if (u - t >= 3) {
        const joined = tokens.slice(t, u).map((token) => token.text).join("");
        const word = this.read(joined, true);
        if (word) {
          for (let k = t; k < u; k++) used.add(k);
          hit(word, tokens[t]!.start, tokens[u - 1]!.end);
          t = u;
          continue;
        }
      }
      t = Math.max(u, t + 1);
    }

    // Whole words first in every reading ("fuck!" is "fuck"), then stems inside longer words.
    tokens.forEach((token, t) => {
      if (used.has(t)) return;
      for (const stems of [false, true]) {
        for (const candidate of token.candidates) {
          const word = this.read(candidate.text, stems);
          if (word) {
            used.add(t);
            hit(word, candidate.start, candidate.end);
            return;
          }
        }
      }
    });

    // Two words the list has as one phrase: "blow job".
    for (let t = 0; t + 1 < tokens.length; t++) {
      if (used.has(t) || used.has(t + 1) || !tokens[t + 1]!.spaceFromLast) continue;
      const joined = tokens[t]!.text + tokens[t + 1]!.text;
      if (tokens[t]!.text.length >= 3 && tokens[t + 1]!.text.length >= 3 && this.phrases.has(joined)) {
        used.add(t).add(t + 1);
        hit(joined, tokens[t]!.start, tokens[t + 1]!.end);
      }
    }

    return hits.sort((a, b) => a.start - b.start);
  }

  /**
   * The line's words: runs of letters, digits, leet symbols and inner
   * asterisks. Each has its normalised text and the readings to try (all of
   * it, then without leet symbols at its ends: "fuck!").
   */
  private tokens(norm: Norm[]) {
    const tokens: {
      text: string;
      start: number;
      end: number;
      splitFromLast: boolean;
      spaceFromLast: boolean;
      candidates: { text: string; start: number; end: number }[];
    }[] = [];
    const inWord = (n: Norm | undefined) => n !== undefined && (isLetter(n.c) || isDigit(n.c) || isLeetSymbol(n.c));
    let i = 0;
    let gap: Norm[] = [];
    while (i < norm.length) {
      if (!inWord(norm[i])) {
        gap.push(norm[i]!);
        i++;
        continue;
      }
      let j = i;
      // A word runs on through letters, digits, leet symbols, and asterisks with a word character after them.
      while (j < norm.length && (inWord(norm[j]) || (norm[j]!.c === "*" && j > i && inWord(norm[j + 1])))) j++;
      const chars = norm.slice(i, j);
      const hasLatin = chars.some((n) => isLetter(n.c) && !n.look);
      const hasLetterOrSymbol = chars.some((n) => isLetter(n.c) || isLeetSymbol(n.c));
      const readAll = (part: Norm[]) => part.map((n) => (n.c === "*" ? "*" : (LEET[n.c] ?? n.c))).join("");
      const candidates: { text: string; start: number; end: number }[] = [];
      if (hasLatin || (hasLetterOrSymbol && !chars.some((n) => n.look))) {
        candidates.push({ text: readAll(chars), start: chars[0]!.from, end: chars[chars.length - 1]!.to });
        // Leet symbols at the ends may be punctuation instead ("fuck!", "@$$!"): try them off, fewest first.
        let maxA = 0;
        while (maxA < chars.length && isLeetSymbol(chars[maxA]!.c)) maxA++;
        let minB = chars.length;
        while (minB > 0 && isLeetSymbol(chars[minB - 1]!.c)) minB--;
        const trims: [number, number][] = [];
        for (let a = 0; a <= maxA; a++) {
          for (let b = chars.length; b >= Math.max(minB, a + 2); b--) {
            if (a > 0 || b < chars.length) trims.push([a, b]);
          }
        }
        trims.sort((x, y) => x[0] + (chars.length - x[1]) - (y[0] + (chars.length - y[1])));
        for (const [a, b] of trims) {
          const inner = chars.slice(a, b);
          candidates.push({ text: readAll(inner), start: inner[0]!.from, end: inner[inner.length - 1]!.to });
        }
        // "f*u*c*k": the asterisks only split the letters.
        const unstarred = candidates[0]!.text.replace(/\*/g, "");
        if (unstarred !== candidates[0]!.text && unstarred.length >= 3) {
          candidates.push({ ...candidates[0]!, text: unstarred });
        }
      }
      const gapText = gap.map((n) => n.c).join("");
      tokens.push({
        text: candidates[0]?.text ?? "",
        start: chars[0]!.from,
        end: chars[chars.length - 1]!.to,
        splitFromLast: gapText.length >= 1 && gapText.length <= 2 && [...gapText].every(isSplitter),
        spaceFromLast: gapText.length >= 1 && /^[\s_-]+$/.test(gapText),
        candidates,
      });
      gap = [];
      i = j;
    }
    // Digits-only words take part in nothing.
    return tokens.map((token) => (token.candidates.length ? token : { ...token, text: "" }));
  }

  /** The line with every caught word masked where the player typed it. */
  scan(text: string): WordScan {
    const hits = this.hits(text);
    if (hits.length === 0) return { shown: text, hits };
    let shown = "";
    let at = 0;
    for (const { start, end } of hits) {
      if (start < at) continue;
      shown += text.slice(at, start) + text.slice(start, end).replace(/\S/gu, "*");
      at = end;
    }
    shown += text.slice(at);
    return { shown, hits };
  }
}
