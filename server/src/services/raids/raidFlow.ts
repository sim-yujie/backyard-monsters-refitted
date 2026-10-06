import { randomInt } from "node:crypto";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { raidRefusedErr } from "../../errors/errors.js";
import { defenderForcesOf, type DefenderForces, type RaidEvent, type Roster } from "../../game-rules/combat/index.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { catchUpLockedRow, catchUpLockedYard } from "../../controllers/yard/yardAction.js";
import { notifyAndCount } from "../notifications/notifications.js";
import { playerLevelOf } from "../base/calculateBaseLevel.js";
import { isAttackActive } from "../base/isAttackActive.js";
import {
  FINALISE_REPLAY_DEADLINE_MS,
  ReplayTimeoutError,
  fightRaidInWorker,
  reserveReplaySlot,
} from "../base/combat/replayRunner.js";
import type { CompletedJob } from "../yard/catchUp.js";
import { repairsDoneBy } from "../yard/catchUpRepairs.js";
import { readPresenceMarks } from "../user/online.js";
import { fightSecondsOf, type RaidFightInput, type RaidFightOutcome } from "./raidFight.js";
import { landRaid, landedResult, type RaidResult } from "./raidLanding.js";
import { raidFighting, readFightLock } from "./raidLock.js";
import { planRaid, type RaidPlan } from "./raidPlan.js";
import {
  SESSIONS_BETWEEN_RAIDS,
  raidAlreadyApplied,
  raidDueCheck,
  raidDueNow,
  readSchedule,
  scheduleColumn,
  setRaidFrequency,
  withFightLock,
  withoutFightLock,
  type RaidPreference,
} from "./raidSchedule.js";
import {
  FIGHT_GRACE_SECONDS,
  WARNING_SECONDS,
  cancelOpenRaid,
  earliestFinish,
  newRaidId,
  openRaid,
  readOpenRaid,
  takeRaidForFinish,
  updateOpenRaid,
  type OpenRaid,
  type RaidScreen,
} from "./raidStore.js";

/**
 * The server's side of a wild monster raid, end to end (#226 WP3,
 * `docs/design/wild-raids.md` §4.2): the warning opened from a presence ping,
 * "Engage now" and "Prepare defences", the fight run once at its start, the
 * finish that lands it, and the frequency choice. The routes in
 * `controllers/raid/raid.ts` and the ping (`controllers/maproom/presence.ts`)
 * only bind these to Koa.
 *
 * The client is trusted for one thing: that it is on the yard with the
 * Planner closed (§3), which it says in the ping. Everything else — whether a
 * raid is due, its army, the fight and what it did — is the server's.
 */

/** What the client is shown of an open raid: never the outcome. */
export interface RaidView {
  readonly id: string;
  readonly phase: OpenRaid["phase"];
  readonly tribe: string;
  /** The army, by monster id, for the alert's pictures. */
  readonly monsters: Roster;
  /** Unix seconds the fight is due; now or past once "Engage now" was pressed. */
  readonly attackAt: number;
  /** 1 once "Prepare defences" was pressed: the top bar counts down. */
  readonly warned: 0 | 1;
  /** In the fight: when it started, and the earliest finish the server takes. */
  readonly startedAt?: number;
  readonly finishFrom?: number;
}

/** What `/raid/start` answers: everything the client needs to play the fight the server fought. */
export interface RaidStart {
  readonly raid: RaidView;
  readonly fight: {
    readonly seed: number;
    readonly events: readonly RaidEvent[];
    /** The tick the server's fight ended on. */
    readonly tick: number;
    /** Its length at 1x, seconds. */
    readonly seconds: number;
    /** The yard as the fight found it, which the client fights over. */
    readonly yard: {
      readonly buildingdata: BuildingDataMap;
      readonly buildinghealthdata: BuildingHealthData;
      readonly resources: JsonObject;
    };
    /** The player's bunkers, academy levels and caged champion. */
    readonly defence: DefenderForces;
  };
}

/** The open raid's plan, as the warning stored it. */
const planOf = (raid: OpenRaid): RaidPlan => raid.plan as RaidPlan;

export const raidView = (raid: OpenRaid): RaidView => ({
  id: raid.id,
  phase: raid.phase,
  tribe: raid.tribe,
  monsters: planOf(raid).army,
  attackAt: raid.attackAt,
  warned: raid.warned,
  ...(raid.phase === "fighting" && raid.startedAt !== undefined
    ? { startedAt: raid.startedAt, finishFrom: earliestFinish(raid.startedAt, raid.fightSeconds ?? 0) }
    : {}),
});

/**
 * Columns the due rule's gates read before the yard's buildings: the
 * schedule's, and the attack's for `underAttack`.
 */
const SCHEDULE_FIELDS = [
  "basesaveid",
  "userid",
  "type",
  "mapversion",
  "points",
  "basevalue",
  "aiattacks",
  "attackid",
  "attacks",
] as const;

/** A fresh 31-bit seed for a raid (§3). */
const newSeed = (): number => randomInt(1, 2 ** 31);

/** Tells the bell what a catch-up finished; never fails the raid. */
const notifyJobs = async (em: EntityManager, userid: number, completed: readonly CompletedJob[]): Promise<void> => {
  if (completed.length > 0) await notifyAndCount(em, userid, null, "jobs", completed);
};

/**
 * The presence ping's part (§4.2, §7.3): the open raid if there is one;
 * otherwise, when the ping says "yard, Planner closed" and a raid is due, a
 * new one opened in its warning.
 *
 * Cheap on most pings: the open raid is one Redis read, and every gate but
 * the damage one (level, sessions, time, under attack, online, an in-game
 * check pending) reads the presence marks and a handful of columns. Only a
 * raid that is otherwise due reads the yard, and brings it up to date under
 * its row lock (the repairs that finished, the harvesters) before the due
 * rule's damage check and the plan. A yard the catch-up would leave damaged
 * (a building not repairing, or a repair not done yet) is not caught up on
 * every ping only to be found damaged.
 *
 * @param em - The request's entity manager.
 * @param user - The caller.
 * @param screen - What the ping said the player is looking at; null for a ping with no body.
 * @param now - Unix seconds.
 * @returns The raid to show, or undefined.
 */
export const raidOnPing = async (
  em: EntityManager,
  user: User,
  screen: RaidScreen | null,
  now: number
): Promise<RaidView | undefined> => {
  const open = await readOpenRaid(user.userid);
  if (open) return raidView(open);
  if (screen?.where !== "yard" || screen.planner) return undefined;
  const basesaveid = user.save?.basesaveid;
  if (basesaveid == null) return undefined;

  const [scheduled, marks] = await Promise.all([
    em.findOne(Save, { basesaveid }, { fields: [...SCHEDULE_FIELDS], refresh: true }),
    readPresenceMarks(user.userid, now),
  ]);
  if (!scheduled || scheduled.userid !== user.userid) return undefined;
  // No buildings in this slice, so the damage gate waits for the full read.
  const early = raidDueCheck({
    save: { type: scheduled.type, mapversion: scheduled.mapversion, points: scheduled.points, basevalue: scheduled.basevalue, aiattacks: scheduled.aiattacks },
    now,
    marks,
    screen,
    underAttack: isAttackActive(scheduled),
    raidOpen: false,
  });
  if (early !== null) return undefined;

  const stored = await em.findOne(Save, { basesaveid }, { refresh: true });
  if (!stored) return undefined;
  if (!repairsDoneBy(stored, Number(stored.savetime), now)) return undefined;

  const { save, completed } = await catchUpLockedYard(em, stored);
  await notifyJobs(em, user.userid, completed);
  if ((await raidDueNow(user.userid, save, now)) !== null) return undefined;

  const seed = newSeed();
  const plan = planRaid({
    buildingdata: save.buildingdata ?? {},
    buildinghealthdata: save.buildinghealthdata ?? null,
    resources: (save.resources ?? null) as RaidFightInput["resources"],
    level: playerLevelOf(save),
    preference: readSchedule(save.aiattacks).attackPreference,
    seed,
  });
  if (!plan) return undefined;

  const raid: OpenRaid = {
    id: newRaidId(),
    phase: "warning",
    tribe: plan.tribe,
    plan,
    seed,
    attackAt: now + WARNING_SECONDS,
    warned: 0,
  };
  if (!(await openRaid(user.userid, raid, now))) {
    const other = await readOpenRaid(user.userid);
    return other ? raidView(other) : undefined;
  }
  logger.info("Wild monster raid {id} warned for userid {userid}: {tribe}", {
    event: "wild-raid-warning",
    userid: user.userid,
    id: raid.id,
    tribe: plan.tribe,
    seed,
    bearing: plan.bearing,
    army: JSON.stringify(plan.army),
  });
  return raidView(raid);
};

/** The open raid with this id, in its warning; refused otherwise. */
const openWarning = async (userid: number, raidId: unknown): Promise<OpenRaid> => {
  if (typeof raidId !== "string") throw raidRefusedErr("badRequest");
  const raid = await readOpenRaid(userid);
  if (!raid || raid.id !== raidId) throw raidRefusedErr("noRaid");
  if (raid.phase !== "warning") throw raidRefusedErr("notWarning");
  return raid;
};

/** Rewrites the open raid, refused when it went in the meantime. */
const rewrite = async (userid: number, raid: OpenRaid, now: number): Promise<RaidView> => {
  if (!(await updateOpenRaid(userid, raid, now))) throw raidRefusedErr("noRaid");
  return raidView(raid);
};

/** "Engage now" (`AIATTACKPOPUP.as:139-143`): the fight is due now. */
export const engageRaid = async (userid: number, raidId: unknown, now: number): Promise<RaidView> => {
  const raid = await openWarning(userid, raidId);
  return rewrite(userid, { ...raid, attackAt: Math.min(raid.attackAt, now) }, now);
};

/** "Prepare defences" (`AIATTACKPOPUP.as:53-60`): the top bar counts down to `attackAt`. */
export const prepareRaid = async (userid: number, raidId: unknown, now: number): Promise<RaidView> => {
  const raid = await openWarning(userid, raidId);
  return rewrite(userid, { ...raid, warned: 1 }, now);
};

/** The caller's main yard, locked, or refused. */
const lockMain = async (tx: EntityManager, user: User): Promise<Save> => {
  const basesaveid = user.save?.basesaveid;
  if (basesaveid == null) throw raidRefusedErr("notMainYard");
  const locked = await tx.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
  if (!locked || locked.type !== BaseType.MAIN || locked.userid !== user.userid) throw raidRefusedErr("notMainYard");
  return locked;
};

/** What the start fights over: the yard as it stood, and its defence. */
interface FrozenYard {
  readonly yard: RaidStart["fight"]["yard"];
  readonly defence: DefenderForces;
}

/**
 * How long the start's provisional fight lock holds the yard while the fight
 * runs: the worker's deadline, and a margin for the second transaction.
 */
export const START_LOCK_SECONDS = Math.ceil(FINALISE_REPLAY_DEADLINE_MS / 1000) + 10;

/**
 * The start's first transaction: the yard brought up to date and copied for
 * the fight, and held for it by a provisional fight lock (`raidLock.ts`), so
 * nothing changes it while the fight runs outside any transaction.
 */
const freezeYard = async (em: EntityManager, user: User, raid: OpenRaid, now: number): Promise<FrozenYard> => {
  let completed: CompletedJob[] = [];
  const frozen = await em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    if (isAttackActive(locked)) throw raidRefusedErr("underAttack");
    // A second start of this raid, sent before the first answered: both read
    // the warning, but the first already holds the yard.
    if (readFightLock(readSchedule(locked.aiattacks).fight)?.id === raid.id && raidFighting(locked, now)) {
      throw raidRefusedErr("notWarning");
    }
    completed = await catchUpLockedRow(tx, locked, now);

    const yard = structuredClone({
      buildingdata: locked.buildingdata ?? {},
      buildinghealthdata: locked.buildinghealthdata ?? {},
      resources: locked.resources ?? {},
    });
    const defence = defenderForcesOf({ buildingdata: yard.buildingdata, academy: locked.academy, champion: locked.champion });
    locked.aiattacks = scheduleColumn(
      withFightLock(readSchedule(locked.aiattacks), { id: raid.id, until: now + START_LOCK_SECONDS })
    );
    await tx.flush();
    return { yard, defence };
  });
  await notifyJobs(em, user.userid, completed);
  return frozen;
};

/** How the start's second transaction went. */
type FightLocked = "locked" | "lapsed" | "lifted" | "raidGone";

/**
 * The start's second transaction: the provisional lock made the fight's own,
 * lasting the fight and its grace, and the open raid moved to its fight. The
 * lock may have gone meanwhile: lifted by a yard load (`startSession`), or
 * lapsed. Any outcome but "locked" leaves the yard unlocked.
 */
const lockForFight = (em: EntityManager, user: User, fighting: OpenRaid, now: number): Promise<FightLocked> =>
  em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    const schedule = readSchedule(locked.aiattacks);
    if (readFightLock(schedule.fight)?.id !== fighting.id) return "lifted";

    let outcome: FightLocked = "lapsed";
    if (raidFighting(locked, getCurrentDateTime())) {
      outcome = (await updateOpenRaid(user.userid, fighting, now)) ? "locked" : "raidGone";
    }
    locked.aiattacks = scheduleColumn(
      outcome === "locked"
        ? withFightLock(schedule, {
            id: fighting.id,
            until: now + Math.ceil(fighting.fightSeconds ?? 0) + FIGHT_GRACE_SECONDS,
          })
        : withoutFightLock(schedule)
    );
    await tx.flush();
    return outcome;
  });

/**
 * The fight's start (§4.2), in two short transactions with the fight between
 * them, outside any: the yard brought up to date, copied and held by a
 * provisional fight lock (`freezeYard`); the fight run once in a worker on
 * the copy; then the lock made the fight's and the outcome kept with the open
 * raid, never sent (`lockForFight`). The client is handed what it needs to
 * play the same fight.
 *
 * A raid whose time has not come is refused (`notYet`), as is one on a yard
 * under attack (`underAttack`: it waits, §4.1), and a second start of a raid
 * already starting (`notWarning`). With no replay slot free, or a fight the
 * worker could not finish in time, it is `503 busy` and the raid stays in its
 * warning. A yard load during the fight cancels it, as a load cancels any
 * fight: the start is refused `noRaid` and the raid is called off.
 */
export const startRaid = async (em: EntityManager, user: User, raidId: unknown, now: number): Promise<RaidStart> => {
  const raid = await openWarning(user.userid, raidId);
  if (now < raid.attackAt) throw raidRefusedErr("notYet", { attackAt: raid.attackAt });
  const plan = planOf(raid);

  // The slot before the yard is touched: a server too busy to fight says so
  // at once, as an auto-attack's does (`reserveReplaySlot`).
  const release = await reserveReplaySlot();
  if (!release) throw raidRefusedErr("busy");
  let start: RaidStart;
  try {
    const { yard, defence } = await freezeYard(em, user, raid, now);
    let outcome: RaidFightOutcome;
    try {
      outcome = await fightRaidInWorker({
        buildingdata: yard.buildingdata,
        buildinghealthdata: yard.buildinghealthdata,
        resources: yard.resources as RaidFightInput["resources"],
        log: plan.log,
        defence,
      });
    } catch (err) {
      // Left alone, the lock would lapse by itself; the fight's error is the answer.
      await unlockYard(em, user, raid.id).catch((unlockErr: unknown) =>
        logger.warn(`Wild monster raid ${raid.id} could not unlock its yard: ${(unlockErr as Error).message}`)
      );
      if (err instanceof ReplayTimeoutError) throw raidRefusedErr("busy");
      throw err;
    }

    const fightSeconds = fightSecondsOf(outcome);
    const fighting: OpenRaid = { ...raid, phase: "fighting", startedAt: now, fightSeconds, outcome };
    switch (await lockForFight(em, user, fighting, now)) {
      case "lapsed":
        throw raidRefusedErr("busy");
      case "lifted":
        // The load that lifted it found the raid still in its warning.
        if ((await readOpenRaid(user.userid))?.id === raid.id) await cancelOpenRaid(user.userid);
        throw raidRefusedErr("noRaid");
      case "raidGone":
        throw raidRefusedErr("noRaid");
    }
    start = {
      raid: raidView(fighting),
      fight: {
        seed: plan.log.seed,
        events: plan.log.events,
        tick: outcome.ticks,
        seconds: fightSeconds,
        yard,
        defence,
      },
    };
  } finally {
    release();
  }
  logger.info("Wild monster raid {id} started for userid {userid}", {
    event: "wild-raid-start",
    userid: user.userid,
    id: raid.id,
    tick: start.fight.tick,
  });
  return start;
};

/** Lifts the yard's fight lock for a raid that will not land. */
const unlockYard = (em: EntityManager, user: User, raidId: string): Promise<void> =>
  em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    const schedule = readSchedule(locked.aiattacks);
    if (readFightLock(schedule.fight)?.id !== raidId) return;
    locked.aiattacks = scheduleColumn(withoutFightLock(schedule));
    await tx.flush();
  });

/**
 * The finish (§4.2, §7.1): the raid taken out of Redis exactly once, then
 * landed on the caught-up yard under its row lock (`raidLanding.ts`).
 *
 * - A finish sooner than the fight could be watched at 2x is refused
 *   (`tooEarly`, with `readyAt`); the raid stays open until it times out.
 * - With no presence mark from the last 120 s the game was closed during the
 *   fight: the raid is cancelled (`cancelled`), nothing lands, the yard is
 *   unlocked and the raid is still due.
 * - A finish for a raid that already landed answers what it landed, so a
 *   client that lost the first answer can ask again.
 */
export const finishRaid = async (em: EntityManager, user: User, raidId: unknown, now: number): Promise<RaidResult> => {
  if (typeof raidId !== "string") throw raidRefusedErr("badRequest");
  const taken = await takeRaidForFinish(user.userid, raidId, now);
  switch (taken.kind) {
    case "gone": {
      const basesaveid = user.save?.basesaveid;
      const save = basesaveid == null ? null : await em.findOne(Save, { basesaveid }, { fields: ["aiattacks"], refresh: true });
      const landed = save ? landedResult(save.aiattacks, raidId) : null;
      if (landed) return landed;
      throw raidRefusedErr("noRaid");
    }
    case "notFighting":
      throw raidRefusedErr("notFighting");
    case "tooEarly":
      throw raidRefusedErr("tooEarly", { readyAt: taken.readyAt });
    case "cancelled":
      await unlockYard(em, user, raidId);
      logger.info("Wild monster raid {id} cancelled for userid {userid}: presence lost", {
        event: "wild-raid-cancelled",
        userid: user.userid,
        id: raidId,
      });
      throw raidRefusedErr("cancelled");
  }

  const raid = taken.raid;
  const outcome = raid.outcome as RaidFightOutcome;
  let completed: CompletedJob[] = [];
  const result = await em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    if (raidAlreadyApplied(readSchedule(locked.aiattacks), raid.id)) {
      const landed = landedResult(locked.aiattacks, raid.id);
      if (!landed) throw raidRefusedErr("noRaid");
      return landed;
    }
    completed = await catchUpLockedRow(tx, locked, now);
    const landed = landRaid(locked, { id: raid.id, tribe: raid.tribe, startedAt: raid.startedAt ?? now, outcome }, now);
    await tx.flush();
    return landed;
  });
  await notifyJobs(em, user.userid, completed);

  const plan = planOf(raid);
  logger.info("Wild monster raid {id} landed for userid {userid}: {tribe}, health {health}", {
    event: "wild-raid",
    userid: user.userid,
    id: raid.id,
    tribe: raid.tribe,
    seed: raid.seed,
    bearing: plan.bearing,
    army: JSON.stringify(plan.army),
    startedAt: raid.startedAt,
    tick: outcome.ticks,
    digest: outcome.digest,
    health: result.health,
    defended: result.defended,
    stolen: JSON.stringify(result.stolen),
    shiny: result.shiny,
    damaged: result.damaged.length,
  });
  return result;
};

/**
 * The frequency popup's choice (`WMATTACK.as:978-1008`): more, same or less
 * often from now on, which also sizes the next army and its hits.
 */
export const setRaidPreference = (
  em: EntityManager,
  user: User,
  preference: RaidPreference
): Promise<{ preference: RaidPreference; nextAttack: number | null }> =>
  em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    const schedule = setRaidFrequency(readSchedule(locked.aiattacks), preference);
    locked.aiattacks = scheduleColumn(schedule);
    await tx.flush();
    return { preference: schedule.attackPreference, nextAttack: schedule.nextAttack ?? null };
  });

/**
 * DEV only (`app.routes.ts` mounts it on a local server alone): makes a raid
 * due now, for testing the screens (WP4). The yard must still be whole, the
 * player level 9 or more and the ping must say "yard, Planner closed".
 */
export const makeRaidDue = (em: EntityManager, user: User, now: number): Promise<{ nextAttack: number }> =>
  em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    const schedule = readSchedule(locked.aiattacks);
    locked.aiattacks = scheduleColumn({
      ...schedule,
      sessionsSinceLastAttack: Math.max(schedule.sessionsSinceLastAttack, SESSIONS_BETWEEN_RAIDS),
      nextAttack: now,
    });
    await tx.flush();
    return { nextAttack: now };
  });
