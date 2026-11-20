import { mock } from "bun:test";

/**
 * Runs before every `bun test` file (`bunfig.toml`).
 *
 * Achievement rewards are on by default (issue #204), but most yard tests
 * drive the action wrapper with a fake entity manager and count Shiny to the
 * coin. Paying an unlock there would write a bell line and move the balance,
 * so the suite starts with rewards off; the achievement tests turn them on
 * themselves (`achievementConfig.rewards = true`). Set here, before any test
 * imports `config/AchievementConfig.ts`, which reads it once.
 */
process.env.ACHIEVEMENT_REWARDS = "off";

/*
 * The Inferno is off unless a test turns it on, as on CI. Bun loads
 * server/.env for tests too, and a developer's `INFERNO_ENABLED=on` there let
 * Moloch's emergence hold back wild raids and reach `em.execute` on fake
 * entity managers (32 local-only failures, 2 Nov 2026).
 */
process.env.INFERNO_ENABLED = "off";

/*
 * The bot level floor is its default, 25, unless a test sets it: a
 * developer's `BOTS_FLOOR_LEVEL` or `BOTS_TOTAL` in server/.env must not move
 * the bot tests (owner 3 Nov 2026).
 */
delete process.env.BOTS_FLOOR_LEVEL;
delete process.env.BOTS_TOTAL;

/*
 * No weekend event runs unless a test starts one. The yard actions read the
 * live settings (`services/events/weekendSettings.ts`) at the real clock, and
 * the defaults run an event every weekend from 14 Nov 2026: on a Builder's
 * Weekend nine upgrade and fortify tests were charged 30% less than they
 * expect, and the other three events would move loot, lab and hatch tests in
 * their turn. A test that needs an event passes its own settings or calls
 * `setWeekendSettings`, and puts back what it found. A developer's
 * `WEEKEND_FORCE` in server/.env must not start one either. Imported here,
 * after the lines above, so nothing reads the environment before it is set.
 */
delete process.env.WEEKEND_FORCE;
/*
 * Nor does a developer's `EVENTS_FORCE_ON` (e.g. `thanksgiving-2026` in
 * server/.env) turn an event on: it failed the pumpkin hunt test locally
 * (18 Nov 2026). The event tests set it themselves and put it back.
 */
delete process.env.EVENTS_FORCE_ON;

/*
 * No test starts the real server. Importing `server.ts` connects to the
 * database and Redis, runs migrations and listens on port 3001, and many
 * modules reach it (`isBot`, `online`, `chatChannels`, ...). Most test files
 * mock it themselves; the few that did not (chatShouts, mapSaveData,
 * viewMask, friendWorld, giftWishes, infernoProgress.db, botPicture) only
 * passed because an earlier file's mock was still in place, and run first
 * they booted the real server (18 Nov 2026). This stand-in answers for them;
 * a test that needs `postgres` or `redis` mocks `server.js` itself, and the
 * stand-in says so if it is used. Under `bun test --isolate` it is set up
 * again before every file.
 */
const notMocked = (name: string) =>
  new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "then" || typeof key === "symbol") return undefined;
        throw new Error(`server.js stand-in: this test uses ${name}.${String(key)}; mock "server.js" in the test file`);
      },
    }
  );
mock.module("../server.js", () => ({
  app: notMocked("app"),
  PORT: 3001,
  BASE_URL: undefined,
  postgres: notMocked("postgres"),
  redis: notMocked("redis"),
}));
const { DEFAULT_WEEKEND_SETTINGS } = await import("../game-data/events/weekendEvents.js");
const { setWeekendSettings } = await import("../services/events/weekendSettings.js");
setWeekendSettings({ ...DEFAULT_WEEKEND_SETTINGS, enabled: false });
