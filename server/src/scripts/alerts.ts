import mikroOrmConfig from "../mikro-orm.config.js";

import { RedisClient } from "bun";
import { MikroORM } from "@mikro-orm/postgresql";

import { alertConfig, dashboardLink } from "../config/AlertConfig.js";
import { redisAlertStore } from "../services/alerts/alerts.js";
import { dailySummaryText } from "../services/alerts/dailySummary.js";
import { recentTelegramChats, sendTelegram } from "../services/alerts/telegram.js";
import { adminHealthReport } from "../services/health/adminHealth.js";
import { utcDay } from "../services/stats/activity.js";
import { getDailySummary } from "../services/stats/dailyStats.js";
import { Env } from "../enums/Env.js";
import { LOG_BASE, LOG_DIR } from "../utils/logger.js";

/**
 * The owner's Telegram alerts, by hand (docs/alerts.md). Run from the server
 * directory, or on the live server inside the game container:
 * `deploy/prod.sh exec web bun run alerts:<command>`.
 *
 *   bun run alerts:chat-id
 *       Lists the chats that have messaged the bot lately, with their ids:
 *       send the bot any message first, then put the id in TELEGRAM_CHAT_ID.
 *       Needs only TELEGRAM_BOT_TOKEN.
 *   bun run alerts:test
 *       Sends one test message to TELEGRAM_CHAT_ID.
 *   bun run alerts:check
 *       Prints the health summary and what is wrong now, and which problems
 *       are open (already said). Sends nothing.
 *   bun run alerts:summary [YYYY-MM-DD] [--send]
 *       Prints the daily summary for that finished UTC day (yesterday if no
 *       day is given), as Telegram would get it. Sends it only with --send.
 *
 * It never prints the bot token. It opens its own connections and never
 * imports `server.ts`, so it is safe to run while the game is up.
 */

const USAGE = "Usage: bun run alerts:chat-id | alerts:test | alerts:check | alerts:summary [YYYY-MM-DD] [--send]";

const chatId = async () => {
  const chats = await recentTelegramChats(process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "");
  if (!chats.length) {
    console.log("No messages yet. Send your bot any message in Telegram (e.g. /start), then run this again.");
    return;
  }
  for (const chat of chats) console.log(`${chat.id}  ${chat.kind}  ${chat.name}`);
  console.log("\nPut the id of your own chat in TELEGRAM_CHAT_ID (production.env), then restart the game server.");
};

const test = async () => {
  const config = alertConfig();
  const link = dashboardLink("health", config);
  const outcome = await sendTelegram(
    ["BYMR test alert: Telegram alerts are working.", link].filter(Boolean).join("\n"),
    { config }
  );
  if (!outcome.sent) throw new Error(outcome.reason);
  console.log("Sent. Check Telegram.");
};

const check = async () => {
  const orm = await MikroORM.init({ ...mikroOrmConfig, debug: false });
  const redis = new RedisClient(process.env.REDIS_URL);
  try {
    await redis.connect();
    const report = await adminHealthReport({ sql: (query) => orm.em.fork().execute(query), redis });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    redis.close();
    await orm.close();
  }
};

const summary = async () => {
  const args = process.argv.slice(3);
  const day = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) ?? utcDay(Date.now() - 24 * 60 * 60 * 1000);
  const orm = await MikroORM.init({ ...mikroOrmConfig, debug: false });
  const redis = new RedisClient(process.env.REDIS_URL);
  try {
    await redis.connect();
    const config = alertConfig();
    // The same log folder as the server, in case this fills the day's row first.
    const logDir = process.env.ENV === Env.LOCAL ? null : LOG_DIR;
    const daily = await getDailySummary(day, { em: orm.em.fork(), redis, logDir, logBase: LOG_BASE });
    const text = dailySummaryText(daily, [...(await redisAlertStore(redis).all()).values()], config);
    console.log(text);
    if (args.includes("--send")) {
      const outcome = await sendTelegram(text, { config });
      if (!outcome.sent) throw new Error(outcome.reason);
      console.log("\nSent. Check Telegram.");
    }
  } finally {
    redis.close();
    await orm.close();
  }
};

(async () => {
  const commands: Record<string, () => Promise<void>> = { "chat-id": chatId, test, check, summary };
  const command = commands[process.argv[2] ?? ""];
  if (!command) {
    console.error(USAGE);
    process.exit(1);
  }
  try {
    await command();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  process.exit();
})();
