import { describe, expect, test } from "bun:test";

import { makeWordFilter } from "./badWords.js";
import { checkLine } from "./chatFlags.js";
import { MAX_DISGUISED_LENGTH, WordMatcher } from "./wordMatch.js";

/**
 * The disguised-word matcher behind the word filter: what it must catch
 * (spellings meant to get past a plain word list) and what it must leave
 * alone (ordinary English, Tagalog and Taglish chat). The lists are counted
 * in the test names, so a report can quote them.
 */

const filter = makeWordFilter({});

/** A line, and the listed word it must be caught as. */
const DISGUISED: readonly [string, string][] = [
  // Leetspeak and look-alike symbols.
  ["sh1t", "shit"],
  ["$h!t happens", "shit"],
  ["you @ss", "ass"],
  ["kiss my @$$", "ass"],
  ["a55hole", "asshole"],
  ["fvck this", "fuck"],
  ["cvnt", "cunt"],
  ["b1tch please", "bitch"],
  ["b!tch", "bitch"],
  ["d1ck", "dick"],
  ["wh0re", "whore"],
  ["n1gger", "nigger"],
  ["f4ggot", "faggot"],
  ["r3tard", "retard"],
  ["g4go ka", "gago"],
  ["ul0l", "ulol"],
  ["put4ng ina mo", "putang"],
  ["5h1t", "shit"],
  // Stretched letters.
  ["fuuuck", "fuck"],
  ["fuuuuuuuck you", "fuck"],
  ["shiiiit", "shit"],
  ["puuuta", "puta"],
  ["gaaaago", "gago"],
  ["biiiitch", "bitch"],
  // Letters split by spaces, dots, dashes, underscores or asterisks.
  ["f u c k", "fuck"],
  ["f.u.c.k off", "fuck"],
  ["f-u-c-k", "fuck"],
  ["f_u_c_k", "fuck"],
  ["f*u*c*k", "fuck"],
  ["s h i t", "shit"],
  ["g a g o", "gago"],
  ["p.u.t.a", "puta"],
  // Asterisks for letters.
  ["f*ck you", "fuck"],
  ["sh*t", "shit"],
  ["b*tch", "bitch"],
  // Accents, zero-width characters, fullwidth letters.
  ["fück", "fuck"],
  ["shït", "shit"],
  ["fu​ck", "fuck"],
  ["sh‍it", "shit"],
  ["ｆｕｃｋ", "fuck"],
  // Cyrillic and Greek look-alike letters.
  ["fuсk", "fuck"],
  ["аss", "ass"],
  ["biтch", "bitch"],
  ["shιt", "shit"],
  ["gаgo", "gago"],
  // Joined into longer words, and with punctuation.
  ["putanginamoka", "putangina"],
  ["tanginamo ka", "tanginamo"],
  ["fuckface", "fuck"],
  ["fuck!", "fuck"],
  ["Tangina, ang hirap", "tangina"],
  // Taglish.
  ["ang g@go mo bro", "gago"],
  ["sh1t ang lakas ng attack", "shit"],
  ["pakyu talaga", "pakyu"],
];

/** Ordinary lines that must be left exactly as typed. */
const ORDINARY: readonly string[] = [
  // English.
  "hello everyone",
  "anyone want to trade?",
  "this class is classic",
  "we need to assess the base",
  "I read Dickens at school",
  "my friend is from Pakistan",
  "shiitake mushrooms are tasty",
  "I live near Scunthorpe",
  "noob",
  "nooob mistake lol",
  "I have 455 points",
  "$$$ for the win",
  "I will puke if I lose again",
  "he's hit by a tower",
  "pass me the goo",
  "nice bass drop",
  "my pawn died",
  "oh my god that was close",
  "the assassin got me",
  "cocktail party tonight",
  "japan is far",
  "the analysis is done",
  "good game, well played",
  "lol 100% done",
  "brb 5 min",
  "a b c d",
  "Hi!!! how are you",
  "is it 10:30 already?",
  "spicy food",
  "the therapist said rest",
  // Tagalog.
  "salamat po",
  "tara laro tayo",
  "kain na",
  "pupunta ako bukas",
  "katangian ng base mo",
  "pakinggan mo ako",
  "masarap ang puto",
  "pula ang kulay",
  "may suka ba kayo",
  "ina ko",
  "bobo ko sa math",
  "tanga ko talaga",
  "putol ang kuryente",
  "magandang umaga sa inyo",
  "ang galing mo",
  // Taglish.
  "nice attack pare, ang lakas",
  "wait lang, mag upgrade muna ako",
  "sino may extra goo, pahingi naman",
  "grabe yung tower defense mo bro",
  "puto and coffee for breakfast",
  "ang daming monsters sa map ngayon",
];

describe("disguised words", () => {
  test(`catches all ${DISGUISED.length} disguised spellings and masks what the player typed`, () => {
    const missed: string[] = [];
    for (const [line, word] of DISGUISED) {
      const { shown, hits } = filter.scan(line);
      const hit = hits.find((h) => h.word === word);
      if (!hit) {
        missed.push(`${line} -> ${hits.map((h) => h.word).join(",") || "nothing"}`);
        continue;
      }
      // The characters that made the word are masked, the rest of the line is not.
      expect([line, shown.slice(0, hit.start)]).toEqual([line, line.slice(0, hit.start)]);
      expect([line, /^[*\s]+$/u.test(shown.slice(hit.start, hit.end))]).toEqual([line, true]);
      expect([line, shown.length]).toEqual([line, line.length]);
    }
    expect(missed).toEqual([]);
    expect(DISGUISED.length).toBeGreaterThanOrEqual(40);
  });

  test("masks the original characters exactly", () => {
    expect(filter.clean("you f.u.c.k")).toBe("you *******");
    expect(filter.clean("f u c k you")).toBe("* * * * you");
    expect(filter.clean("fu​ck off")).toBe("*****" + " off");
    expect(filter.clean("fuсk")).toBe("****");
    expect(filter.clean("fuck!")).toBe("****!");
    expect(filter.clean("kiss my @$$!")).toBe("kiss my ***!");
  });

  test("marks disguised spellings, and plain words as not disguised", () => {
    expect(filter.scan("fvck").hits).toMatchObject([{ word: "fuck", disguised: true }]);
    expect(filter.scan("FUCK").hits).toMatchObject([{ word: "fuck", disguised: false }]);
    expect(filter.scan("gago ka").hits).toMatchObject([{ word: "gago", disguised: false }]);
  });

  test("disguised lines flag on the dashboard with the rule disguised", () => {
    for (const [line] of DISGUISED) {
      const check = checkLine(filter, line);
      expect([line, check.severity !== null]).toEqual([line, true]);
    }
  });
});

describe("ordinary chat", () => {
  test(`leaves all ${ORDINARY.length} ordinary English, Tagalog and Taglish lines alone`, () => {
    const caught = ORDINARY.filter((line) => filter.clean(line) !== line).map(
      (line) => `${line} -> ${filter.scan(line).hits.map((h) => h.word).join(",")}`,
    );
    expect(caught).toEqual([]);
    expect(ORDINARY.length).toBeGreaterThanOrEqual(40);
  });

  test("Russian and Greek written as such are left alone", () => {
    for (const line of ["привет всем", "спасибо", "καλημέρα", "ευχαριστώ"]) expect(filter.clean(line)).toBe(line);
  });
});

describe("WordMatcher", () => {
  test("an allowed word is never caught, however it is spelled", () => {
    const matcher = new WordMatcher(["zorp", "blarg"], { allowed: ["blarg"] });
    expect(matcher.scan("zorp blarg bl4rg").shown).toBe("**** blarg bl4rg");
  });

  test("a doubled letter is not a stretched one", () => {
    const matcher = new WordMatcher(["nob"]);
    expect(matcher.hits("noob")).toEqual([]);
    expect(matcher.hits("nooob").length).toBe(1);
  });

  test("two-word phrases on the list are caught across the space", () => {
    const matcher = new WordMatcher(["blow job"]);
    expect(matcher.scan("nice blow job").shown).toBe("nice **** ***");
  });
});

describe("cost per line (chat lines are player-sent)", () => {
  /** The fastest of a few runs, in ms, after one warm-up run. */
  const timed = (line: string) => {
    filter.scan(line);
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      filter.scan(line);
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };

  test("a 2,000-character line of mixed symbols and letters is checked in under 20 ms", () => {
    const lines = [
      // One long run of letters and leet symbols: a single word to the tokenizer.
      "@$!|+".repeat(200) + "fuck".repeat(250),
      // Mixed symbols, letters and splitters.
      "f$u@c!k*-. a ".repeat(154).slice(0, 2000),
      // Single letters split apart, the split-letter pass's worst case.
      "f ".repeat(1000),
      // Stretched letters and asterisks.
      ("f" + "u".repeat(30) + "*ck! ").repeat(60).slice(0, 2000),
    ];
    for (const line of lines) {
      expect(line.length).toBeGreaterThanOrEqual(1990);
      const ms = timed(line);
      expect([line.slice(0, 20), ms < 20]).toEqual([line.slice(0, 20), true]);
    }
  });

  test(`padding a word past ${MAX_DISGUISED_LENGTH} characters does not get it through`, () => {
    const pad = "x".repeat(MAX_DISGUISED_LENGTH);
    const cases: [string, string][] = [
      // Padded with letters: the stem is found inside, disguised or not.
      [`${pad}sh1t`, "shit"],
      [`${pad}fvck`, "fuck"],
      [`${pad}fuuuck${pad}`, "fuck"],
      [`${pad}b!tch`, "bitch"],
      // Padded with symbols: the word between them is read as a word.
      [`${"$".repeat(MAX_DISGUISED_LENGTH)}fuck${"!".repeat(5)}`, "fuck"],
      [`${"!".repeat(MAX_DISGUISED_LENGTH)}g4go`, "gago"],
      [`${"+".repeat(MAX_DISGUISED_LENGTH)}@$$`, "ass"],
      [`${"|".repeat(MAX_DISGUISED_LENGTH)}g@go${"|".repeat(MAX_DISGUISED_LENGTH)}`, "gago"],
    ];
    for (const [line, word] of cases) {
      const { shown, hits } = filter.scan(line);
      expect([line, hits.map((h) => h.word)]).toEqual([line, [word]]);
      const hit = hits[0]!;
      // Only the word is masked, not the padding.
      expect([line, shown.slice(hit.start, hit.end)]).toEqual([line, "*".repeat(hit.end - hit.start)]);
      expect([line, shown.slice(0, hit.start)]).toEqual([line, line.slice(0, hit.start)]);
    }
    expect(filter.clean(`${"$".repeat(MAX_DISGUISED_LENGTH)}fuck${"!".repeat(5)}`)).toBe(
      `${"$".repeat(MAX_DISGUISED_LENGTH)}****${"!".repeat(5)}`,
    );
  });

  test(`a run of more than ${MAX_DISGUISED_LENGTH} split letters still has its stems caught`, () => {
    const lead = "a ".repeat(MAX_DISGUISED_LENGTH + 10);
    expect(filter.clean(`${lead}f u c k`)).toBe(`${lead}* * * *`);
    expect(filter.clean(`${lead}s.h.i.t`)).toBe(`${lead}*******`);
    expect(filter.scan(`${lead}f u c k ${lead}`).hits.map((h) => h.word)).toEqual(["fuck"]);
  });

  test("long ordinary words and runs are left alone", () => {
    for (const line of ["ha".repeat(40), "lo".repeat(30) + "l!!!", "a ".repeat(60), "x".repeat(100), "1234567890".repeat(6)]) {
      expect(filter.clean(line)).toBe(line);
    }
  });
});
