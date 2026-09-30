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
} as const;

/** Why a username would be refused, or null when the server would take it. */
export const usernameProblem = (raw: string): string | null => {
  const username = raw.trim();
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    return AccountMessage.usernameLength;
  }
  if (!USERNAME_PATTERN.test(username)) return AccountMessage.usernameCharset;
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
