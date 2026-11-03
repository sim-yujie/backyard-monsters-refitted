import { describe, expect, test } from "bun:test";
import { extraBadWords, FILIPINO_BAD_WORDS, makeWordFilter } from "./badWords.js";

describe("word filter", () => {
  const filter = makeWordFilter({});

  test("masks Filipino swear words, in any case, alone or in a sentence", () => {
    expect(filter.clean("putang ina mo")).toBe("****** ina mo");
    expect(filter.clean("Tangina naman")).toBe("******* naman");
    expect(filter.clean("GAGO ka")).toBe("**** ka");
  });

  test("still masks the English list", () => {
    expect(filter.isProfane("you are a bitch")).toBe(true);
  });

  test("leaves ordinary Tagalog alone", () => {
    for (const line of ["ina ko", "tara laro tayo", "salamat po", "bobo ko sa math", "tanga ko talaga", "kain na"]) {
      expect([line, filter.clean(line)]).toEqual([line, line]);
    }
  });

  test("every listed word is masked", () => {
    for (const word of FILIPINO_BAD_WORDS) expect([word, filter.isProfane(word)]).toEqual([word, true]);
  });

  test("extra words come from CHAT_EXTRA_BAD_WORDS, comma separated", () => {
    expect(extraBadWords({ CHAT_EXTRA_BAD_WORDS: " Foo, ,bar " })).toEqual(["foo", "bar"]);
    expect(extraBadWords({})).toEqual([]);
    expect(makeWordFilter({ CHAT_EXTRA_BAD_WORDS: "zorp" }).clean("zorp you")).toBe("**** you");
  });
});
