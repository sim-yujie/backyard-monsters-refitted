/**
 * An email shortened for the logs (issue #321): the first two letters of the
 * name and the domain, so a line can be matched to a player who writes in
 * without the logs holding everyone's address.
 *
 * @param {string} email - The email.
 * @returns {string} For example `pl***@example.com`.
 */
export const maskEmail = (email: string): string => {
  const at = email.lastIndexOf("@");
  if (at < 0) return "***";
  const name = email.slice(0, at);
  return `${name.slice(0, Math.min(2, name.length - 1))}***${email.slice(at)}`;
};
