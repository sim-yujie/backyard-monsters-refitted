import { usernameProblem } from "../../game-rules/account/accountRules.js";
import type { Rng } from "../../game-rules/combat/rng.js";
import { isProfaneUsername } from "../user/usernameFilter.js";

/**
 * Bot usernames (issue #239, `docs/design/bot-neighbours.md` §4.1, decision
 * 3): names in the shapes real players pick, so nothing in a name says "bot".
 *
 * Several styles, each weighted ({@link NAME_STYLES}): "MossyGoblin",
 * "kai_builds", "Pebble77", "xXSnapperXx", "sneakyfrog", "Marco1996",
 * "lily_04", "Big_Toad". Every name is one a player could sign up with: the
 * account rules' length, characters and reserved words
 * (`game-rules/account/accountRules.ts`) and the sign-up word filter
 * (`services/user/usernameFilter.ts`); a name that fails is drawn again.
 * Uniqueness against `user.username` is the factory's (`factory.ts`), since it
 * needs the database.
 */

/** Adjectives, for "MossyGoblin" and "sneakyfrog". */
const ADJECTIVES = [
  "mossy", "sneaky", "grumpy", "fuzzy", "lucky", "spooky", "rusty", "muddy", "salty", "sleepy",
  "angry", "happy", "jolly", "crazy", "silly", "tiny", "big", "wild", "dark", "swift",
  "brave", "bold", "shady", "stinky", "slimy", "crispy", "frosty", "fiery", "golden", "iron",
  "stony", "lazy", "loud", "quiet", "red", "blue", "green", "purple", "cosmic", "mighty",
  "rapid", "toxic", "hairy", "bouncy", "cranky", "dizzy", "funky", "gloomy", "grim", "hungry",
] as const;

/** Nouns: backyard things, critters and the game's own words. */
const NOUNS = [
  "goblin", "frog", "toad", "snail", "slug", "beetle", "badger", "otter", "fox", "wolf",
  "bear", "moose", "gecko", "newt", "mole", "worm", "pebble", "twig", "putty", "goo",
  "snapper", "shiner", "pokey", "bandito", "octo", "eyera", "zafreeti", "brain", "ghost", "golem",
  "troll", "ogre", "dragon", "knight", "pirate", "ninja", "wizard", "hunter", "raider", "ranger",
  "tank", "rocket", "cannon", "tower", "fort", "yard", "monster", "mutant", "critter", "gnome",
  "mushroom", "acorn", "pumpkin", "turnip", "pickle", "noodle", "waffle", "taco", "nacho", "potato",
] as const;

/** First names, for "kai_builds" and "Marco1996". */
const FIRST_NAMES = [
  "kai", "sam", "alex", "jordan", "max", "leo", "mia", "zoe", "lily", "emma",
  "noah", "liam", "ben", "tom", "jake", "luke", "ryan", "dan", "matt", "nick",
  "chris", "josh", "tyler", "kyle", "sean", "owen", "evan", "ella", "ava", "chloe",
  "sara", "anna", "nina", "jess", "kate", "amy", "rosa", "marco", "luca", "hugo",
  "felix", "oscar", "ivan", "pablo", "diego", "jonas", "lars", "finn", "theo", "nico",
] as const;

/** What a name gets joined to in "kai_builds". */
const VERBS = [
  "builds", "rocks", "plays", "wins", "smash", "rules", "raids", "digs", "farms", "games",
  "attacks", "loots", "camps", "hatch", "stomps", "grows", "crafts", "zaps", "roams", "bashes",
] as const;

/** Titles for "goblinking". */
const TITLES = ["king", "lord", "boss", "master", "chief", "queen", "pro", "guy", "man", "girl"] as const;

type Style = (rng: Rng) => string;

const pick = <T>(rng: Rng, items: readonly T[]): T => items[rng.int(items.length)]!;

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** A year a player might be born in or think of: 1985-2012, written whole or as two digits. */
const year = (rng: Rng): string => {
  const full = 1985 + rng.int(28);
  return rng.float() < 0.5 ? String(full) : String(full).slice(2);
};

/** One to three digits, as players tack on: "7", "77", "420"... */
const digits = (rng: Rng): string => {
  const length = 1 + rng.int(3);
  let out = String(1 + rng.int(9));
  while (out.length < length) out += String(rng.int(10));
  return out;
};

/** A word from either list, once in a while the noun list's. */
const word = (rng: Rng): string => (rng.float() < 0.7 ? pick(rng, NOUNS) : pick(rng, ADJECTIVES));

/**
 * The name shapes and their weights `[PLACEHOLDER]`: roughly how often each
 * turns up in a games' player list.
 */
export const NAME_STYLES: readonly { name: string; weight: number; make: Style }[] = [
  // "MossyGoblin"
  { name: "camelPair", weight: 22, make: (rng) => capital(pick(rng, ADJECTIVES)) + capital(pick(rng, NOUNS)) },
  // "sneakyfrog"
  { name: "lowerPair", weight: 12, make: (rng) => pick(rng, ADJECTIVES) + pick(rng, NOUNS) },
  // "kai_builds"
  { name: "nameVerb", weight: 8, make: (rng) => `${pick(rng, FIRST_NAMES)}_${pick(rng, VERBS)}` },
  // "Pebble77", "goblin420"
  {
    name: "wordDigits",
    weight: 18,
    make: (rng) => {
      const base = word(rng);
      return (rng.float() < 0.5 ? capital(base) : base) + digits(rng);
    },
  },
  // "Marco1996", "lily_04"
  {
    name: "nameYear",
    weight: 16,
    make: (rng) => {
      const name = pick(rng, FIRST_NAMES);
      const cased = rng.float() < 0.4 ? capital(name) : name;
      return cased + (rng.float() < 0.3 ? "_" : "") + year(rng);
    },
  },
  // "xXSnapperXx"
  { name: "xx", weight: 3, make: (rng) => `xX${capital(pick(rng, NOUNS))}Xx` },
  // "Big_Toad", "mossy_goblin"
  {
    name: "underscorePair",
    weight: 10,
    make: (rng) => {
      const [a, b] = [pick(rng, ADJECTIVES), pick(rng, NOUNS)];
      return rng.float() < 0.5 ? `${capital(a)}_${capital(b)}` : `${a}_${b}`;
    },
  },
  // "TheGoblin", "goblinking"
  {
    name: "titled",
    weight: 9,
    make: (rng) => {
      const noun = pick(rng, NOUNS);
      return rng.float() < 0.3 ? `The${capital(noun)}` : `${noun}${pick(rng, TITLES)}`;
    },
  },
];

const TOTAL_WEIGHT = NAME_STYLES.reduce((sum, style) => sum + style.weight, 0);

/**
 * Whether a player could sign up with `name` (length, characters, reserved
 * words, word filter), and it does not say "bot" anywhere.
 */
export const isUsableName = (name: string): boolean =>
  usernameProblem(name) === null && !isProfaneUsername(name) && !/bot/i.test(name);

/** How many draws {@link botName} makes before giving up on a usable name. */
const MAX_DRAWS = 200;

/**
 * One username in a real player's style, usable at sign-up. Not checked for
 * uniqueness (see the file comment).
 *
 * @param {Rng} rng - The draw
 * @returns {string} The name
 */
export const botName = (rng: Rng): string => {
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    let roll = rng.int(TOTAL_WEIGHT);
    const style = NAME_STYLES.find((candidate) => (roll -= candidate.weight) < 0)!;
    const name = style.make(rng);
    if (isUsableName(name)) return name;
  }
  throw new Error("No usable bot name after many draws");
};
