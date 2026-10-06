import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Password reset tokens are stored hashed (issue #321), so a copy of the
 * database (a backup, a leaked dump) cannot be used to reset accounts with a
 * reset pending. The token itself goes only into the email; it still expires
 * 20 minutes after it is made.
 */

/**
 * The form a reset token is stored in: its SHA-256, as hex.
 *
 * @param {string} token - The reset token sent in the email.
 * @returns {string} The value for `User.resetToken`.
 */
export const hashResetToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/**
 * Whether a token from a reset link is the one stored for the account. An
 * empty stored value (no reset pending) never matches.
 *
 * @param {string} stored - `User.resetToken`.
 * @param {string} token - The token from the reset link.
 * @returns {boolean} True only for the pending token.
 */
export const resetTokenMatches = (stored: string, token: string): boolean => {
  if (!stored) return false;
  const expected = Buffer.from(stored);
  const actual = Buffer.from(hashResetToken(token));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
