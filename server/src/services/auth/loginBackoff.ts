import { redis } from "../../server.js";

/**
 * Per-account sign-in back-off (security audit 2026-10-29, L2).
 *
 * The per-IP `loginLimiter` caps how fast one address may try. This counts
 * wrong passwords per email and address together, for every email whether or
 * not it has an account, so the answer says nothing about which emails do.
 * The first {@link FREE_TRIES} are free; each one after that pauses that email
 * from that address for twice as long as the last, from
 * {@link FIRST_PAUSE_SECONDS} up to {@link MAX_PAUSE_SECONDS}. A try during a
 * pause is refused unread and not counted, and the count is forgotten
 * {@link FORGET_AFTER_SECONDS} after the last wrong password, at once on a
 * right one from that address, and for every address on a password reset.
 *
 * Keyed on the address too because anyone can type someone else's email: a
 * stranger's wrong passwords pause the email only on the stranger's own
 * connection, never the player's. A guesser is slowed to about 100 tries a
 * day per address, and the per-IP limit caps how many emails one address
 * may try.
 */
export const FREE_TRIES = 5;
export const FIRST_PAUSE_SECONDS = 30;
export const MAX_PAUSE_SECONDS = 15 * 60;
export const FORGET_AFTER_SECONDS = 15 * 60;

const failuresKey = (email: string, ip: string) => `login-failures:${email}|${ip}`;
const pauseKey = (email: string, ip: string) => `login-pause:${email}|${ip}`;
/** The addresses with wrong passwords for the email, so a reset can clear them all. */
const addressesKey = (email: string) => `login-failure-ips:${email}`;

/** The pause after the given number of wrong passwords in a row, in seconds (0 for none). */
export const pauseAfter = (failures: number): number =>
  failures < FREE_TRIES ? 0 : Math.min(FIRST_PAUSE_SECONDS * 2 ** (failures - FREE_TRIES), MAX_PAUSE_SECONDS);

/**
 * How long the email's sign-in from this address is paused for, in seconds (0 when it is not).
 *
 * @param email - The email as it is looked up (trimmed and lowercased).
 * @param ip - The address signing in.
 */
export const loginPausedFor = async (email: string, ip: string): Promise<number> => {
  const ttl = await redis.ttl(pauseKey(email, ip));
  return ttl > 0 ? ttl : 0;
};

/**
 * Counts a wrong password for the email from this address and starts its pause, if it earned one.
 *
 * @param email - The email as it is looked up.
 * @param ip - The address signing in.
 * @returns The pause started, in seconds (0 for none).
 */
export const recordLoginFailure = async (email: string, ip: string): Promise<number> => {
  const failures = await redis.incr(failuresKey(email, ip));
  await redis.expire(failuresKey(email, ip), FORGET_AFTER_SECONDS);
  await redis.sadd(addressesKey(email), ip);
  await redis.expire(addressesKey(email), FORGET_AFTER_SECONDS);

  const pause = pauseAfter(failures);
  if (pause > 0) await redis.set(pauseKey(email, ip), "1", "EX", String(pause));
  return pause;
};

/**
 * Forgets the email's wrong passwords from this address after a right one.
 *
 * @param email - The email as it is looked up.
 * @param ip - The address that signed in.
 */
export const clearLoginFailures = async (email: string, ip: string): Promise<void> => {
  await redis.del(failuresKey(email, ip), pauseKey(email, ip));
  await redis.srem(addressesKey(email), ip);
};

/**
 * Forgets the email's wrong passwords and pauses from every address, after a
 * password reset: whoever reset it holds the email.
 *
 * @param email - The account's email.
 */
export const clearAllLoginFailures = async (email: string): Promise<void> => {
  const addresses = await redis.smembers(addressesKey(email));
  await redis.del(
    ...addresses.flatMap((ip) => [failuresKey(email, ip), pauseKey(email, ip)]),
    addressesKey(email)
  );
};
