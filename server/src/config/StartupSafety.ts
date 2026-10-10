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
 * - a `DB_PASSWORD` other than the example one, `dev12345`;
 * - a Turnstile secret key, so sign-ups are checked for bots (issue #213);
 * - a mail server (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`), so
 *   password-reset emails can be sent;
 * - `WEB_URL`, the site the reset emails link to;
 * - no setting still holding a placeholder from `production.env.example`:
 *   `FILL IN`, or the `EXAMPLE.com` domain (docs/deploy.md).
 *
 * A local server (`ENV=local`, no `NODE_ENV=production`) is never refused
 * for these beyond a missing `SECRET_KEY`.
 */

/** The shortest `SECRET_KEY` a production server accepts. */
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

/** Example values that must never be a production secret. */
const EXAMPLE_SECRETS = new Set(["secret", "changeme", "change-me", "your-secret-key", "test-secret"]);
const EXAMPLE_DB_PASSWORD = "dev12345";

/** What `production.env.example` leaves for the owner to replace. */
const FILL_IN = "FILL IN";
const PLACEHOLDER_DOMAIN = /(^|[^a-z0-9-])example\.com\b/i;

/** Settings a production server cannot work without, and what goes wrong otherwise. */
const REQUIRED_IN_PRODUCTION: Record<string, string> = {
  TURNSTILE_SECRET_KEY: "sign-ups would not be checked for bots",
  SMTP_HOST: "password-reset emails could not be sent",
  SMTP_PORT: "password-reset emails could not be sent",
  SMTP_USER: "password-reset emails could not be sent",
  SMTP_PASSWORD: "password-reset emails could not be sent",
  WEB_URL: "password-reset emails would have no link",
};

/** Settings that name an address, which must be the real one. */
const ADDRESS_SETTINGS = ["WEB_URL", "BASE_URL", "CHAT_WS_HOST", "MAIL_FROM"];

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

  for (const [name, consequence] of Object.entries(REQUIRED_IN_PRODUCTION)) {
    if (!unquoted(env[name])) refusals.push(`${name} is not set, so ${consequence}`);
  }

  for (const [name, value] of Object.entries(env)) {
    if (unquoted(value) === FILL_IN) refusals.push(`${name} is still "${FILL_IN}"`);
  }

  for (const name of ADDRESS_SETTINGS) {
    if (PLACEHOLDER_DOMAIN.test(unquoted(env[name]))) refusals.push(`${name} still names the placeholder EXAMPLE.com`);
  }

  return refusals;
};
