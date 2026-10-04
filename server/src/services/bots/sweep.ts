import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";

import { botConfig, type BotConfig } from "../../config/BotConfig.js";
import type { BotPersona } from "../../database/models/bot.model.js";
import type { BotJobKind } from "../../database/models/botjob.model.js";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { catchUpYard } from "../yard/catchUp.js";
import { syncBaseValue, syncDerivedLevels } from "../yard/derivedLevels.js";
import { damagedBuildings, planRepair } from "../yard/repair.js";
import { REPAIR_DELAY_HOURS } from "./afterAttack.js";
import {
  anchorFor,
  applyGrowth,
  holdLootInBand,
  pacePosition,
  planRebalance,
  rearmFiredTraps,
  refillArmy,
  RETIRE_POSITION,
  SPREAD_TOLERANCE,
  targetAt,
  tendChampion,
} from "./brain.js";
import { activeBotsByLevel, createBots, evenSpread } from "./factory.js";
import {
  giveupOf,
  readRevengeFacts,
  refusedVerdict,
  revengeVerdict,
  slotBusyVerdict,
  type RevengeOutcome,
  type RevengeVerdict,
} from "./revenge.js";
import { tendShiny } from "./shiny.js";
import { declineTruce } from "./truceDecline.js";
import { visitMapRoom1 } from "./lookAlike.js";
import { generateBotYard } from "./yardGenerator.js";

/**
 * The bot sweep (issue #240, `docs/design/bot-neighbours.md` §6): the one
 * in-process loop that runs bots' work when it is due. Off unless
 * `BOTS_BRAIN=on`; `server.ts` does not even load this module otherwise.
 *
 * Each pass ({@link runBotSweep}):
 *
 * 1. **Books first grows.** Every active bot without a `grow` job gets one,
 *    due within {@link FIRST_GROW_WITHIN_MINUTES} (the factory books none, so
 *    this is how a new bot starts; it also re-books a grow that was dropped).
 * 2. **The daily rebalance**, the first pass of each UTC day: the day is
 *    claimed in `bym.job_run` (`job = 'bots-rebalance'`, as
 *    `scripts/monthly-shiny.ts` claims its month), so one server runs it.
 *    It is not a `bot_job`: it belongs to no bot.
 * 3. **Runs due jobs**, at most {@link JOBS_PER_PASS}, each in its own
 *    transaction: the row is claimed with `FOR UPDATE SKIP LOCKED`, so two
 *    servers never run one job, and the job's effect and its reschedule (or
 *    delete) commit together. The effect runs in a savepoint: when it throws,
 *    it is undone and the job gets `attempts + 1` and a backoff
 *    ({@link backoffMinutes}); the {@link MAX_ATTEMPTS}th failure drops it
 *    with an error log. Only the kinds this sweep knows are claimed
 *    ({@link HANDLED_KINDS}, and `revenge` while `BOTS_REVENGE` is on).
 *
 * With `BOTS_REVENGE` off, every pass first cancels (deletes) the booked
 * `revenge` jobs, so a revenge booked while it was on never runs.
 *
 * Every yard write is under the save's row lock (`SELECT … FOR UPDATE`, as
 * `catchUpLockedYard`), and a yard under attack is left alone and looked at
 * again in {@link UNDER_ATTACK_RETRY_MINUTES}.
 *
 * ## The jobs
 *
 * | Job | When | Does |
 * | --- | --- | --- |
 * | `grow` | every 2-6 h | catch-up; retires the bot past level 40; otherwise growth to the pace target (`brain.ts`), the army topped up, the champion fed, loot in its band, Shiny in its band (`shiny.ts`), `bot.level` kept, Map Room 1's tribes looked at (`lookAlike.ts`), and about two minutes online |
 * | `repair` | 1-4 h after an attack (booked by `afterAttack.ts`) | catch-up, Repair all, traps re-armed, bunkers and Housing refilled, the champion fed and healed, loot in its band |
 * | `revenge` | 1-24 h after an attack, 1 in 3 (booked by `afterAttack.ts`) | the checks (`revenge.ts`), then the attack (`revengeRun.ts`, passed in as {@link SweepDeps.revenge}); waits or gives up as the checks say |
 * | `declineTruce` | 2-8 h after a truce request (booked by `truceDecline.ts`) | rejects the request in its thread, as a player would (`truceDecline.ts`) |
 *
 * A damaged yard does not grow (a player repairs before upgrading); a grow
 * that finds damage and no repair booked books one.
 *
 * **Retirement** (decision 17): a bot whose place on the climb passes level
 * 40 moves to Map Room 2 with no world (`mapversion` 2, `worldid` null),
 * becomes `retired` and loses its jobs, as `retireAllBots` does for all. Every
 * neighbour list drops it on its next read. A fresh level 1 bot is made in its
 * place once the retirement has committed.
 *
 * A bot whose `grow` keeps failing is retired the same way (issue #248): each
 * time its grow is dropped after {@link MAX_ATTEMPTS} failures, `bot.grow_drops`
 * goes up, and the {@link MAX_GROW_DROPS}th drop in a row retires it instead
 * of leaving the next pass to book it again. A grow that runs clears the count.
 *
 * **Presence** (decision 22): each grow marks the bot online as a yard load
 * does (`markOnline`, the last-seen key for 120 s), so for a minute an attack
 * on it is refused as on a real player's.
 *
 * It takes its entity manager, clock and Redis write from the caller and
 * never imports `server.js`, so tests run it on a throwaway database with a
 * made-up clock.
 */

/** The sweep's period. */
export const SWEEP_MS = 60_000;
/** Jobs one pass runs at most. */
export const JOBS_PER_PASS = 20;
/** A job that has failed this many times is dropped. */
export const MAX_ATTEMPTS = 5;
/** A bot whose grow has been dropped this many times in a row is retired (issue #248). */
export const MAX_GROW_DROPS = 3;
/** A grow is due again this many hours after it ran (§6). */
export const GROW_EVERY_HOURS = { min: 2, max: 6 } as const;
/** A bot's first grow is due within this many minutes of being booked. */
export const FIRST_GROW_WITHIN_MINUTES = 60;
/** A yard under attack is looked at again this much later (§6). */
export const UNDER_ATTACK_RETRY_MINUTES = 10;
/** The last growth step's countdown ends at most this share of the way to the next grow. */
export const RUNNING_SHARE = 0.9;
/** The rebalance's `bym.job_run` name. */
export const REBALANCE_JOB = "bots-rebalance";
/** The kinds this sweep runs; `revenge` too while `BOTS_REVENGE` is on. */
export const HANDLED_KINDS: readonly BotJobKind[] = ["grow", "repair", "declineTruce"];

/** Minutes until a failed job is tried again: 5, 10, 20, 40. */
export const backoffMinutes = (attempts: number): number => 5 * 2 ** Math.max(0, attempts - 1);

const HOUR = 60 * 60;

/** What the sweep is given. */
export interface SweepDeps {
  /** A root entity manager; each job forks its own. */
  em: EntityManager;
  /** Unix seconds now; the wall clock by default. */
  now?: () => number;
  /** The switches; the environment by default. */
  config?: () => BotConfig;
  /** Marks a bot online (`last-seen:main:<userid>`); nothing by default. */
  markOnline?: (userid: number, now: number) => Promise<void>;
  /** Random numbers in [0, 1); `Math.random` by default. */
  rng?: () => number;
  /**
   * Fights revenge attacks (`revengeRun.ts`, which `server.ts` passes in).
   * Without it, revenge jobs wait, even with `BOTS_REVENGE` on.
   */
  revenge?: RevengeRunner;
}

/** What the `revenge` job runs the attack with. */
export interface RevengeRunner {
  /** Whether the player has been seen within the last-seen key's life. */
  isOnline: (userid: number, now: number) => Promise<boolean>;
  /** Fights and lands the attack (`runRevengeAttack`). */
  attack: (input: { bot: number; target: number; now: number }) => Promise<RevengeOutcome>;
}

/** One claimed job. */
interface JobRow {
  id: number;
  bot_userid: number;
  kind: BotJobKind;
  attempts: number;
  payload: JsonObject;
  target_userid: number | null;
  giveup_at: Date | null;
  created_at: Date;
}

/** The bot row a job reads. */
interface BotRow {
  userid: number;
  seed: number;
  persona: BotPersona;
  level: number;
  level_since: Date;
  state: string;
}

/** What a job leaves to do once it has committed. */
interface JobEffect {
  online?: number;
  retired?: number;
}

/** What one pass did. */
export interface SweepReport {
  booked: number;
  rebalanced: boolean;
  ran: Partial<Record<BotJobKind, number>>;
  failed: number;
  dropped: number;
  retired: number[];
  replaced: number[];
  grew: { userid: number; from: number; to: number }[];
  /** Bots whose growth was refused (logged): their yard is not the generator's. */
  refused: number[];
  /** Revenge jobs by what became of them: `landed`, `pending`, `wait:<why>`, `cancel:<why>`. */
  revenge: Partial<Record<string, number>>;
}

/** The context a handler runs in. */
interface JobContext {
  now: number;
  config: BotConfig;
  rng: () => number;
  report: SweepReport;
  revenge?: RevengeRunner;
}

type Handler = (tx: EntityManager, job: JobRow, context: JobContext) => Promise<JobEffect>;

const at = (seconds: number): Date => new Date(seconds * 1000);

/** A uniform time `min`-`max` hours after `now`, in unix seconds. */
const hoursAfter = (now: number, hours: { min: number; max: number }, rng: () => number): number =>
  Math.floor(now + (hours.min + rng() * (hours.max - hours.min)) * HOUR);

const lockBot = async (tx: EntityManager, userid: number): Promise<BotRow | null> => {
  const [row] = await tx.execute<BotRow[]>(
    `SELECT userid, seed, persona, level, level_since, state FROM bym.bot WHERE userid = ? FOR UPDATE`,
    [userid]
  );
  if (!row) return null;
  return { ...row, seed: Number(row.seed), level: Number(row.level), level_since: new Date(row.level_since) };
};

/** The bot's main save, locked and refreshed into the identity map. */
const lockYard = (tx: EntityManager, userid: number): Promise<Save | null> =>
  tx.findOne(Save, { userid, type: BaseType.MAIN }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

const deleteJob = (tx: EntityManager, job: JobRow) => tx.execute(`DELETE FROM bym.bot_job WHERE id = ?`, [job.id]);

const postpone = (tx: EntityManager, job: JobRow, due: number) =>
  tx.execute(`UPDATE bym.bot_job SET due_at = ? WHERE id = ?`, [at(due), job.id]);

/**
 * Moves a bot off Map Room 1 for good (the file comment): its yard to Map
 * Room 2 with no world, its row `retired`, its jobs gone.
 */
const retire = async (tx: EntityManager, save: Save, userid: number, now: number): Promise<void> => {
  save.mapversion = MapRoomVersion.V2;
  save.worldid = null;
  await retireRow(tx, userid, now);
};

/**
 * {@link retire} for a bot whose yard a job could not load (issue #248): the
 * yard, if there is one, moved in SQL, as `retireAllBots` does.
 */
const retireUnloaded = async (tx: EntityManager, userid: number, now: number): Promise<void> => {
  await tx.execute(`UPDATE bym.save SET mapversion = ?, worldid = NULL WHERE userid = ? AND type = ?`, [
    MapRoomVersion.V2,
    userid,
    BaseType.MAIN,
  ]);
  await retireRow(tx, userid, now);
};

const retireRow = async (tx: EntityManager, userid: number, now: number): Promise<void> => {
  await tx.execute(`UPDATE bym.bot SET state = 'retired', retired_at = ? WHERE userid = ?`, [at(now), userid]);
  await tx.execute(`DELETE FROM bym.bot_job WHERE bot_userid = ?`, [userid]);
};

/** Counts one more dropped grow for an active bot; returns the count, 0 if the bot is gone or retired. */
const countGrowDrop = async (tx: EntityManager, userid: number): Promise<number> => {
  const [row] = await tx.execute<{ grow_drops: number }[]>(
    `UPDATE bym.bot SET grow_drops = grow_drops + 1 WHERE userid = ? AND state = 'active' RETURNING grow_drops`,
    [userid]
  );
  return row ? Number(row.grow_drops) : 0;
};

/** The generator's yard at a bot's place on the climb. */
const yardAt = (bot: BotRow, position: number, now: number) =>
  generateBotYard({ seed: bot.seed, persona: bot.persona, targetPoints: targetAt(position), now });

/** The `grow` job (the file comment). */
const grow: Handler = async (tx, job, { now, config, rng, report }) => {
  const bot = await lockBot(tx, job.bot_userid);
  if (!bot || bot.state !== "active") {
    await deleteJob(tx, job);
    return {};
  }
  const save = await lockYard(tx, bot.userid);
  if (!save) throw new Error(`Bot ${bot.userid} has no main yard`);
  if (save.mapversion !== MapRoomVersion.V1) {
    // Off Map Room 1 by some other road: it can never be a neighbour again.
    logger.warn("Bot {userid} is no longer on Map Room 1; retiring it", { userid: bot.userid });
    await retire(tx, save, bot.userid, now);
    return { retired: bot.userid };
  }
  if (isAttackActive(save)) {
    await postpone(tx, job, now + UNDER_ATTACK_RETRY_MINUTES * 60);
    return {};
  }

  const days = config.daysPerLevel;
  const speed = Number(job.payload?.speed) > 0 ? Number(job.payload.speed) : 1;
  catchUpYard(save, now);

  const position = pacePosition(bot, now, days, speed);
  if (position >= RETIRE_POSITION) {
    await retire(tx, save, bot.userid, now);
    return { retired: bot.userid };
  }

  const next = hoursAfter(now, GROW_EVERY_HOURS, rng);
  const yard = yardAt(bot, position, now);
  if (damagedBuildings(save).length > 0) {
    // Repair before upgrading, as a player would; make sure a repair is coming.
    await tx.execute(
      `INSERT INTO bym.bot_job (bot_userid, kind, due_at) VALUES (?, 'repair', ?) ON CONFLICT DO NOTHING`,
      [bot.userid, at(hoursAfter(now, REPAIR_DELAY_HOURS, rng))]
    );
  } else {
    const growth = applyGrowth(save, yard, (next - now) * RUNNING_SHARE);
    if ("refused" in growth) {
      report.refused.push(bot.userid);
      logger.warn("Bot {userid} cannot grow: {refusal}", {
        userid: bot.userid,
        refusal: JSON.stringify(growth.refused),
      });
    } else {
      refillArmy(save, yard);
    }
  }
  tendChampion(save, yard, false);
  holdLootInBand(save, rng);
  syncBaseValue(save);
  syncDerivedLevels(save);

  const level = calculateBaseLevel(save.points, save.basevalue);
  save.level = level;
  save.credits = tendShiny(save.credits, level, rng);
  visitMapRoom1(save);
  if (level !== bot.level) {
    report.grew.push({ userid: bot.userid, from: bot.level, to: level });
    // The place on the climb is kept; a nudged pace lasts until the next level.
    await tx.execute(`UPDATE bym.bot SET level = ?, level_since = ? WHERE userid = ?`, [
      level,
      anchorFor(position, level, now, days, speed),
      bot.userid,
    ]);
  }
  const payload = level !== bot.level ? { ...job.payload, speed: 1 } : job.payload;
  await tx.execute(`UPDATE bym.bot_job SET due_at = ?, attempts = 0, payload = ? WHERE id = ?`, [
    at(next),
    JSON.stringify(payload ?? {}),
    job.id,
  ]);
  await tx.execute(`UPDATE bym.bot SET grow_drops = 0 WHERE userid = ? AND grow_drops > 0`, [bot.userid]);
  return { online: bot.userid };
};

/** The `repair` job (the file comment). */
const repair: Handler = async (tx, job, { now, config, rng }) => {
  const [bot] = await tx.execute<BotRow[]>(
    `SELECT userid, seed, persona, level, level_since, state FROM bym.bot WHERE userid = ?`,
    [job.bot_userid]
  );
  if (!bot || bot.state !== "active") {
    await deleteJob(tx, job);
    return {};
  }
  const row: BotRow = { ...bot, seed: Number(bot.seed), level: Number(bot.level), level_since: new Date(bot.level_since) };
  const save = await lockYard(tx, row.userid);
  if (!save) throw new Error(`Bot ${row.userid} has no main yard`);
  if (isAttackActive(save)) {
    await postpone(tx, job, now + UNDER_ATTACK_RETRY_MINUTES * 60);
    return {};
  }

  catchUpYard(save, now);
  try {
    save.buildingdata = planRepair(save, { all: true }, now).slices.buildingdata;
  } catch (error) {
    // Nothing damaged, or all of it already repairing: the refills still run.
    if (!(error instanceof ClientSafeError)) throw error;
  }
  const yard = yardAt(row, pacePosition(row, now, config.daysPerLevel), now);
  rearmFiredTraps(save, yard);
  refillArmy(save, yard);
  tendChampion(save, yard, true);
  holdLootInBand(save, rng);
  await deleteJob(tx, job);
  return {};
};

/** Acts on a revenge job's verdict: deletes the job, or moves it to its new time. */
const settleRevenge = async (tx: EntityManager, job: JobRow, verdict: RevengeVerdict, report: SweepReport) => {
  if (verdict.act === "run") return;
  const key = verdict.act === "cancel" ? `cancel:${verdict.reason}` : `wait:${verdict.reason}`;
  report.revenge[key] = (report.revenge[key] ?? 0) + 1;
  if (verdict.act === "cancel") await deleteJob(tx, job);
  else await postpone(tx, job, verdict.due);
  logger.info("Bot {bot}'s revenge on {target}: {act} ({reason})", {
    event: "bot-revenge-check",
    jobid: job.id,
    bot: job.bot_userid,
    target: job.target_userid,
    act: verdict.act,
    reason: verdict.reason,
    ...(verdict.act === "postpone" && { due: at(verdict.due).toISOString() }),
  });
};

/**
 * The `revenge` job (`docs/design/bot-neighbours.md` §4.7): the checks, read
 * fresh with the bot's row locked, then the attack. A landed attack, or one
 * committed and left to land from its checkpoint, ends the job.
 */
const revenge: Handler = async (tx, job, { now, rng, report, revenge: runner }) => {
  const target = Number(job.target_userid);
  const giveupAt = giveupOf(job.giveup_at, job.created_at);
  if (!runner || !target) {
    await settleRevenge(tx, job, { act: "cancel", reason: "targetGone" }, report);
    return {};
  }

  const facts = await readRevengeFacts(tx, { bot: job.bot_userid, target, giveupAt }, now, runner.isOnline);
  // Null: another server holds this bot right now.
  const verdict = facts ? revengeVerdict(facts, job.bot_userid, rng) : slotBusyVerdict(now, giveupAt);
  if (verdict.act !== "run") {
    await settleRevenge(tx, job, verdict, report);
    return {};
  }

  const outcome = await runner.attack({ bot: job.bot_userid, target, now });
  switch (outcome.status) {
    case "landed":
    case "pending":
      report.revenge[outcome.status] = (report.revenge[outcome.status] ?? 0) + 1;
      await deleteJob(tx, job);
      return {};
    case "busy":
      await settleRevenge(tx, job, slotBusyVerdict(now, giveupAt), report);
      return {};
    case "refused":
      await settleRevenge(tx, job, refusedVerdict(now, giveupAt, rng), report);
      return {};
    case "nothing":
      await settleRevenge(tx, job, { act: "cancel", reason: "nothingToSend" }, report);
      return {};
  }
};

/** The `declineTruce` job (`truceDecline.ts`): the answer, then the row is done. */
const declineTruceJob: Handler = async (tx, job, { now }) => {
  await declineTruce(tx, job, now);
  await deleteJob(tx, job);
  return {};
};

const HANDLERS: Record<string, Handler> = { grow, repair, revenge, declineTruce: declineTruceJob };

/** Cancels every booked revenge (`BOTS_REVENGE` off); returns how many. */
export const cancelRevenges = async (em: EntityManager): Promise<number> => {
  const rows = await em.execute<{ id: number }[]>(`DELETE FROM bym.bot_job WHERE kind = 'revenge' RETURNING id`);
  if (rows.length > 0) {
    logger.info("BOTS_REVENGE is off: cancelled {count} booked revenge attacks", { count: rows.length });
  }
  return rows.length;
};

/** Books a `grow` for every active bot without one (step 1 of a pass). */
export const bookFirstGrows = async (em: EntityManager, now: number): Promise<number> => {
  const rows = await em.execute<{ id: number }[]>(
    `INSERT INTO bym.bot_job (bot_userid, kind, due_at)
     SELECT b.userid, 'grow', to_timestamp(? + floor(random() * ?))
       FROM bym.bot b
      WHERE b.state = 'active'
        AND NOT EXISTS (SELECT 1 FROM bym.bot_job j WHERE j.bot_userid = b.userid AND j.kind = 'grow')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [now, FIRST_GROW_WITHIN_MINUTES * 60]
  );
  return rows.length;
};

/** Claims and runs one due job; null when none is due. */
const runOneJob = async (
  em: EntityManager,
  context: JobContext,
  kinds: readonly BotJobKind[]
): Promise<{ job: JobRow; effect: JobEffect } | null> =>
  em.fork().transactional(async (tx) => {
    const [claimed] = await tx.execute<JobRow[]>(
      `SELECT id, bot_userid, kind, attempts, payload, target_userid, giveup_at, created_at FROM bym.bot_job
        WHERE due_at <= ? AND kind IN (${kinds.map(() => "?").join(", ")})
        ORDER BY due_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [at(context.now), ...kinds]
    );
    if (!claimed) return null;
    const job: JobRow = { ...claimed, id: Number(claimed.id), attempts: Number(claimed.attempts) };

    try {
      const effect = await tx.transactional((inner) => HANDLERS[job.kind]!(inner, job, context), {
        propagation: "nested",
      });
      context.report.ran[job.kind] = (context.report.ran[job.kind] ?? 0) + 1;
      return { job, effect };
    } catch (error) {
      const attempts = job.attempts + 1;
      const detail = {
        event: "bot-job-failed",
        jobid: job.id,
        kind: job.kind,
        bot: job.bot_userid,
        attempts,
        error: error instanceof Error ? error.message : String(error),
      };
      if (attempts >= MAX_ATTEMPTS) {
        await deleteJob(tx, job);
        context.report.dropped++;
        const drops = job.kind === "grow" ? await countGrowDrop(tx, job.bot_userid) : 0;
        if (drops >= MAX_GROW_DROPS) {
          await retireUnloaded(tx, job.bot_userid, context.now);
          logger.error("Bot {bot}'s grow was dropped {drops} times in a row; retired it: {error}", {
            ...detail,
            event: "bot-retired-failing",
            drops,
          });
          return { job, effect: { retired: job.bot_userid } };
        }
        logger.error("Bot job {jobid} ({kind}, bot {bot}) failed {attempts} times and was dropped: {error}", detail);
      } else {
        await tx.execute(`UPDATE bym.bot_job SET attempts = ?, due_at = ? WHERE id = ?`, [
          attempts,
          at(context.now + backoffMinutes(attempts) * 60),
          job.id,
        ]);
        context.report.failed++;
        logger.warn("Bot job {jobid} ({kind}, bot {bot}) failed, attempt {attempts}: {error}", detail);
      }
      return { job, effect: {} };
    }
  });

/** Today's UTC date, the rebalance's period. */
export const rebalancePeriod = (now: number): string => at(now).toISOString().slice(0, 10);

/**
 * The daily rebalance (step 2 of a pass): claims the day, nudges paces
 * (`planRebalance`) in the same transaction, and returns how many level 1
 * bots to make; null when the day was already claimed.
 */
const rebalance = async (em: EntityManager, now: number, config: BotConfig): Promise<number | null> =>
  em.fork().transactional(async (tx) => {
    const claimed = await tx.execute<{ job: string }[]>(
      `INSERT INTO bym.job_run (job, period, ran_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING job`,
      [REBALANCE_JOB, rebalancePeriod(now), at(now)]
    );
    if (claimed.length === 0) return null;

    const rows = await tx.execute<{ userid: number; level: number; level_since: Date; speed: number | null }[]>(
      `SELECT b.userid, b.level, b.level_since, (j.payload->>'speed')::float AS speed
         FROM bym.bot b LEFT JOIN bym.bot_job j ON j.bot_userid = b.userid AND j.kind = 'grow'
        WHERE b.state = 'active'`
    );
    const bots = rows.map((row) => ({
      userid: Number(row.userid),
      level: Number(row.level),
      level_since: new Date(row.level_since),
      speed: Number(row.speed) > 0 ? Number(row.speed) : 1,
    }));
    const share = evenSpread(config.total);
    const plan = planRebalance(bots, share, config.total, now, config.daysPerLevel);

    let nudged = 0;
    for (const nudge of plan.nudges) {
      const bot = bots.find((one) => one.userid === nudge.userid)!;
      // Only if the bot has not moved on meanwhile, and only bots with a grow to carry the pace.
      const moved = await tx.execute<{ userid: number }[]>(
        `UPDATE bym.bot SET level_since = ? WHERE userid = ? AND level = ? AND level_since = ?
           AND EXISTS (SELECT 1 FROM bym.bot_job j WHERE j.bot_userid = ? AND j.kind = 'grow')
         RETURNING userid`,
        [nudge.level_since, nudge.userid, bot.level, bot.level_since, nudge.userid]
      );
      if (moved.length === 0) continue;
      await tx.execute(
        `UPDATE bym.bot_job SET payload = payload || jsonb_build_object('speed', ?::float) WHERE bot_userid = ? AND kind = 'grow'`,
        [nudge.speed, nudge.userid]
      );
      nudged++;
    }
    logger.info("Bot rebalance {period}: {active} active, {nudged} paces nudged, {topUp} level 1 bots to make", {
      period: rebalancePeriod(now),
      active: bots.length,
      nudged,
      topUp: plan.topUp,
    });
    if (bots.length + plan.topUp < config.total) {
      logger.warn("Bot rebalance: {missing} bots short of {total}; level 1 takes {topUp} today", {
        missing: config.total - bots.length,
        total: config.total,
        topUp: plan.topUp,
      });
    } else {
      const drifted = share.flatMap((want, index) => {
        const have = bots.filter((bot) => bot.level === index + 1).length;
        return Math.abs(have - want) > SPREAD_TOLERANCE ? [`level ${index + 1}: ${have} of ${want}`] : [];
      });
      if (drifted.length > 0) {
        logger.warn("Bot rebalance: levels more than {tolerance} off their share: {drifted}", {
          tolerance: SPREAD_TOLERANCE,
          drifted: drifted.join(", "),
        });
      }
    }
    return plan.topUp;
  });

/** Makes `count` fresh level 1 bots; failures are logged and left to the next rebalance. */
const makeLevelOneBots = async (em: EntityManager, count: number, now: number, deps: JobContext): Promise<number[]> => {
  if (count <= 0) return [];
  try {
    const made = await createBots(em, Array.from({ length: count }, () => 1), {
      rng: mulberry32(Math.floor(deps.rng() * 2 ** 32)),
      now,
      daysPerLevel: deps.config.daysPerLevel,
      fresh: true,
    });
    return made.map((bot) => bot.userid);
  } catch (error) {
    logger.error("Could not make {count} level 1 bots: {error}", {
      count,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

/**
 * One pass of the sweep (the file comment). Does nothing at all while
 * `BOTS_BRAIN` is off.
 */
export const runBotSweep = async (deps: SweepDeps): Promise<SweepReport | null> => {
  const config = (deps.config ?? botConfig)();
  if (!config.brain) return null;

  const now = (deps.now ?? getCurrentDateTime)();
  const report: SweepReport = {
    booked: 0,
    rebalanced: false,
    ran: {},
    failed: 0,
    dropped: 0,
    retired: [],
    replaced: [],
    grew: [],
    refused: [],
    revenge: {},
  };
  const context: JobContext = { now, config, rng: deps.rng ?? Math.random, report, revenge: deps.revenge };
  const { em } = deps;

  report.booked += await bookFirstGrows(em.fork(), now);

  // Revenge runs only with BOTS_REVENGE on and a runner given; with it off,
  // nothing booked survives.
  let kinds = HANDLED_KINDS;
  if (!config.revenge) {
    const cancelled = await cancelRevenges(em.fork());
    if (cancelled > 0) report.revenge["cancel:switchedOff"] = cancelled;
  } else if (deps.revenge) {
    kinds = [...HANDLED_KINDS, "revenge"];
  }

  const topUp = await rebalance(em, now, config);
  if (topUp !== null) {
    report.rebalanced = true;
    report.replaced.push(...(await makeLevelOneBots(em, topUp, now, context)));
  }

  const online: number[] = [];
  for (let n = 0; n < JOBS_PER_PASS; n++) {
    const outcome = await runOneJob(em, context, kinds);
    if (!outcome) break;
    if (outcome.effect.online !== undefined) online.push(outcome.effect.online);
    if (outcome.effect.retired !== undefined) report.retired.push(outcome.effect.retired);
  }

  // After the commits: presence, and a fresh level 1 bot for each one retired.
  for (const userid of online) {
    try {
      await deps.markOnline?.(userid, now);
    } catch (error) {
      logger.warn("Could not mark bot {userid} online: {error}", { userid, error: String(error) });
    }
  }
  if (report.retired.length > 0) {
    report.replaced.push(...(await makeLevelOneBots(em, report.retired.length, now, context)));
    logger.info("Retired {retired} bots (past level 40, or failing to grow); level 1 bots now {levelOne}", {
      retired: report.retired.length,
      levelOne: (await activeBotsByLevel(em.fork()))[1] ?? 0,
    });
  }
  if (report.replaced.length > 0) report.booked += await bookFirstGrows(em.fork(), now);
  return report;
};

/**
 * Starts the minute sweep (`server.ts`, only with `BOTS_BRAIN=on`). A pass
 * still running when the next is due is not doubled. Returns the stop
 * function.
 */
export const startBotSweep = (deps: SweepDeps): (() => void) => {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runBotSweep(deps);
    } catch (error) {
      logger.error(`Bot sweep failed: ${error}`);
    } finally {
      running = false;
    }
  }, SWEEP_MS);
  return () => clearInterval(timer);
};
