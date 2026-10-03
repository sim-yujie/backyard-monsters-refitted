import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Bot } from "../../database/models/bot.model.js";
import { BotJob } from "../../database/models/botjob.model.js";
import { User } from "../../database/models/user.model.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";

/**
 * Bots look exactly like real players (issue #235, decision 3 of
 * `docs/design/bot-neighbours.md`): whether a user is a bot, and anything the
 * bot tables hold, must never reach a client — not in an API response, map or
 * neighbour data, chat or mail. The flag lives only in `bym.bot`, so two
 * guards keep it there:
 *
 * 1. Nothing about bots is a `@FrontendKey`, so no filtered entity can carry
 *    it, and `user.last_seen_at` (the neighbour search's activity rule) is not
 *    one either.
 * 2. Only known code reads the bot tables. Bot services, scripts and the
 *    database layer may; anything else that imports the bot entities or
 *    `services/bots/`, statically or with `import()`, must be listed in
 *    {@link READERS}, with what it does with the answer. A new reader is a place a bot could show: check that
 *    nothing it learns changes what a player is sent (a refusal reads as the
 *    same refusal for a real player) before adding it.
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));

/** Server files outside the bot code that may read bot data, and why it never shows. */
const READERS: Record<string, string> = {
  "controllers/auth/login.ts": "refuses a bot's login as a wrong password",
  "controllers/auth/forgotPassword.ts": "refuses a bot's reset mail as an unknown email",
  "controllers/auth/resetPassword.ts": "refuses a bot's reset as a bad token",
  "mikro-orm.config.ts": "registers the entities",
  "services/maproom/v1/findOverworldNeighbours.ts":
    "fills empty neighbour places with bots, built by the same createNeighbourData as real players and shuffled in with them",
  "services/base/afterYardDefended.ts":
    "after a defence lands: a real defender gets the same notice whoever attacked, a bot books jobs; returns nothing to the response",
  "server.ts": "starts the bot sweep when BOTS_BRAIN is on (a background timer; it answers no request)",
};

/** Directories whose files may read bot data freely: the bot code and the database layer. */
const OPEN = ["services/bots/", "database/", "scripts/"];

const BOT_IMPORT = /(?:from\s+|import\s*\(\s*)["'][^"']*(?:\/bot\.model\.js|\/botjob\.model\.js|\/services\/bots\/[^"']*|\.\.?\/bots\/[^"']*)["']/;

const sources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });

describe("bots never reach a client", () => {
  test("no bot table column is ever sent to a client", () => {
    const bot = Object.assign(new Bot(), {
      userid: 41,
      seed: 12345,
      persona: "towers",
      level: 12,
      level_since: new Date(),
    });
    expect(FilterFrontendKeys(bot)).toEqual({});

    const job = Object.assign(new BotJob(), {
      id: 1,
      bot_userid: 41,
      kind: "revenge",
      target_userid: 7,
      due_at: new Date(),
    });
    expect(FilterFrontendKeys(job)).toEqual({});
  });

  test("user.last_seen_at is never sent to a client", () => {
    const user = Object.assign(new User(), { userid: 7, username: "kai_builds", last_seen_at: new Date() });
    const sent = FilterFrontendKeys(user);
    expect(sent.username).toBe("kai_builds");
    expect("last_seen_at" in sent).toBe(false);
  });

  test("only listed code outside the bot services reads bot data", () => {
    const readers = sources(SRC)
      .filter((path) => BOT_IMPORT.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path).split(sep).join("/"))
      .filter((path) => !OPEN.some((open) => path.startsWith(open)))
      .sort();

    expect(readers).toEqual(Object.keys(READERS).sort());
  });
});
