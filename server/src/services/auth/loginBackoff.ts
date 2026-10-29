import { redis } from "../../server.js";
import { addressBucket } from "../../utils/addressBucket.js";

/**
 * Per-account sign-in back-off (security audit 2026-10-29, L2), in two layers.
 * Wrong passwords are counted for every email whether or not it has an
 * account, so neither layer says which emails do. Addresses are counted by
 * {@link addressBucket} (an IPv6 address by its /64).
 *
 * Per email and address: the first {@link FREE_TRIES} wrong passwords are
 * free; each one after that pauses that email from that address for twice as
 * long as the last, from {@link FIRST_PAUSE_SECONDS} up to
 * {@link MAX_PAUSE_SECONDS}. The count is forgotten
 * {@link FORGET_AFTER_SECONDS} after the last wrong password, and at once on
 * a right one from that address. Anyone can type someone else's email, so a
 * stranger's wrong passwords pause it only on the stranger's own connection.
 *
 * Per email, for guessers spread over many addresses: after
 * {@link ACCOUNT_MAX_FAILURES} wrong passwords within
 * {@link ACCOUNT_WINDOW_SECONDS}, from any addresses, the email is paused for
 * the rest of that hour, but only for addresses not
 * {@link rememberAddress known} for it: the player's own, where they signed
 * in within the last {@link KNOWN_ADDRESS_SECONDS}, still get in. One address
 * alone cannot reach 50 in an hour (its own pauses hold it to about a dozen),
 * nor can a player who forgot their password, so it takes a guesser with
 * several addresses, who is then held to 50 guesses an hour.
 *
 * A try refused by either pause is refused before the password is checked and
 * not counted. A password reset lifts both layers for the email.
 */
export const FREE_TRIES = 5;
export const FIRST_PAUSE_SECONDS = 30;
export const MAX_PAUSE_SECONDS = 15 * 60;
export const FORGET_AFTER_SECONDS = 15 * 60;
export const ACCOUNT_MAX_FAILURES = 50;
export const ACCOUNT_WINDOW_SECONDS = 60 * 60;
export const KNOWN_ADDRESS_SECONDS = 30 * 24 * 60 * 60;

const failuresKey = (email: string, bucket: string) => `login-failures:${email}|${bucket}`;
const pauseKey = (email: string, bucket: string) => `login-pause:${email}|${bucket}`;
/** The addresses with wrong passwords for the email, so a reset can clear them all. */
const addressesKey = (email: string) => `login-failure-ips:${email}`;
const accountFailuresKey = (email: string) => `login-account-failures:${email}`;
const knownKey = (email: string, bucket: string) => `login-known:${email}|${bucket}`;

/** The pause after the given number of wrong passwords in a row, in seconds (0 for none). */
export const pauseAfter = (failures: number): number =>
  failures < FREE_TRIES ? 0 : Math.min(FIRST_PAUSE_SECONDS * 2 ** (failures - FREE_TRIES), MAX_PAUSE_SECONDS);

/**
 * How long the email's sign-in from this address is paused for, in seconds
 * (0 when it is not), by either layer.
 *
 * @param email - The email as it is looked up (trimmed and lowercased).
 * @param ip - The address signing in.
 */
export const loginPausedFor = async (email: string, ip: string): Promise<number> => {
  const bucket = addressBucket(ip);
  const ttl = await redis.ttl(pauseKey(email, bucket));
  if (ttl > 0) return ttl;

  const failures = Number((await redis.get(accountFailuresKey(email))) ?? 0);
  if (failures < ACCOUNT_MAX_FAILURES || (await redis.exists(knownKey(email, bucket)))) return 0;
  const windowLeft = await redis.ttl(accountFailuresKey(email));
  return windowLeft > 0 ? windowLeft : 0;
};

/**
 * Counts a wrong password for the email from this address and starts its pause, if it earned one.
 *
 * @param email - The email as it is looked up.
 * @param ip - The address signing in.
 * @returns The per-address pause started, in seconds (0 for none).
 */
export const recordLoginFailure = async (email: string, ip: string): Promise<number> => {
  const bucket = addressBucket(ip);
  const failures = await redis.incr(failuresKey(email, bucket));
  await redis.expire(failuresKey(email, bucket), FORGET_AFTER_SECONDS);
  await redis.sadd(addressesKey(email), bucket);
  await redis.expire(addressesKey(email), FORGET_AFTER_SECONDS);

  // The account-wide count runs in fixed hours from its first wrong password.
  if ((await redis.incr(accountFailuresKey(email))) === 1) {
    await redis.expire(accountFailuresKey(email), ACCOUNT_WINDOW_SECONDS);
  }

  const pause = pauseAfter(failures);
  if (pause > 0) await redis.set(pauseKey(email, bucket), "1", "EX", String(pause));
  return pause;
};

/**
 * Forgets the email's wrong passwords from this address after a right one.
 * The account-wide count stays: a right password from one address says
 * nothing about the guesses from others.
 *
 * @param email - The email as it is looked up.
 * @param ip - The address that signed in.
 */
export const clearLoginFailures = async (email: string, ip: string): Promise<void> => {
  const bucket = addressBucket(ip);
  await redis.del(failuresKey(email, bucket), pauseKey(email, bucket));
  await redis.srem(addressesKey(email), bucket);
};

/**
 * Remembers an address the account signed in from, for
 * {@link KNOWN_ADDRESS_SECONDS} from its latest sign-in there. A known
 * address gets past the account-wide pause.
 *
 * @param email - The account's email.
 * @param ip - The address that signed in.
 */
export const rememberAddress = async (email: string, ip: string): Promise<void> => {
  await redis.set(knownKey(email, addressBucket(ip)), "1", "EX", String(KNOWN_ADDRESS_SECONDS));
};

/**
 * Forgets the email's wrong passwords and pauses, from every address and
 * account-wide, after a password reset: whoever reset it holds the email.
 *
 * @param email - The account's email.
 */
export const clearAllLoginFailures = async (email: string): Promise<void> => {
  const buckets = await redis.smembers(addressesKey(email));
  await redis.del(
    ...buckets.flatMap((bucket) => [failuresKey(email, bucket), pauseKey(email, bucket)]),
    addressesKey(email),
    accountFailuresKey(email)
  );
};
