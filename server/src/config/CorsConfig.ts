import { Env } from "../enums/Env.js";

/**
 * Which web pages may read the server's answers (security audit 2026-10-29,
 * L8). It was `Access-Control-Allow-Origin: *`.
 *
 * Allowed:
 * - `WEB_URL`, the web client and its admin page (`https://<WEB_DOMAIN>` in
 *   `docker-compose.prod.yml`);
 * - `BASE_URL`, the server's own address;
 * - `CORS_ORIGINS`, a comma-separated list of any more, such as a Vercel
 *   preview or the home page if it ever calls the server (today it does not:
 *   `site/` is static);
 * - off production, any `localhost` or `127.0.0.1` page on any port, so the
 *   dev client (5173), the helpers' vite ports (53xx) and the local servers
 *   (3001, 3021) all work.
 *
 * Only reading the answer in a browser is limited. A request with no Origin
 * header (the launcher, a server, curl) is answered as before, and the login
 * token travels in a header rather than a cookie, so a page left out never
 * had the player's session to begin with.
 */

/** An address's origin (`https://play.example.com`), or null if it is not a URL. */
const originOf = (address: string | undefined): string | null => {
  if (!address?.trim()) return null;
  try {
    return new URL(address.trim()).origin;
  } catch {
    return null;
  }
};

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export interface CorsSettings {
  readonly origins: ReadonlySet<string>;
  readonly allowLocal: boolean;
}

/**
 * The allowed origins, from the environment.
 *
 * @param env - The environment to read (the process's by default).
 */
export const corsSettings = (env: NodeJS.ProcessEnv = process.env): CorsSettings => {
  const listed = [env.WEB_URL, env.BASE_URL, ...(env.CORS_ORIGINS ?? "").split(",")];
  const origins = new Set(listed.map(originOf).filter((origin): origin is string => origin !== null));
  return { origins, allowLocal: env.ENV !== Env.PROD };
};

/**
 * Whether a page at this origin may read the server's answers.
 *
 * @param origin - The request's Origin header.
 * @param settings - The allowed origins.
 */
export const isAllowedOrigin = (origin: string | undefined, settings: CorsSettings): origin is string =>
  !!origin && (settings.origins.has(origin) || (settings.allowLocal && LOCAL_ORIGIN.test(origin)));
