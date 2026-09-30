/**
 * The account rules, shared by the server and the web client (issue #213).
 *
 * The server's registration and rename schemas
 * (`server/src/schemas/AuthSchemas.ts`) build their zod checks from these
 * limits, patterns and messages, and the web client's sign-up form
 * (`web/src/app/scenes/signUpForm.ts`) checks the same things as the player
 * types, so the form can never pass a name, email or password the server then
 * refuses. It is kept as one source here and one byte-for-byte copy at
 * `server/src/game-rules/account/` by `web/tools/sync-combat-rules.mjs`, the
 * same way the combat and Map Room 2 rules are shared.
 *
 * The server trims a username, email and password before it checks them, so
 * every check here trims first too.
 *
 * Pure: no imports, no clock, nothing from either tree.
 */

export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 12;

/** Letters, digits and underscores only. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Words a username may not be, or hold as a word of its own, because they
 * would read as the game's own team speaking (issue #213): "admin",
 * "Admin_2", "the_mod" and "SupportBob" are refused, "modern" and
 * "supporter" are not. A username's words are the runs of letters between
 * underscores, digits and a lower-to-upper case change.
 */
export const RESERVED_USERNAME_WORDS: readonly string[] = [
  "admin",
  "admins",
  "administrator",
  "mod",
  "mods",
  "moderator",
  "moderators",
  "support",
  "system",
  "staff",
  "official",
  "owner",
  "dev",
  "devs",
  "developer",
  "gm",
  "gamemaster",
  "helpdesk",
  "root",
  "sysop",
  "bymr",
  "refitted",
  "kixeye",
  "null",
  "undefined",
];

/**
 * Letters a username may not hold anywhere, even run together with other
 * words ("bymrhelp", "TheModerator"): nobody but the game's own team has a
 * reason to use them.
 */
export const RESERVED_USERNAME_FRAGMENTS: readonly string[] = [
  "administrator",
  "moderator",
  "gamemaster",
  "official",
  "bymr",
  "kixeye",
];

/**
 * "admin" is refused at either end of a name run together ("adminbob",
 * "theadmin") but not in the middle, where it is a real word's letters
 * ("badminton").
 */
const RESERVED_USERNAME_ENDS = ["admin"];

export const PASSWORD_MIN_LENGTH = 8;

/** A password needs one character that is not a letter or a digit. */
export const PASSWORD_SYMBOL_PATTERN = /[^a-zA-Z0-9]/;

/**
 * What the server accepts as an email address: zod 4's own `z.regexes.email`,
 * spelled out so the browser tests the same thing without zod. The server
 * passes this pattern to `z.email()` explicitly, so a zod upgrade cannot move
 * one side without the other.
 */
export const EMAIL_PATTERN =
  // eslint-disable-next-line no-useless-escape -- spelled exactly as zod spells it, which a test checks
  /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

/** What a player is told for each broken rule, on the form and from the server. */
export const AccountMessage = {
  usernameLength: `Usernames are ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters long.`,
  usernameCharset: "Usernames can only use letters, numbers and underscores.",
  email: "Enter a valid email address.",
  passwordLength: `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`,
  passwordSymbol: "Passwords need at least one symbol, such as ! or #.",
  usernameReserved: "That name belongs to the game's own team. Please pick another one.",
  /** The server's word filter (the one chat and alliance names use); the form cannot check it. */
  usernameBlocked: "That username has a word we don't allow. Please pick another one.",
} as const;

/** The words of a username: its runs of letters, lower case. */
const usernameWords = (username: string): string[] =>
  username
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word !== "");

/**
 * Whether a username would read as the game's own team, by
 * {@link RESERVED_USERNAME_WORDS} and {@link RESERVED_USERNAME_FRAGMENTS}.
 * Case, underscores and digits do not get a name past it.
 */
export const isReservedUsername = (raw: string): boolean => {
  const username = raw.trim();
  if (usernameWords(username).some((word) => RESERVED_USERNAME_WORDS.includes(word))) return true;

  const letters = username.toLowerCase().replace(/[^a-z]/g, "");
  return (
    RESERVED_USERNAME_FRAGMENTS.some((fragment) => letters.includes(fragment)) ||
    RESERVED_USERNAME_ENDS.some((end) => letters.startsWith(end) || letters.endsWith(end))
  );
};

/** Why a username would be refused, or null when the server would take it. */
export const usernameProblem = (raw: string): string | null => {
  const username = raw.trim();
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    return AccountMessage.usernameLength;
  }
  if (!USERNAME_PATTERN.test(username)) return AccountMessage.usernameCharset;
  if (isReservedUsername(username)) return AccountMessage.usernameReserved;
  return null;
};

/**
 * Why an email address would be refused, or null when the server would take
 * it. The address is compared without its case: the server stores it lower
 * case.
 */
export const emailProblem = (raw: string): string | null =>
  EMAIL_PATTERN.test(raw.trim()) ? null : AccountMessage.email;

/** Why a new password would be refused, or null when the server would take it. */
export const passwordProblem = (raw: string): string | null => {
  const password = raw.trim();
  if (password.length < PASSWORD_MIN_LENGTH) return AccountMessage.passwordLength;
  if (!PASSWORD_SYMBOL_PATTERN.test(password)) return AccountMessage.passwordSymbol;
  return null;
};
