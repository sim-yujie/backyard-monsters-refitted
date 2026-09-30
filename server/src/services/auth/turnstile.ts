import { logger } from "../../utils/logger.js";

/**
 * Cloudflare Turnstile, the bot check on sign-up (issue #213).
 *
 * The sign-up form runs Cloudflare's widget, which hands it a one-use token;
 * the register route sends that token to Cloudflare's `siteverify` endpoint
 * with the secret key before it creates the account. The keys come from the
 * environment: `TURNSTILE_SITE_KEY` for the web client's build and
 * `TURNSTILE_SECRET_KEY` for this server. With no secret key (local
 * development) the check is skipped entirely, and the server says so once at
 * boot.
 *
 * Cloudflare's test keys work end to end without a real widget: secret
 * `1x0000000000000000000000000000000AA` passes every token and
 * `2x0000000000000000000000000000000AA` fails every one
 * (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
 */

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's longest token. Anything longer is not one, so it is not sent. */
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

/** How long to wait for Cloudflare before giving up on the check. */
const VERIFY_TIMEOUT_MS = 10_000;

/**
 * - `skipped`: no secret key is set, so nothing was checked.
 * - `passed`: Cloudflare accepted the token.
 * - `failed`: no token, a malformed one, or one Cloudflare refused (expired, used, a bot).
 * - `unavailable`: Cloudflare could not be asked, or answered with something that is not an answer.
 */
export type TurnstileVerdict = "skipped" | "passed" | "failed" | "unavailable";

interface SiteverifyResponse {
  success?: unknown;
  "error-codes"?: unknown;
}

/** The secret key, or null when the check is off. */
export const turnstileSecretKey = (): string | null => process.env.TURNSTILE_SECRET_KEY?.trim() || null;

/**
 * Asks Cloudflare whether a Turnstile token is good.
 *
 * @param {unknown} token - What the client sent as its token, checked here
 * @param {string | undefined} remoteIp - The player's address, which Cloudflare checks against the token's
 * @param {object} [options] - The secret key and fetch to use; the environment's and the global one by default
 * @returns {Promise<TurnstileVerdict>} What became of the check
 */
export const verifyTurnstileToken = async (
  token: unknown,
  remoteIp: string | undefined,
  { secret = turnstileSecretKey(), fetcher = fetch }: { secret?: string | null; fetcher?: typeof fetch } = {}
): Promise<TurnstileVerdict> => {
  if (!secret) return "skipped";

  if (typeof token !== "string" || token === "" || token.length > TURNSTILE_TOKEN_MAX_LENGTH) return "failed";

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  let answer: SiteverifyResponse;
  try {
    const response = await fetcher(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn(`Turnstile siteverify answered HTTP ${response.status}`);
      return "unavailable";
    }
    answer = (await response.json()) as SiteverifyResponse;
  } catch (err) {
    logger.warn(`Turnstile siteverify could not be reached: ${(err as Error).message}`);
    return "unavailable";
  }

  if (answer.success === true) return "passed";

  const codes = Array.isArray(answer["error-codes"]) ? answer["error-codes"] : [];
  // A bad secret or Cloudflare's own fault is ours to fix, not the player's.
  if (codes.some((code) => ["missing-input-secret", "invalid-input-secret", "internal-error"].includes(code))) {
    logger.error(`Turnstile siteverify refused the check itself: ${codes.join(", ")}`);
    return "unavailable";
  }
  return "failed";
};
