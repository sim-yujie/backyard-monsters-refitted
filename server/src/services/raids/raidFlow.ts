import { randomInt } from "node:crypto";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import { Maproom } from "../../database/models/maproom.model.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { raidRefusedErr } from "../../errors/errors.js";
import { defenderForcesOf, type DefenderForces, type RaidEvent, type Roster } from "../../game-rules/combat/index.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { extractTownHall } from "../../utils/extractTownHall.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { clearEmergencePending, emergenceHoldsRaids } from "../inferno/emergenceOnLoad.js";
import { isEmergenceRaid, MOLOCH_TRIBE } from "../inferno/emergenceRaid.js";
import { noteTribeRaid } from "../stats/activity.js";
import { catchUpLockedRow, catchUpLockedYard } from "../../controllers/yard/yardAction.js";
import { notifyAndCount } from "../notifications/notifications.js";
import { playerLevelOf } from "../base/calculateBaseLevel.js";
import { isAttackActive } from "../base/isAttackActive.js";
import {
  FINALISE_REPLAY_DEADLINE_MS,
  ReplayTimeoutError,
  fightRaidInWorker,
  AUTO_ATTACK_SLOT_WAIT_MS,
  reserveReplaySlot,
} from "../base/combat/replayRunner.js";
import type { CompletedJob } from "../yard/catchUp.js";
import { recordQuests } from "../quests/state.js";
import { repairsDoneBy } from "../yard/catchUpRepairs.js";
import { readPresenceMarks } from "../user/online.js";
import { fightSecondsOf, type RaidFightInput, type RaidFightOutcome } from "./raidFight.js";
import { landRaid, landedResult, type RaidResult } from "./raidLanding.js";
import { raidFighting, readFightLock } from "./raidLock.js";
import { planRaid, type RaidPlan } from "./raidPlan.js";
import {
  RAID_MIN_GAP_SECONDS,
  SESSIONS_BETWEEN_RAIDS,
  boughtProtection,
  raidAlreadyApplied,
  raidDueCheck,
  raidDueNow,
  readSchedule,
  scheduleColumn,
  setRaidFrequency,
  withFightLock,
  withRaidOpened,
  withoutFightLock,
  TROJAN_TRIBE,
  type RaidPreference,
} from "./raidSchedule.js";
import { mr1RaidCamps, type RaidCamp } from "./raidTribe.js";
import {
  FIGHT_GRACE_SECONDS,
  WARNING_SECONDS,
  checkRaidForFinish,
  dropOpenRaid,
  earliestFinish,
  keepLandedResult,
  newRaidId,
  openRaid,
  readLandedResult,
  readOpenRaid,
  updateOpenRaid,
  type OpenRaid,
  type RaidScreen,
} from "./raidStore.js";
import { countAfterCommit } from "../alliance/allianceProgress.js";

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
  /** The threat it comes at (beta 10); absent for a raid that has none (Trojan, Moloch, older). */
  readonly threat?: number;
  /** How many sides it lands from (beta 10); absent 1. */
  readonly sides?: number;
  /** The wild champion it brings (beta 10): type 1-4 and level. */
  readonly champion?: { readonly t: number; readonly l: number };
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

export const raidView = (raid: OpenRaid): RaidView => {
  // An open raid from before beta 10 has none of the threat's fields.
  const plan = planOf(raid) as Partial<RaidPlan>;
  return {
    id: raid.id,
    phase: raid.phase,
    tribe: raid.tribe,
    monsters: plan.army ?? {},
    attackAt: raid.attackAt,
    warned: raid.warned,
    ...(raid.phase === "fighting" && raid.startedAt !== undefined
      ? { startedAt: raid.startedAt, finishFrom: earliestFinish(raid.startedAt, raid.fightSeconds ?? 0) }
      : {}),
    ...(typeof plan.threat === "number" ? { threat: plan.threat } : {}),
    ...(Array.isArray(plan.sides) && plan.sides.length > 1 ? { sides: plan.sides.length } : {}),
    ...(plan.champion ? { champion: { t: plan.champion.t, l: plan.champion.l } } : {}),
  };
};

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
  "protected",
  "storedata",
  // The Inferno emergence's pause (`emergenceHoldsRaids`).
  "thlevel",
  "tutorialstage",
] as const;

/**
 * The player's Map Room 1 camps, which pick the raiding tribe
 * (`raidTribe.ts`): none for a player on Map Room 2, who has left them behind.
 */
const raidCampsOf = async (em: EntityManager, save: Save, now: number): Promise<RaidCamp[] | null> => {
  if (Number(save.mapversion ?? MapRoomVersion.V1) !== MapRoomVersion.V1) return null;
  const maproom = await em.findOne(Maproom, { userid: save.userid });
  const townHall = extractTownHall(save.buildingdata ?? {});
  return mr1RaidCamps(townHall?.l ?? 1, playerLevelOf(save), maproom?.tribedata ?? [], now);
};

/**
 * A raid still in its warning when the player has bought protection since it
 * opened: called off, as bought protection pauses raids (owner, 2026-10-23).
 * Flash held such a raid back until the protection ended (`WMATTACK.as:304`,
 * `:317`); here a raid never outlives its warning, so it is cancelled and,
 * its schedule untouched, comes again once the protection is over. A fight
 * already started goes on. Moloch's emergence raid is not paused: Flash's
 * `UpgradePortal` never looked at protection (`emergenceRaid.ts`).
 */
const cancelWarningUnderProtection = async (em: EntityManager, user: User, raid: OpenRaid, now: number): Promise<boolean> => {
  if (raid.phase !== "warning" || isEmergenceRaid(raid)) return false;
  const basesaveid = user.save?.basesaveid;
  if (basesaveid == null) return false;
  const save = await em.findOne(Save, { basesaveid }, { fields: ["basesaveid", "protected", "storedata"], refresh: true });
  if (!save || !boughtProtection(save, now)) return false;
  if (!(await dropOpenRaid(user.userid, raid.id))) return false;
  logger.info("Wild monster raid {id} called off for userid {userid}: protection bought", {
    event: "wild-raid-protected",
    userid: user.userid,
    id: raid.id,
  });
  return true;
};

/** A fresh 31-bit seed for a raid (§3), also used to seed the Trojan Horse's fight (`trojanFight.ts`). */
export const newSeed = (): number => randomInt(1, 2 ** 31);

/** Tells the bell what a catch-up finished; never fails the raid. Shared with `trojanFight.ts`. */
export const notifyJobs = async (em: EntityManager, userid: number, completed: readonly CompletedJob[]): Promise<void> => {
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
  if (open) return (await cancelWarningUnderProtection(em, user, open, now)) ? undefined : raidView(open);
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
    save: {
      type: scheduled.type,
      mapversion: scheduled.mapversion,
      points: scheduled.points,
      basevalue: scheduled.basevalue,
      aiattacks: scheduled.aiattacks,
      protected: scheduled.protected,
      storedata: scheduled.storedata,
    },
    now,
    marks,
    screen,
    underAttack: isAttackActive(scheduled),
    raidOpen: false,
  });
  if (early !== null) return undefined;
  // Moloch's emergence holds wild raids back until its five raids are done
  // (`docs/design/inferno.md` §2.2, Flash `WMATTACK.as:327`).
  if (await emergenceHoldsRaids(em, user.userid, scheduled)) return undefined;

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
    camps: await raidCampsOf(em, save, now),
    threat: readSchedule(save.aiattacks).threat,
  });
  if (!plan) return undefined;

  // The minimum gap to the next raid starts now, kept in the save before the
  // raid opens: a reload or a lost Redis that cancels it cannot undo it.
  await em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    locked.aiattacks = scheduleColumn(withRaidOpened(readSchedule(locked.aiattacks), now));
    await tx.flush();
  });

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
    threat: plan.threat,
    sides: JSON.stringify(plan.sides ?? [plan.bearing]),
    champion: plan.champion ? JSON.stringify(plan.champion) : undefined,
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

/**
 * Rewrites the warning, refused `noRaid` when it is not the open raid in its
 * warning any more: it went, was replaced, or another tab started its fight
 * since this request read it (sol's fifth review). Nothing is written then.
 * Not `notWarning`: the client reloads the yard on that, and the load would
 * call off the fight the other tab is playing; on `noRaid` it forgets the
 * raid, and the next presence ping shows it whatever it is now.
 */
const rewrite = async (userid: number, raid: OpenRaid, now: number): Promise<RaidView> => {
  if (!(await updateOpenRaid(userid, raid, now, "warning"))) throw raidRefusedErr("noRaid");
  return raidView(raid);
};

/** The start's claim: the warning it read becomes the fight, unless it is not that warning any more. */
const claimWarning = (userid: number, raid: OpenRaid, now: number): Promise<boolean> =>
  updateOpenRaid(userid, raid, now, "warning");

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

/** The caller's main yard, locked, or refused. Shared with `trojanFight.ts`. */
export const lockMain = async (tx: EntityManager, user: User): Promise<Save> => {
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
const freezeYard = async (em: EntityManager, user: User, raid: OpenRaid, now: number): Promise<FrozenYard | null> => {
  let completed: CompletedJob[] = [];
  const frozen = await countAfterCommit(() => em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    if (isAttackActive(locked)) throw raidRefusedErr("underAttack");
    // Protection bought during the warning: the raid is called off (`startRaid`),
    // but not Moloch's (`cancelWarningUnderProtection`).
    if (boughtProtection(locked, now) && !isEmergenceRaid(raid)) return null;
    // A second start of this raid, sent before the first answered: both read
    // the warning, but the first already holds the yard.
    if (readFightLock(readSchedule(locked.aiattacks).fight)?.id === raid.id && raidFighting(locked, now)) {
      throw raidRefusedErr("notWarning");
    }
    // Another raid's fight holds the yard (a Trojan Horse sprung after this
    // start read its warning, from another tab): its lock is never taken
    // over, which would leave that fight on an unlocked yard (sol's fifth
    // review). Tried again later, the start finds its warning gone.
    if (raidFighting(locked, now)) throw raidRefusedErr("busy");
    completed = await catchUpLockedRow(tx, locked, now);

    const yard = structuredClone({
      buildingdata: locked.buildingdata ?? {},
      buildinghealthdata: locked.buildinghealthdata ?? {},
      resources: locked.resources ?? {},
    });
    // The player's own shop boosts defend too (beta.4); the raiders have none.
    const defence = defenderForcesOf({
      buildingdata: yard.buildingdata,
      academy: locked.academy,
      champion: locked.champion,
      storedata: locked.storedata,
      now,
    });
    locked.aiattacks = scheduleColumn(
      withFightLock(readSchedule(locked.aiattacks), { id: raid.id, until: now + START_LOCK_SECONDS })
    );
    await tx.flush();
    return { yard, defence };
  }));
  await notifyJobs(em, user.userid, completed);
  return frozen;
};

/** How the start's second transaction went. Shared with `trojanFight.ts`. */
export type FightLocked = "locked" | "lapsed" | "lifted" | "raidGone";

/**
 * The start's second transaction: the provisional lock made the fight's own,
 * lasting the fight and its grace, and the open raid claimed in Redis by
 * `claim` (`claimWarning` for a raid already warned; the Trojan Horse's
 * spring claims instead with `openFightingRaid`, having no warning to update,
 * `trojanFight.ts`). The lock may have gone meanwhile: lifted by a yard load
 * (`startSession`), or lapsed. Any outcome but "locked" leaves the yard
 * unlocked.
 */
export const lockForFight = (
  em: EntityManager,
  user: User,
  fighting: OpenRaid,
  now: number,
  claim: (userid: number, raid: OpenRaid, now: number) => Promise<boolean> = claimWarning
): Promise<FightLocked> =>
  em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    const schedule = readSchedule(locked.aiattacks);
    if (readFightLock(schedule.fight)?.id !== fighting.id) return "lifted";

    let outcome: FightLocked = "lapsed";
    if (raidFighting(locked, getCurrentDateTime())) {
      outcome = (await claim(user.userid, fighting, now)) ? "locked" : "raidGone";
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
 * Protection the player bought during the warning calls the raid off: the
 * start is refused `noRaid` (`cancelWarningUnderProtection`).
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
  const release = await reserveReplaySlot(AUTO_ATTACK_SLOT_WAIT_MS, { kind: "raid" });
  if (!release) throw raidRefusedErr("busy");
  let start: RaidStart;
  try {
    const frozen = await freezeYard(em, user, raid, now);
    if (!frozen) {
      await dropOpenRaid(user.userid, raid.id);
      throw raidRefusedErr("noRaid");
    }
    const { yard, defence } = frozen;
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
        await dropOpenRaid(user.userid, raid.id);
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

/** Lifts the yard's fight lock for a raid that will not land. Shared with `trojanFight.ts`. */
export const unlockYard = (em: EntityManager, user: User, raidId: string): Promise<void> =>
  em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    const schedule = readSchedule(locked.aiattacks);
    if (readFightLock(schedule.fight)?.id !== raidId) return;
    locked.aiattacks = scheduleColumn(withoutFightLock(schedule));
    await tx.flush();
  });

/**
 * The finish (§4.2, §7.1): the raid landed once on the caught-up yard under
 * its row lock (`raidLanding.ts`, {@link settleRaid}).
 *
 * - A finish sooner than the fight could be watched at 2x is refused
 *   (`tooEarly`, with `readyAt`); the raid stays open until it times out.
 * - With no presence mark from the last 120 s the game was closed during the
 *   fight: the raid is cancelled (`cancelled`), nothing lands, the yard is
 *   unlocked and the raid is still due.
 * - A finish for a raid that already landed answers what it landed, so a
 *   client that lost the first answer can ask again, and so does one whose
 *   raid the yard load landed (`settleRaidOnYardLoad`), in either order.
 */
export const finishRaid = async (em: EntityManager, user: User, raidId: unknown, now: number): Promise<RaidResult> => {
  if (typeof raidId !== "string") throw raidRefusedErr("badRequest");
  const checked = await checkRaidForFinish(user.userid, raidId, now);
  switch (checked.kind) {
    case "gone": {
      const landed = await alreadyLanded(em, user, raidId);
      if (landed) return landed;
      throw raidRefusedErr("noRaid");
    }
    case "notFighting":
      throw raidRefusedErr("notFighting");
    case "tooEarly":
      throw raidRefusedErr("tooEarly", { readyAt: checked.readyAt });
    case "cancelled": {
      const settled = await settleRaid(em, user, raidId, now, "cancel", "finish");
      if (settled.kind === "landed") return settled.result;
      if (settled.kind === "gone") throw raidRefusedErr("noRaid");
      logger.info("Wild monster raid {id} cancelled for userid {userid}: presence lost", {
        event: "wild-raid-cancelled",
        userid: user.userid,
        id: raidId,
      });
      throw raidRefusedErr("cancelled");
    }
    case "finished": {
      const settled = await settleRaid(em, user, raidId, now, "land", "finish");
      if (settled.kind === "landed") return settled.result;
      if (settled.kind === "cancelled") throw raidRefusedErr("cancelled");
      throw raidRefusedErr("noRaid");
    }
  }
};

/**
 * What a raid that already landed landed, whole when it is still kept
 * (`keepLandedResult`), or null when the row has no such raid. Read under the
 * row lock, so a landing in progress is waited for rather than missed.
 */
const alreadyLanded = async (em: EntityManager, user: User, raidId: string): Promise<RaidResult | null> => {
  if (user.save?.basesaveid == null) return null;
  const record = await em.transactional(async (tx) => landedResult((await lockMain(tx, user)).aiattacks, raidId));
  if (!record) return null;
  return (await readLandedResult(user.userid, raidId)) ?? record;
};

/** What {@link settleRaid} did. */
type RaidSettlement =
  /** The raid is landed: now, or by an earlier finish or load. */
  | { readonly kind: "landed"; readonly result: RaidResult }
  /** Called off, now or by an earlier finish (`lastCancelledId`): nothing landed. */
  | { readonly kind: "cancelled" }
  /** Neither open nor landed: it timed out or was cancelled. */
  | { readonly kind: "gone" };

/**
 * Lands (or, with "cancel", calls off) the open raid `raidId`, once: the one
 * place a raid is settled, by the finish and by the yard load alike (patch
 * 7.5, sol's second review). Everything is decided under the main yard's row
 * lock: whether the row has landed it already, then the open raid as Redis
 * has it now. The raid leaves Redis only after the row is written, so:
 *
 * - whichever of a finish and a load takes the lock first lands it, and the
 *   other finds it landed and answers the same result;
 * - a landing that fails (the database) leaves the raid open, for the next
 *   finish or load to land;
 * - keeping the whole result for a late finish (`keepLandedResult`) is extra:
 *   if Redis refuses it the landing still stands, and a late finish answers
 *   the record `recent` keeps.
 */
const settleRaid = async (
  em: EntityManager,
  user: User,
  raidId: string,
  now: number,
  how: "land" | "cancel",
  via: "finish" | "load"
): Promise<RaidSettlement> => {
  let completed: CompletedJob[] = [];
  let landedNow: { raid: OpenRaid; outcome: RaidFightOutcome } | null = null;
  const settled = await countAfterCommit(() =>
    em.transactional(async (tx): Promise<RaidSettlement> => {
      const locked = await lockMain(tx, user);
      const schedule = readSchedule(locked.aiattacks);
      if (raidAlreadyApplied(schedule, raidId)) {
        const landed = landedResult(locked.aiattacks, raidId);
        if (!landed) return { kind: "gone" };
        return { kind: "landed", result: (await readLandedResult(user.userid, raidId)) ?? landed };
      }
      // Called off already: a retry that finds it still in Redis (its drop
      // failed) never lands it (sol's third review).
      if (schedule.lastCancelledId === raidId) return { kind: "cancelled" };
      const raid = await readOpenRaid(user.userid);
      if (!raid || raid.id !== raidId || raid.phase !== "fighting") return { kind: "gone" };

      if (how === "cancel") {
        // Kept on the row, with the lock lifted, before the raid leaves Redis.
        const unlocked = readFightLock(schedule.fight)?.id === raidId ? withoutFightLock(schedule) : schedule;
        locked.aiattacks = scheduleColumn({ ...unlocked, lastCancelledId: raidId });
        await tx.flush();
        return { kind: "cancelled" };
      }

      const outcome = raid.outcome as RaidFightOutcome;
      completed = await catchUpLockedRow(tx, locked, now);
      const landed = landRaid(
        locked,
        {
          id: raid.id,
          tribe: raid.tribe,
          startedAt: raid.startedAt ?? now,
          outcome,
          ...(typeof (planOf(raid) as Partial<RaidPlan>).threat === "number" ? { threat: planOf(raid).threat } : {}),
        },
        now
      );
      // Quests: a wild monster raid held off (the raid's own good defence, the
      // one that pays Shiny; not the Trojan Horse or Moloch) is a held defence
      // for the weekly Fighting quest, on the locked main row.
      if (landed.defended && raid.tribe !== TROJAN_TRIBE && raid.tribe !== MOLOCH_TRIBE) {
        recordQuests(locked, now, { defenceWin: 1 });
      }
      // Moloch's stage is played once its raid lands: the next load stops
      // playing it again, and the next rise's 23 hours count from now
      // (patch 7.12, `emergenceOnLoad.ts`). In this
      // transaction, so the two are written together.
      if (raid.tribe === MOLOCH_TRIBE) {
        const stage = Number((raid.plan as { level?: unknown } | null | undefined)?.level);
        if (Number.isInteger(stage)) await clearEmergencePending(tx, user.userid, stage, now);
      }
      // Kept before the row lock goes, so a finish waiting on it finds it
      // whole; never at the cost of the landing itself.
      await keepLandedResult(user.userid, landed).catch((err: unknown) =>
        logger.warn(`Wild monster raid ${raid.id}'s result not kept for a late finish: ${(err as Error).message}`)
      );
      await tx.flush();
      landedNow = { raid, outcome };
      return { kind: "landed", result: landed };
    })
  );
  if (settled.kind === "gone") return settled;
  // Written: the raid may leave Redis now. Should that fail, the row says it
  // landed or was called off, so whatever finds it next answers that.
  await dropOpenRaid(user.userid, raidId).catch((err: unknown) =>
    logger.warn(`Wild monster raid ${raidId} not dropped after it settled: ${(err as Error).message}`)
  );
  if (settled.kind === "cancelled") return settled;
  const fresh = landedNow as { raid: OpenRaid; outcome: RaidFightOutcome } | null;
  if (!fresh) return settled;

  await notifyJobs(em, user.userid, completed);
  noteTribeRaid();
  const { raid, outcome } = fresh;
  const result = settled.result;
  const plan = planOf(raid);
  logger.info("Wild monster raid {id} landed for userid {userid}: {tribe}, health {health}", {
    event: "wild-raid",
    userid: user.userid,
    id: raid.id,
    tribe: raid.tribe,
    via,
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
    threat: result.threat,
    nextThreat: result.nextThreat,
  });
  return settled;
};

/** What {@link settleRaidOnYardLoad} did. */
export interface YardLoadRaid {
  /** What is landed for the fight this load came back from, by this load or before it, for the load's answer. */
  readonly landed: RaidResult | null;
  /**
   * A fight whose landing failed here: left open for its finish, so the
   * load's cancel (`cancelRaidOnYardLoad`) must leave it alone.
   */
  readonly keep?: string;
}

/**
 * A wild monster raid on an own-main-yard build load (patch 7.5), before the
 * load's catch-up reads the yard: a fight the finish could already land
 * (from `earliestFinish`, the moment `tooEarly` ends) is landed here, as its
 * finish would have landed it, when the game was open. So a player who comes
 * back to the yard while the finish is still on its way (a slow line, a
 * server that answered late, "Back to yard") loses nothing: the yard opens
 * with the raid landed, the load answers its result, and the finish that
 * arrives afterwards answers the same result (`finishRaid`). A finish that
 * takes the yard's lock first lands it instead, and the load answers that.
 *
 * Anything else is left for `cancelRaidOnYardLoad` after the catch-up, as
 * before: a warning, a fight left before it could have been watched at 2x (a
 * reload during the fight, owner Q1), and any fight when the game had been
 * closed (presence lapsed: the finish would have cancelled it too). A
 * landing that fails here (the database) keeps the fight open (`keep`) for
 * its finish to land, rather than losing it.
 *
 * Nothing comes from the client: the outcome is the server's own, fought at
 * the start, so landing it here gives nothing a finish would not.
 *
 * @param gameWasClosed - `presenceLapsed`, read before this load wrote the mark.
 */
export const settleRaidOnYardLoad = async (
  em: EntityManager,
  user: User,
  gameWasClosed: boolean,
  now: number
): Promise<YardLoadRaid> => {
  if (gameWasClosed) return { landed: null };
  const open = await readOpenRaid(user.userid);
  if (!open || open.phase !== "fighting" || open.startedAt === undefined) return { landed: null };
  if (now < earliestFinish(open.startedAt, open.fightSeconds ?? 0)) return { landed: null };
  try {
    const settled = await settleRaid(em, user, open.id, now, "land", "load");
    return { landed: settled.kind === "landed" ? settled.result : null };
  } catch (err) {
    logger.warn(`Wild monster raid ${open.id} not landed on load for user ${user.userid}: ${(err as Error).message}`);
    return { landed: null, keep: open.id };
  }
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
 * player level 9 or more and the ping must say "yard, Planner closed". The
 * minimum gap since the last raid is waived too.
 */
export const makeRaidDue = (em: EntityManager, user: User, now: number): Promise<{ nextAttack: number }> =>
  em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    const { lastOpenedAt: _lastOpenedAt, ...schedule } = readSchedule(locked.aiattacks);
    locked.aiattacks = scheduleColumn({
      ...schedule,
      lastattack: Math.min(schedule.lastattack, now - RAID_MIN_GAP_SECONDS),
      sessionsSinceLastAttack: Math.max(schedule.sessionsSinceLastAttack, SESSIONS_BETWEEN_RAIDS),
      nextAttack: now,
    });
    await tx.flush();
    return { nextAttack: now };
  });
