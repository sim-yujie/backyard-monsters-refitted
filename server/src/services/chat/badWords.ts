import { Filter as BadWords } from "bad-words";

/**
 * Filipino (Tagalog) swear words the word filter masks on top of the
 * library's English list (owner, 3 Nov 2026: "philippines first", after a
 * Tagalog swear word went through Global chat).
 *
 * Only clear swear words and their usual run-together spellings: words that
 * are also ordinary Tagalog ("ina", mother; "tae", "tanga", "bobo", "suso")
 * stay out, and so do words that are also ordinary English ("puke"), so
 * normal talk is never masked. The filter matches whole words,
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
  "kantot",
  "kantutan",
  "jakol",
  "burat",
  "bayag",
];

/**
 * Hate words about race, religion, sexuality, gender or disability. The
 * filter masks them like any other bad word; the dashboard's automatic chat
 * flags (`chatFlags.ts`) mark a line with one of them as a slur, more serious
 * than plain swearing. Lower case; most are on the library's list already,
 * the rest are added to the filter here. Words that are also ordinary
 * English (or Tagalog) stay out.
 */
export const SLUR_WORDS: readonly string[] = [
  // Race and origin.
  "nigger", "niggers", "nigga", "niggas", "niggaz", "niggah", "nigg3r", "nigg4h", "n1gga", "n1gger", "n1gr",
  "niiger", "niigr", "nigur", "sandnigger",
  "chink", "chinks", "gook", "gooks", "g00k", "spic", "spics", "wetback", "wetbacks", "beaner", "beaners",
  "coon", "coons", "jap", "japs", "paki", "pakis", "pakie", "paky", "packi", "packie", "packy",
  "honkey", "honky", "injun", "wop", "w0p", "dego", "daygo", "polack", "polak", "polac",
  // Religion.
  "kike", "kikes", "raghead", "ragheads", "towelhead", "towelheads",
  // Sexuality and gender.
  "faggot", "faggots", "fagot", "fagots", "fag", "fags", "fagz", "faggs", "faggit", "faggitt", "fagg0t", "fagg1t",
  "fag1t", "faget", "fagit", "faig", "faigs", "feg", "dyke", "dykes", "lesbo", "homo", "gaylord", "tranny",
  "trannies", "shemale", "heshe", "fudgepacker",
  // Disability.
  "retard", "retards", "retarded", "tard", "spaz", "spac",
];

/**
 * Words on the filter's list that are also ordinary English, or name a body
 * part or a thing rather than insult anyone ("hell", "damn", "pawn", "balls").
 * The filter still masks them, as before; they never raise an automatic chat
 * flag on their own, so normal talk does not fill the dashboard.
 */
export const NOT_FLAGGED_WORDS: readonly string[] = [
  "hell", "hells", "damn", "god", "bloody", "butt", "crap", "poop", "fart", "turd", "bum", "sex", "sexy", "lust",
  "lusting", "horny", "porn", "porno", "pron", "p0rn", "xxx", "xrated", "smut", "balls", "screw", "screwing", "pawn",
  "willy", "willies", "nob", "knob", "knobs", "knobz", "muff", "bugger", "fanny", "snatch", "cox", "wang", "dink",
  "dinks", "flange", "boob", "boobs", "breasts", "piss", "pissed", "pisses", "pissing", "tit", "tits", "teets",
  "nazi", "nazis", "kraut", "sadist", "masochist", "rectum", "anus", "penis", "vagina", "vulva", "labia", "semen",
  "testicle", "testical", "scrotum", "clitoris", "enema", "orgasm", "orgasms", "feces", "ejaculate", "shag",
  "pecker", "doggin", "dogging", "kondum", "kondums", "viagra", "cyalis", "v14gra", "v1gra", "slag", "spunk",
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
 * names): the library's English list, the Filipino list, the slurs and the
 * extra words.
 */
export const makeWordFilter = (env: Record<string, string | undefined> = process.env): BadWords => {
  const filter = new BadWords();
  filter.addWords(...FILIPINO_BAD_WORDS, ...SLUR_WORDS, ...extraBadWords(env));
  return filter;
};
