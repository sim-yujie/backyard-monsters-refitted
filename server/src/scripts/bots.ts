import mikroOrmConfig from "../mikro-orm.config.js";

import { randomBytes } from "node:crypto";
import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";

import { botConfig } from "../config/BotConfig.js";
import { Env } from "../enums/Env.js";
import { mulberry32 } from "../game-rules/combat/rng.js";
import {
  activeBotsByLevel,
  BOT_MAX_LEVEL,
  BOT_MIN_LEVEL,
  botsMadeSince,
  botStatus,
  createBots,
  deleteBots,
  fillPlan,
  retireAllBots,
} from "../services/bots/factory.js";

/**
 * Makes and removes Map Room 1 bots (issue #239, `docs/design/bot-neighbours.md`
 * §10). Run from the server directory; it writes to the database `DB_NAME`
 * names (`server/.env`, or `DB_NAME=... bun ...` to point it elsewhere).
 *
 *   bun src/scripts/bots.ts create --target N [--per-day N] [--dry-run]
 *       Tops the active bots up to N, spread evenly over levels 1-40, lowest
 *       levels first. Idempotent: it counts the bots there are and makes only
 *       the difference. --per-day caps the bots made in any 24 hours (run it
 *       daily to spread a live rollout over a few days).
 *   bun src/scripts/bots.ts create --fill [--per-day N] [--dry-run]
 *       The same, up to BOTS_TOTAL (default 500).
 *   bun src/scripts/bots.ts create --levels 5,15,25 [--count N] [--dry-run]
 *       Makes N more bots on the levels given, taken in turn (N defaults to one
 *       per level listed), whatever the target. For a few test bots.
 *   bun src/scripts/bots.ts create --count N [--target N | --fill] [--dry-run]
 *       Without --levels, --count caps a fill: the next N bots toward the
 *       target (BOTS_TOTAL when none is given), lowest levels first.
 *   bun src/scripts/bots.ts status
 *       Active and retired bots, active bots per level, pending jobs.
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
  create --levels 5,15,25 [--count N] [--dry-run]
  create --count N [--target N | --fill] [--dry-run]
  status
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
          if (!Number.isInteger(level) || level < BOT_MIN_LEVEL || level > BOT_MAX_LEVEL) {
            throw new Error(`--levels takes levels ${BOT_MIN_LEVEL}-${BOT_MAX_LEVEL}, got "${part}"`);
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
  const made = await createBots(em, plan, {
    rng: mulberry32(seed),
    now: Math.floor(now.getTime() / 1000),
    daysPerLevel: config.daysPerLevel,
    onBatch: (batch) => {
      for (const bot of batch) {
        console.log(`  made ${bot.username} (userid ${bot.userid}, baseid ${bot.baseid}) level ${bot.level} ${bot.persona}`);
      }
    },
  });
  console.log(`Made ${made.length} bot(s).`);
};

const runStatus = async (em: EntityManager) => {
  const status = await botStatus(em, new Date());
  console.log(`Active: ${status.active}  Retired: ${status.retired}  Made in the last 24 hours: ${status.madeToday}`);
  const levels = Object.keys(status.byLevel).map(Number);
  console.log(`Active per level: ${levels.length ? histogram(levels.flatMap((level) => Array(status.byLevel[level]).fill(level))) : "none"}`);
  const jobs = Object.entries(status.jobs);
  console.log(`Pending jobs: ${jobs.length ? jobs.map(([kind, count]) => `${kind}:${count}`).join(" ") : "none"}`);
};

const run = async (args: BotsArgs) => {
  if (args.command === "remove-all" && process.env.ENV === Env.PROD) {
    throw new Error("remove-all is for dev databases only (ENV is production). Use retire-all, then delete-retired.");
  }
  if (args.command === "remove-all" && !args.yes && !args.dryRun) {
    throw new Error("remove-all deletes every bot and its mail. Add --yes to go ahead.");
  }
  if (!["create", "status", "retire-all", "delete-retired", "remove-all"].includes(args.command)) {
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
