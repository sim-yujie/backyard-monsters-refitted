import { redis } from "../../server.js";
import { logger } from "../../utils/logger.js";

/**
 * The in-game check's review log (#273): every trigger and every result, for
 * an admin to read.
 *
 * Two copies of each row. A structured log line (`Bot check: ...`, with the
 * row as its properties and `botCheck: true` to filter on), which production
 * keeps in `logs/bymr.jsonl` with the rest; and the Redis list {@link BOT_CHECK_LOG_KEY}, newest first,
 * capped at {@link BOT_CHECK_LOG_MAX} rows and gone
 * {@link BOT_CHECK_LOG_TTL_SECONDS} after the last one, so it never grows for
 * ever. Read it with `LRANGE bot-check:log 0 99`, or {@link readBotCheckLog}.
 * No database table: that would want a migration.
 */

export const BOT_CHECK_LOG_KEY = "bot-check:log";
/** The newest rows kept. */
export const BOT_CHECK_LOG_MAX = 5_000;
/** The list goes 30 days after its last row. */
export const BOT_CHECK_LOG_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * What happened: a rule fired (`trigger`), the player answered right
 * (`solved`) or wrong (`wrong`), or too many wrong answers started the wait
 * (`cooldown`).
 */
export type BotCheckEvent = "trigger" | "solved" | "wrong" | "cooldown";

export interface BotCheckLogRow {
  /** Unix seconds. */
  readonly at: number;
  readonly userid: number;
  readonly event: BotCheckEvent;
  /** The rule that fired (`botPatterns.ts` `BotRule`), on a trigger. */
  readonly rule?: string;
  /** The evidence or the result, in a line. */
  readonly detail: string;
}

/** Writes one row. A Redis failure is logged and swallowed: the log line is already out. */
export const logBotCheck = async (row: BotCheckLogRow): Promise<void> => {
  logger.info("Bot check: {event} for userid {userid}, rule {rule}: {detail}", {
    botCheck: true,
    ...row,
    rule: row.rule ?? "-",
  });
  try {
    await redis.lpush(BOT_CHECK_LOG_KEY, JSON.stringify(row));
    await Promise.all([
      redis.ltrim(BOT_CHECK_LOG_KEY, 0, BOT_CHECK_LOG_MAX - 1),
      redis.expire(BOT_CHECK_LOG_KEY, BOT_CHECK_LOG_TTL_SECONDS),
    ]);
  } catch (err) {
    logger.warn(`Bot check row not kept in Redis for userid ${row.userid}: ${err}`);
  }
};

/** The newest `limit` rows, newest first. */
export const readBotCheckLog = async (limit = 100): Promise<BotCheckLogRow[]> =>
  (await redis.lrange(BOT_CHECK_LOG_KEY, 0, limit - 1)).map((row) => JSON.parse(row) as BotCheckLogRow);
