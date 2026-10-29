import { redis } from "../../server.js";

/**
 * Per-account sign-in back-off (security audit 2026-10-29, L2).
 *
 * The per-IP `loginLimiter` does not stop a guesser spread over many
 * addresses. This counts wrong passwords per email instead, for every email
 * whether or not it has an account, so the answer says nothing about which
 * emails do. The first {@link FREE_TRIES} are free; each one after that
 * pauses the email for twice as long as the last, from
 * {@link FIRST_PAUSE_SECONDS} up to {@link MAX_PAUSE_SECONDS}. A try during
 * a pause is refused unread and not counted, and the count is forgotten
 * {@link FORGET_AFTER_SECONDS} after the last wrong password or at once on a
 * right one.
 *
 * The cap is short on purpose: anyone can type someone else's email, so a
 * stranger can hold an account's sign-in for at most 15 minutes after their
 * last try, while a guesser is slowed to about 100 tries a day.
 */
export const FREE_TRIES = 5;
export const FIRST_PAUSE_SECONDS = 30;
export const MAX_PAUSE_SECONDS = 15 * 60;
export const FORGET_AFTER_SECONDS = 15 * 60;

const failuresKey = (email: string) => `login-failures:${email}`;
const pauseKey = (email: string) => `login-pause:${email}`;

/** The pause after the given number of wrong passwords in a row, in seconds (0 for none). */
export const pauseAfter = (failures: number): number =>
  failures < FREE_TRIES ? 0 : Math.min(FIRST_PAUSE_SECONDS * 2 ** (failures - FREE_TRIES), MAX_PAUSE_SECONDS);

/**
 * How long the email's sign-in is paused for, in seconds (0 when it is not).
 *
 * @param email - The email as it is looked up (trimmed and lowercased).
 */
export const loginPausedFor = async (email: string): Promise<number> => {
  const ttl = await redis.ttl(pauseKey(email));
  return ttl > 0 ? ttl : 0;
};

/**
 * Counts a wrong password for the email and starts its pause, if it earned one.
 *
 * @param email - The email as it is looked up.
 * @returns The pause started, in seconds (0 for none).
 */
export const recordLoginFailure = async (email: string): Promise<number> => {
  const failures = await redis.incr(failuresKey(email));
  await redis.expire(failuresKey(email), FORGET_AFTER_SECONDS);

  const pause = pauseAfter(failures);
  if (pause > 0) await redis.set(pauseKey(email), "1", "EX", String(pause));
  return pause;
};

/**
 * Forgets the email's wrong passwords after a right one.
 *
 * @param email - The email as it is looked up.
 */
export const clearLoginFailures = async (email: string): Promise<void> => {
  await redis.del(failuresKey(email), pauseKey(email));
};
