import { Filter as BadWords } from "bad-words";

import { AccountMessage } from "../../game-rules/account/accountRules.js";
import { invalidAccountErr } from "../../errors/errors.js";

const filter = new BadWords();

/**
 * Whether a username holds a word the chat and alliance-name filter refuses
 * (issue #213). That filter matches whole words, and a username joins its
 * words with underscores, digits or a case change ("rude_word", "RudeWord",
 * "rude2"), so those are turned into spaces first. Letters run together with
 * no break are left alone, which keeps it from refusing ordinary names that
 * happen to hold a short word's letters.
 *
 * @param {string} username - A username that passed the account rules
 * @returns {boolean} True when the filter would refuse it
 */
export const isProfaneUsername = (username: string): boolean =>
  filter.isProfane(username.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_0-9]+/g, " "));

/**
 * Refuses a username the word filter catches, on sign-up and on rename. The
 * reserved names (admin, moderator...) are the shared account rules' part and
 * are refused by the schema before this runs.
 *
 * @param {string} username - A username that passed the account rules
 * @throws {ClientSafeError} A 400 on the username field when the filter catches it
 */
export const assertUsernameAllowed = (username: string): void => {
  if (isProfaneUsername(username)) throw invalidAccountErr(AccountMessage.usernameBlocked, "username");
};
