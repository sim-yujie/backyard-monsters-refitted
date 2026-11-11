import mikroOrmConfig from "../mikro-orm.config.js";

import { randomBytes } from "node:crypto";
import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";

import { botConfig, botFloorLevel, BOTS_RETIRED } from "../config/BotConfig.js";
import { Env } from "../enums/Env.js";
import { mulberry32 } from "../game-rules/combat/rng.js";
import {
  activeBotsByLevel,
  BOT_MAX_LEVEL,
  botsMadeSince,
  botStatus,
  createBots,
  deleteBots,
  evenSpread,
  fillPlan,
  retireAllBots,
} from "../services/bots/factory.js";
import { bornQuietShare, planRebalance, type RebalanceBot, type RebalanceRules } from "../services/bots/population.js";
import { planTodaysRebalance, type TodaysRebalance } from "../services/bots/sweep.js";

/**
 * Makes and removes Map Room 1 bots (issue #239, `docs/design/bot-neighbours.md`
 * §10). Run from the server directory; it writes to the database `DB_NAME`
 * names (`server/.env`, or `DB_NAME=... bun ...` to point it elsewhere).
 *
 * Bots are retired (owner, 12 Nov 2026, `BOTS_RETIRED`): `create` refuses
 * unless it is a --dry-run; `status`, `retire-all` and `delete-retired` still
 * work on the bots there are.
 *
 *   bun src/scripts/bots.ts create --target N [--per-day N] [--dry-run]
 *       Tops the active bots up to N, spread evenly from the level floor
 *       (`BOTS_FLOOR_LEVEL`, default 25) to 40, lowest
 *       levels first. Idempotent: it counts the bots there are and makes only
 *       the difference. --per-day caps the bots made in any 24 hours (run it
 *       daily to spread a live rollout over a few days). Each level starts
 *       with the mix of quiet and growing bots it holds once settled
 *       (`bornQuietShare`, `services/bots/population.ts`).
 *   bun src/scripts/bots.ts create --fill [--per-day N] [--dry-run]
 *       The same, up to BOTS_TOTAL (default about 11.5 a level from the floor
 *       to 40: 185 at floor 25).
 *   bun src/scripts/bots.ts create --levels 25,30,35 [--count N] [--dry-run]
 *       Makes N more bots on the levels given, taken in turn (N defaults to one
 *       per level listed), whatever the target. For a few test bots; they
 *       all grow.
 *   bun src/scripts/bots.ts create --count N [--target N | --fill] [--dry-run]
 *       Without --levels, --count caps a fill: the next N bots toward the
 *       target (BOTS_TOTAL when none is given), lowest levels first.
 *   bun src/scripts/bots.ts status
 *       Active and retired bots, active bots per level, pending jobs.
 *   bun src/scripts/bots.ts rebalance --dry-run [--seed N]
 *       What the sweep's next daily rebalance would do with the settings as
 *       they are now (`BOTS_FLOOR_LEVEL`, `BOTS_TOTAL`, ...): every bot it
 *       would retire (userid, name, level, why) and how many new bots it
 *       would make on each level. Writes nothing; the sweep runs the real
 *       one, so only --dry-run is taken. A bot locked or under attack at the
 *       time is left for another day, so the real one can retire fewer.
 *   bun src/scripts/bots.ts retire-all [--dry-run]
 *       The kill switch: moves every active bot off Map Room 1 at once.
 *   bun src/scripts/bots.ts delete-retired [--dry-run]
 *       Deletes retired bots nothing in the mail refers to.
 *   bun src/scripts/bots.ts remove-all --yes [--dry-run]
 *       Dev only, refused when ENV is production: deletes every bot, active
 *       or retired, with its mail, truces and attack logs.
 *
 * --seed N makes a run's draws repeatable (names, yards, ages).
 *
 * It opens its own ORM and never imports `server.js`, so it boots no server,
 * opens no port and runs no migration. The bot tables must exist: run
 * `bun run migration:up` first.
 */

const USAGE = `Usage: bun src/scripts/bots.ts <command> [options]
  create --target N [--per-day N] [--dry-run]
  create --fill [--per-day N] [--dry-run]
  create --levels 25,30,35 [--count N] [--dry-run]
  create --count N [--target N | --fill] [--dry-run]
  status
  rebalance --dry-run [--seed N]
  retire-all [--dry-run]
  delete-retired [--dry-run]
  remove-all --yes [--dry-run]       (dev only)
  --seed N                           repeatable draws`;

/** The command line, parsed. */
export interface BotsArgs {
  command: string;
  target?: number;
  fill: boolean;
  perDay?: number;
  levels?: number[];
  count?: number;
  seed?: number;
  dryRun: boolean;
  yes: boolean;
}

const positiveInt = (flag: string, raw: string | undefined): number => {
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} needs a whole number, got ${raw ?? "nothing"}`);
  }
  return value;
};

/** Reads `argv` (without `bun` and the script). */
export const parseArgs = (argv: readonly string[]): BotsArgs => {
  const [command = "", ...rest] = argv;
  const args: BotsArgs = { command, fill: false, dryRun: false, yes: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    switch (flag) {
      case "--target":
        args.target = positiveInt(flag, rest[++i]);
        break;
      case "--per-day":
        args.perDay = positiveInt(flag, rest[++i]);
        break;
      case "--count":
        args.count = positiveInt(flag, rest[++i]);
        break;
      case "--seed":
        args.seed = positiveInt(flag, rest[++i]);
        break;
      case "--levels": {
        const raw = rest[++i] ?? "";
        args.levels = raw.split(",").map((part) => {
          const level = Number(part.trim());
          const floor = botFloorLevel();
          if (!Number.isInteger(level) || level < floor || level > BOT_MAX_LEVEL) {
            throw new Error(`--levels takes levels ${floor}-${BOT_MAX_LEVEL}, got "${part}"`);
          }
          return level;
        });
        break;
      }
      case "--fill":
        args.fill = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--yes":
        args.yes = true;
        break;
      default:
        throw new Error(`Unknown option ${flag}`);
    }
  }
  return args;
};

/**
 * The levels `create` makes, one per bot (see the file comment).
 *
 * @param {BotsArgs} args - The command line
 * @param {Record<number, number>} activeByLevel - Active bots per level now
 * @param {number} madeToday - Bots made in the last 24 hours
 * @param {number} total - `BOTS_TOTAL`
 * @returns {number[]} The levels, in the order they will be made
 */
export const createPlan = (
  args: BotsArgs,
  activeByLevel: Readonly<Record<number, number>>,
  madeToday: number,
  total: number
): number[] => {
  if (args.levels) {
    if (args.target !== undefined || args.fill) throw new Error("--levels does not go with --target or --fill");
    const count = args.count ?? args.levels.length;
    return Array.from({ length: count }, (_, index) => args.levels![index % args.levels!.length]!);
  }
  if (args.fill && args.target !== undefined) throw new Error("Use --fill or --target, not both");
  // --count alone: the next N toward BOTS_TOTAL.
  const target = args.fill || (args.target === undefined && args.count !== undefined) ? total : args.target;
  if (target === undefined) throw new Error("create needs --target N, --fill, --count N or --levels");
  const perDay = args.perDay === undefined ? Number.POSITIVE_INFINITY : Math.max(0, args.perDay - madeToday);
  return fillPlan(target, activeByLevel, Math.min(perDay, args.count ?? Number.POSITIVE_INFINITY));
};

/** "level: count" pairs for a list of levels, ascending. */
const histogram = (levels: readonly number[]): string => {
  const counts = new Map<number, number>();
  for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, count]) => `L${level}:${count}`)
    .join(" ");
};

const runCreate = async (em: EntityManager, args: BotsArgs) => {
  const config = botConfig();
  const now = new Date();
  const activeByLevel = await activeBotsByLevel(em);
  const active = Object.values(activeByLevel).reduce((sum, count) => sum + count, 0);
  const madeToday = await botsMadeSince(em, new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const plan = createPlan(args, activeByLevel, madeToday, config.total);

  console.log(`Active bots: ${active}. Made in the last 24 hours: ${madeToday}.`);
  if (plan.length === 0) {
    console.log("Nothing to make.");
    return;
  }
  console.log(`Plan: ${plan.length} bot(s): ${histogram(plan)}`);
  if (args.dryRun) {
    console.log("Dry run: nothing written.");
    return;
  }

  const seed = args.seed ?? randomBytes(4).readUInt32LE(0);
  const share = evenSpread(config.total);
  const made = await createBots(em, plan, {
    rng: mulberry32(seed),
    now: Math.floor(now.getTime() / 1000),
    pace: config.pace,
    quietShare: args.levels ? undefined : (level) => bornQuietShare(level, config.pace, share[level - 1] ?? 0, config.growingFlow),
    onBatch: (batch) => {
      for (const bot of batch) {
        const quiet = bot.quiet ? " quiet" : "";
        console.log(`  made ${bot.username} (userid ${bot.userid}, baseid ${bot.baseid}) level ${bot.level} ${bot.persona}${quiet}`);
      }
    },
  });
  console.log(`Made ${made.length} bot(s).`);
};

/** One retired bot as the dry run prints it. */
export interface RetireLine {
  userid: number;
  username: string;
  level: number;
}

/**
 * The smallest `BOTS_TOTAL` at which today's rebalance would retire no bot at
 * or above the floor (only those below it), with the other settings as they
 * are and no fresh births; null when none up to `limit` does.
 */
export const totalKeepingAll = (
  bots: readonly RebalanceBot[],
  rules: Omit<RebalanceRules, "share" | "total" | "births">,
  now: number,
  limit = 5000
): number | null => {
  const floor = rules.floor ?? botFloorLevel();
  const levelOf = new Map(bots.map((bot) => [bot.userid, bot.level]));
  const atOrAbove = bots.filter((bot) => bot.level >= floor).length;
  for (let total = Math.max(1, atOrAbove); total <= limit; total++) {
    const plan = planRebalance(bots, { ...rules, share: evenSpread(total, floor), total, births: 0, floor }, now);
    if (plan.retire.every((userid) => (levelOf.get(userid) ?? 0) < floor)) return total;
  }
  return null;
};

const pad = (value: string | number, width: number): string => String(value).padStart(width);

/**
 * What `rebalance --dry-run` prints for a planned rebalance: the settings, a
 * table per level (bots now, the level's share, how many would retire below
 * the floor or off a crowded level, new bots, bots after), the bots at or
 * above the floor it would retire, then each bot to retire.
 *
 * @param {TodaysRebalance} today - The plan (`planTodaysRebalance`)
 * @param {Map<number, string>} names - Usernames by userid
 * @param {number} total - `BOTS_TOTAL`
 * @param {number | null} keepsAll - {@link totalKeepingAll}, when worked out
 * @returns {string[]} The lines
 */
export const describeRebalance = (
  today: TodaysRebalance,
  names: ReadonlyMap<number, string>,
  total: number,
  keepsAll?: number | null
): string[] => {
  const { bots, share, floor, plan } = today;
  const levels = share.length;
  const levelOf = (level: number) => Math.min(Math.max(level, 1), levels);
  const byId = new Map<number, RebalanceBot>(bots.map((bot) => [bot.userid, bot]));
  const retired = plan.retire.map((userid): RetireLine => ({
    userid,
    username: names.get(userid) ?? "?",
    level: byId.get(userid)?.level ?? 0,
  }));
  const below = retired.filter((bot) => bot.level < floor);
  const crowded = retired.filter((bot) => bot.level >= floor);
  const made = [...Array<number>(plan.born).fill(floor), ...plan.make];
  const left = bots.filter((bot) => !plan.retire.includes(bot.userid)).map((bot) => levelOf(bot.level));
  const count = (list: readonly number[], level: number) => list.filter((one) => levelOf(one) === level).length;
  const highNow = bots.filter((bot) => bot.level >= floor).length;
  const nowLevels = bots.map((bot) => bot.level);
  const belowLevels = below.map((bot) => bot.level);
  const crowdedLevels = crowded.map((bot) => bot.level);

  const lines = [
    `Floor: level ${floor}. Total: ${total} (${Math.min(...share.slice(floor - 1))}-${Math.max(...share)} a level from ${floor} to ${levels}).`,
    `Active bots now: ${bots.length} (${bots.length - highNow} below the floor, ${highNow} at or above it).`,
    `Would retire ${retired.length}: ${below.length} below the floor, ${crowded.length} at or above the floor off crowded levels.`,
    `Would make ${made.length} new: ${plan.born} at the bottom of level ${floor}, ${plan.make.length} on short levels.`,
    `Active after: ${left.length + made.length}.`,
    "",
    "Per level (share: bots the level should hold at this total):",
    " level   now share | retire:below retire:crowded |  new after",
  ];
  const totals = { now: 0, share: 0, below: 0, crowded: 0, made: 0, after: 0 };
  for (let level = 1; level <= levels; level++) {
    const row = {
      now: count(nowLevels, level),
      share: share[level - 1] ?? 0,
      below: level < floor ? count(belowLevels, level) : 0,
      crowded: level >= floor ? count(crowdedLevels, level) : 0,
      made: count(made, level),
      after: count(left, level) + count(made, level),
    };
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += row[key];
    if (row.now + row.share + row.made === 0) continue;
    const mark = row.crowded > 0 ? "  <- trims bots at or above the floor" : row.after < row.share ? "  (short)" : "";
    lines.push(
      `${pad(`L${level}`, 6)} ${pad(row.now, 5)} ${pad(row.share, 5)} | ${pad(row.below, 12)} ${pad(row.crowded, 14)} | ${pad(row.made, 4)} ${pad(row.after, 5)}${mark}`
    );
  }
  lines.push(
    `${pad("all", 6)} ${pad(totals.now, 5)} ${pad(totals.share, 5)} | ${pad(totals.below, 12)} ${pad(totals.crowded, 14)} | ${pad(totals.made, 4)} ${pad(totals.after, 5)}`,
    ""
  );

  lines.push(
    crowded.length > 0
      ? `At or above the floor: ${crowded.length} of ${highNow} bots would retire off crowded levels (${histogram(crowdedLevels)}).`
      : `At or above the floor: none of ${highNow} bots would retire.`
  );
  if (keepsAll !== undefined) {
    lines.push(
      keepsAll === null
        ? "No BOTS_TOTAL up to 5000 keeps every bot at or above the floor."
        : `To keep every bot at or above the floor today, set BOTS_TOTAL to at least ${keepsAll}${keepsAll <= total ? " (this total does)" : ""}.`
    );
  }
  const short = share.flatMap((want, index) => {
    const have = count(left, index + 1) + count(made, index + 1);
    return want - have > 0 ? [`L${index + 1}:${want - have}`] : [];
  });
  if (short.length > 0) lines.push(`Still short of their share after today (later days make them, at most BOTS_NEW_PER_DAY a day): ${short.join(" ")}`);
  if (retired.length > 0) {
    lines.push("", "Bots to retire:");
    lines.push(
      ...retired.map((bot) => `  retire ${bot.userid} ${bot.username} level ${bot.level}${bot.level < floor ? " (below the floor)" : " (crowded level)"}`)
    );
  }
  lines.push("Dry run: nothing written.");
  return lines;
};

const runRebalance = async (em: EntityManager, args: BotsArgs) => {
  const config = botConfig();
  const seed = args.seed ?? randomBytes(4).readUInt32LE(0);
  const rng = mulberry32(seed);
  const today = await planTodaysRebalance(em, Math.floor(Date.now() / 1000), config, () => rng.float());
  const rows = today.plan.retire.length
    ? await em.execute<{ userid: number; username: string }[]>(
        `SELECT userid, username FROM bym."user" WHERE userid IN (${today.plan.retire.map(() => "?").join(", ")})`,
        today.plan.retire
      )
    : [];
  const names = new Map(rows.map((row) => [Number(row.userid), row.username]));
  const keepsAll = totalKeepingAll(
    today.bots,
    { slack: config.levelSlack, newPerDay: config.newPerDay, floor: today.floor },
    Math.floor(Date.now() / 1000)
  );
  for (const line of describeRebalance(today, names, config.total, keepsAll)) console.log(line);
};

const runStatus = async (em: EntityManager) => {
  const status = await botStatus(em, new Date());
  console.log(`Active: ${status.active}  Retired: ${status.retired}  Made in the last 24 hours: ${status.madeToday}`);
  const levels = Object.keys(status.byLevel).map(Number);
  console.log(`Active per level: ${levels.length ? histogram(levels.flatMap((level) => Array(status.byLevel[level]).fill(level))) : "none"}`);
  const jobs = Object.entries(status.jobs);
  console.log(`Pending jobs: ${jobs.length ? jobs.map(([kind, count]) => `${kind}:${count}`).join(" ") : "none"}`);
};

/** Runs one command (see the file comment). */
export const run = async (args: BotsArgs) => {
  if (args.command === "remove-all" && process.env.ENV === Env.PROD) {
    throw new Error("remove-all is for dev databases only (ENV is production). Use retire-all, then delete-retired.");
  }
  if (args.command === "remove-all" && !args.yes && !args.dryRun) {
    throw new Error("remove-all deletes every bot and its mail. Add --yes to go ahead.");
  }
  if (args.command === "create" && BOTS_RETIRED && !args.dryRun) {
    throw new Error("Bots are retired (owner, 12 Nov 2026; BOTS_RETIRED in config/BotConfig.ts): create makes no bots.");
  }
  if (args.command === "rebalance" && !args.dryRun) {
    throw new Error("rebalance only takes --dry-run: the bot sweep runs the real one each day.");
  }
  if (!["create", "status", "rebalance", "retire-all", "delete-retired", "remove-all"].includes(args.command)) {
    throw new Error(`Unknown command "${args.command}"`);
  }

  const orm = await MikroORM.init({ ...mikroOrmConfig, debug: false, pool: { min: 0, max: 2 } });
  try {
    const em = orm.em.fork();
    console.log(`Database: ${process.env.DB_NAME}`);

    switch (args.command) {
      case "create":
        await runCreate(em, args);
        break;
      case "status":
        await runStatus(em);
        break;
      case "rebalance":
        await runRebalance(em, args);
        break;
      case "retire-all":
      case "delete-retired":
      case "remove-all": {
        if (args.dryRun) {
          const status = await botStatus(em, new Date());
          console.log(`Active: ${status.active}  Retired: ${status.retired}. Dry run: nothing written.`);
          break;
        }
        if (args.command === "retire-all") {
          console.log(`Retired ${await retireAllBots(em, new Date())} bot(s).`);
        } else {
          const deleted = await deleteBots(em, args.command === "remove-all" ? "all" : "retired");
          console.log(`Deleted ${deleted} bot(s).`);
        }
        break;
      }
    }
  } finally {
    await orm.close(true);
  }
};

if (import.meta.main) {
  try {
    await run(parseArgs(process.argv.slice(2)));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(USAGE);
    process.exit(1);
  }
}
