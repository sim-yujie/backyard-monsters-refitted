import { Env } from "../enums/Env.js";

/**
 * Settings a server refuses to start with (issue #319).
 *
 * Any server needs a `SECRET_KEY`: login tokens are signed and checked with it.
 *
 * A server that looks like production refuses to start unless it is set up as
 * one. It looks like production when `ENV=production` or
 * `NODE_ENV=production` (PM2's `ecosystem.config.mjs` sets the latter). It
 * then needs:
 *
 * - `ENV=production`, so the production-only protections are on (Discord
 *   gate, SMTP checks, no dev routes or sandbox yard);
 * - a `SECRET_KEY` of at least 32 characters that is not a known example;
 * - a `DB_PASSWORD` other than the example one, `dev12345`.
 *
 * A local server (`ENV=local`, no `NODE_ENV=production`) is never refused
 * for these beyond a missing `SECRET_KEY`.
 */

/** The shortest `SECRET_KEY` a production server accepts. */
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

/** Example values that must never be a production secret. */
const EXAMPLE_SECRETS = new Set(["secret", "changeme", "change-me", "your-secret-key", "test-secret"]);
const EXAMPLE_DB_PASSWORD = "dev12345";

/** A value as written in an env file, without surrounding quotes. */
const unquoted = (value: string | undefined): string => (value ?? "").trim().replace(/^(['"])(.*)\1$/, "$2");

/**
 * Lists every reason the server must not start with these settings.
 *
 * @param {Record<string, string | undefined>} env - The environment, normally `process.env`.
 * @returns {string[]} One line per problem; empty when the server may start.
 */
export const startupRefusals = (env: Record<string, string | undefined>): string[] => {
  const refusals: string[] = [];
  const secret = unquoted(env.SECRET_KEY);

  if (!secret) refusals.push("SECRET_KEY is not set, so login tokens cannot be signed or checked");

  const productionLike = env.ENV === Env.PROD || env.NODE_ENV === "production";
  if (!productionLike) return refusals;

  if (env.ENV !== Env.PROD) {
    refusals.push(
      `NODE_ENV is production but ENV is ${env.ENV ? `"${env.ENV}"` : "not set"}: set ENV=production`
    );
  }

  if (secret && secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    refusals.push(`SECRET_KEY is shorter than ${MIN_PRODUCTION_SECRET_LENGTH} characters`);
  }

  if (EXAMPLE_SECRETS.has(secret.toLowerCase())) refusals.push("SECRET_KEY is an example value");

  if (unquoted(env.DB_PASSWORD) === EXAMPLE_DB_PASSWORD) {
    refusals.push(`DB_PASSWORD is the example password (${EXAMPLE_DB_PASSWORD})`);
  }

  return refusals;
};
