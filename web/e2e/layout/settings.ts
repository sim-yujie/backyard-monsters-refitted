/**
 * Ports, database and limits for the layout check, from the environment.
 *
 * The check starts its own game server and its own web page on ports away
 * from the owner's game (3001 / 5173), with its own Redis slot, and refuses
 * the shared `bym` database: it registers an account and plays in it.
 */

const env = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

const serverPort = Number(env("LAYOUT_SERVER_PORT", "3371"));
const chatPort = Number(env("LAYOUT_CHAT_PORT", "3372"));
const webPort = Number(env("LAYOUT_WEB_PORT", "5371"));

export const settings = {
  serverPort,
  chatPort,
  webPort,
  serverUrl: `http://localhost:${serverPort}`,
  webUrl: `http://localhost:${webPort}`,
  /** Any value passes unless the server has USE_VERSION_MANAGEMENT on (web/src/config.ts). */
  apiVersion: env("LAYOUT_API_VERSION", "v1.6.1-beta"),
  dbName: process.env["LAYOUT_DB_NAME"] ?? "",
  redisUrl: env("LAYOUT_REDIS_URL", "redis://localhost:6379/13"),
  /** The first load builds a maxed sandbox yard and draws it without a graphics card. */
  bootTimeout: Number(env("LAYOUT_BOOT_TIMEOUT_MS", "150000")),
  /** A few rows of a list (owner, 15 Nov 2026: "never shrinks below a few rows"). */
  minList: Number(env("LAYOUT_MIN_LIST_PX", "120")),
  /** Save a picture of every case, not only failed ones. */
  allShots: env("LAYOUT_SHOTS", "") === "all",
} as const;

/** Stops a run that would touch the owner's database or ports. */
export const assertSafeSettings = (): void => {
  if (!settings.dbName) {
    throw new Error(
      "Set LAYOUT_DB_NAME to a throwaway database with the game's schema (e.g. bym_layout). " +
        "See the header of e2e/layout/playwright.config.ts.",
    );
  }
  if (settings.dbName === "bym")
    throw new Error("LAYOUT_DB_NAME=bym is the owner's database: refused.");
  for (const port of [settings.serverPort, settings.chatPort, settings.webPort]) {
    if ([3001, 3010, 3021, 5173].includes(port))
      throw new Error(`Port ${port} belongs to the owner's game: refused.`);
  }
};
