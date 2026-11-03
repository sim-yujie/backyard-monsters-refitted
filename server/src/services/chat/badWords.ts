import { Filter as BadWords } from "bad-words";

/**
 * Filipino (Tagalog) swear words the word filter masks on top of the
 * library's English list (owner, 3 Nov 2026: "philippines first", after a
 * Tagalog swear word went through Global chat).
 *
 * Only clear swear words and their usual run-together spellings: words that
 * are also ordinary Tagalog ("ina", mother; "tae", "tanga", "bobo", "suso")
 * stay out, so normal talk is never masked. The filter matches whole words,
 * so "putang ina" is caught by "putang" alone.
 */
export const FILIPINO_BAD_WORDS: readonly string[] = [
  "putangina",
  "putanginamo",
  "putang",
  "puta",
  "potangina",
  "potaena",
  "putaena",
  "tangina",
  "tanginamo",
  "tangena",
  "kingina",
  "kinginamo",
  "ampota",
  "amputa",
  "punyeta",
  "pakyu",
  "pakshet",
  "pakingshet",
  "gago",
  "gaga",
  "ulol",
  "ulul",
  "tarantado",
  "tarantada",
  "kupal",
  "hinayupak",
  "hindot",
  "pokpok",
  "puke",
  "kantot",
  "kantutan",
  "jakol",
  "burat",
  "bayag",
];

/**
 * Extra words the owner adds without a release: `CHAT_EXTRA_BAD_WORDS`,
 * comma separated, read when the server starts.
 *
 * @param {Record<string, string | undefined>} env - Where to read it from.
 * @returns {string[]} The extra words, lower case, blanks dropped.
 */
export const extraBadWords = (env: Record<string, string | undefined> = process.env): string[] =>
  (env.CHAT_EXTRA_BAD_WORDS ?? "")
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0);

/**
 * The game's word filter (chat, mail, alliance text, player and champion
 * names): the library's English list, the Filipino list and the extra words.
 */
export const makeWordFilter = (env: Record<string, string | undefined> = process.env): BadWords => {
  const filter = new BadWords();
  filter.addWords(...FILIPINO_BAD_WORDS, ...extraBadWords(env));
  return filter;
};
