/**
 * The user fields of a seeded dev account (`db:seed:mr2`, `db:seed:mr3`,
 * `db:seed:alliances`).
 *
 * A seeded account never asks for the DEV_SANDBOX maxed yard, whatever
 * `server/.env` says: the seeded saves are Map Room 1 neighbour candidates, so
 * a seed run must give them the starter yard (bot neighbours decision 16, #234).
 *
 * @param {string} uniqueId - The account's username, also the local part of its email.
 * @param {string} passwordHash - The bcrypt hash of the account's password.
 * @returns {object} The fields to `em.create(User, ...)` with.
 */
export const seedUserData = (uniqueId: string, passwordHash: string) => ({
  username: uniqueId,
  email: `${uniqueId}@test.com`,
  password: passwordHash,
  sandbox_start: false,
});
