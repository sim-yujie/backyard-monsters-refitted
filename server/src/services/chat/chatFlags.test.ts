import { describe, expect, test } from "bun:test";

import { makeWordFilter, NOT_FLAGGED_WORDS, SLUR_WORDS } from "./badWords.js";
import { checkLine, FLAG_WINDOW_MS, FLAGS_PER_WINDOW, FlagLimiter } from "./chatFlags.js";

/**
 * Automatic chat flags: which lines flag, how serious, and how many a player
 * can raise. The masking players see is exactly the filter's, as before.
 */

describe("checkLine", () => {
  const filter = makeWordFilter({});

  test("a clean line does not flag and is shown as said", () => {
    for (const line of ["hello everyone", "anyone want to trade?", "salamat po", "I will puke if I lose again"]) {
      expect(checkLine(filter, line)).toEqual({ shown: line, words: [], severity: null });
    }
  });

  test("swearing flags as a swear, with the words it hit", () => {
    expect(checkLine(filter, "you are a bitch")).toEqual({ shown: "you are a *****", words: ["bitch"], severity: "swear" });
    expect(checkLine(filter, "GAGO ka, Fuck off")).toMatchObject({ words: ["gago", "fuck"], severity: "swear" });
  });

  test("a slur flags as a slur, even next to plain swearing", () => {
    expect(checkLine(filter, "shut up faggot")).toMatchObject({ words: ["faggot"], severity: "slur" });
    expect(checkLine(filter, "fuck you retard")).toMatchObject({ words: ["fuck", "retard"], severity: "slur" });
  });

  test("players see exactly what the filter shows", () => {
    for (const line of ["you are a bitch", "putang ina mo", "hell yeah", "what the hell, faggot", "a_b fuck"]) {
      expect([line, checkLine(filter, line).shown]).toEqual([line, filter.clean(line)]);
    }
  });

  test("words that are also ordinary English are still masked but never flag", () => {
    for (const line of ["what the hell", "damn that was close", "my pawn died", "nice balls of goo"]) {
      const check = checkLine(filter, line);
      expect([line, check.severity]).toEqual([line, null]);
      expect(check.shown).not.toBe(line);
    }
  });

  test("every slur is masked and flags as a slur", () => {
    for (const word of SLUR_WORDS) {
      const check = checkLine(filter, `you ${word}`);
      expect([word, check.severity, check.shown.includes(word)]).toEqual([word, "slur", false]);
    }
  });

  test("no word is both a slur and ordinary", () => {
    const slurs = new Set(SLUR_WORDS);
    expect(NOT_FLAGGED_WORDS.filter((word) => slurs.has(word))).toEqual([]);
  });

  test("the owner's extra words flag as swears", () => {
    expect(checkLine(makeWordFilter({ CHAT_EXTRA_BAD_WORDS: "zorp" }), "zorp you")).toMatchObject({
      shown: "**** you",
      words: ["zorp"],
      severity: "swear",
    });
  });
});

describe("FlagLimiter", () => {
  test(`stores at most ${FLAGS_PER_WINDOW} flags per player in the window, then again once it has passed`, () => {
    const limiter = new FlagLimiter();
    const t0 = 1_000_000;
    const taken = Array.from({ length: FLAGS_PER_WINDOW + 3 }, (_, i) => limiter.take(7, t0 + i * 1000));
    expect(taken.filter(Boolean).length).toBe(FLAGS_PER_WINDOW);
    expect(taken.slice(FLAGS_PER_WINDOW)).toEqual([false, false, false]);

    // Another player is counted on their own.
    expect(limiter.take(8, t0 + 10_000)).toBe(true);

    // Once the first flags fall out of the window, more may go in.
    expect(limiter.take(7, t0 + FLAG_WINDOW_MS + 500)).toBe(true);
  });

  test("a small window and limit for the sake of the test", () => {
    const limiter = new FlagLimiter(100, 1);
    expect([limiter.take(1, 0), limiter.take(1, 50), limiter.take(1, 101)]).toEqual([true, false, true]);
  });
});
