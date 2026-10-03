import { RequestContext } from "@mikro-orm/core";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { buildingDataHandler } from "../../controllers/base/save/handlers/buildingDataHandler.js";
import { defenderLootHandler } from "../../controllers/base/save/handlers/defenderLootHandler.js";
import { isDeclareWarRunning } from "../alliance/powerups.js";
import { protectAfterAttack } from "../maproom/v2/damageProtection.js";
import { noticeOutpostAttack } from "../maproom/v2/outpostNotices.js";
import { afterYardDefended } from "./afterYardDefended.js";
import { isMR3Structure } from "../maproom/v3/utils/isMR3Structure.js";
import { advanceBuildingTimers } from "./advanceBuildingTimers.js";
import { checkpointExpired, checkpointSession, type AttackCheckpoint } from "./attackCheckpoint.js";
import {
  acquireFinalLock,
  discardCheckpoint,
  listCheckpoints,
  readCheckpoint,
  releaseFinalLock,
} from "./attackCheckpointStore.js";
import { endAttackSession } from "./attackSessionStore.js";
import { buildingDataWithout, spendFlung, type SourceCell } from "./combat/abandonedAttack.js";
import { battleReplayInput, foughtLoot } from "./combat/battle.js";
import { replayAbandonedInWorker } from "./combat/replayRunner.js";
import { attackLootOf, bankAttackLoot } from "./combat/attackLoot.js";
import { bombSpendOf, catapultLevelOf, chargeBombSpend } from "./combat/bombSpend.js";
import { combatCellHeight } from "./combat/cellHeight.js";
import { garrisonsAfterBattle } from "./combat/bunkerGarrison.js";
import { championsAfterDefence } from "./combat/defenderChampion.js";
import { championsAfterLessons } from "./combat/championBrain.js";
import { landHousingLoss, lostCount, reportWithHousingLoss } from "./combat/housingLoss.js";
import { getHousingOwner, getOutpostOwnerSave } from "./getOutpostOwnerSave.js";
import { storedDamage } from "./storedDamage.js";
import { catchUpArmyRow } from "../yard/armies.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import type { FlingLog, ResourceAmounts } from "../../game-rules/combat/index.js";
import type { AbandonedOutcome } from "./combat/abandonedAttack.js";
import { recordAttackPlan } from "./autoAttack/attackPlanStore.js";

/**
 * Finishes an attack its attacker left without saving (issue #138).
 *
 * Leaving the attack screen in any way ends the battle at that moment with
 * its results standing. The web client sends its final save as the page goes
 * (`web/src/game/attack/plugins/end.ts`), but a killed browser, a crash or a
 * lost connection sends nothing, and an attack session that simply expired
 * used to hand the attacker everything back. So the server finishes it from
 * the last checkpoint (`attackCheckpoint.ts`): the replay in
 * `combat/abandonedAttack.ts` derives what the save would have carried, and
 * this writes it the way `baseSave.ts` writes an attack save that carries
 * `over` — flung monsters out of the attacker's cells, bombs charged
 * (`combat/bombSpend.ts`), loot credited, the defender's damage, loss, fired
 * traps and report written, protection granted, the row's `attackid` cleared
 * and the session ended.
 *
 * The loot is the final save's own (issues #163, #165): the battle is fought
 * over the pool the attack load served, at the level it served, with only
 * what the attacker could have flung (`fightableLog`), and its result goes
 * through the save's loot rule (`attackLootOf`) as an honest client's save
 * would. So leaving an attack earns exactly what finishing it at the same
 * moment would, however the stored pool moved meanwhile (an outpost's owner
 * autobanking, say). The load's record of the battle comes from the
 * checkpoint's copy, since the session itself is gone a minute after the
 * attack's window.
 *
 * When it runs:
 *
 * - on the attacker's next yard load and before their next attack starts
 *   (`baseLoad.ts`), whether or not the session window has closed: the
 *   attacker has plainly left that battle;
 * - on the defender's own yard load, and before anyone else attacks the same
 *   row, once the window has closed (the attacker could still save before);
 * - from a sweep every minute, once the window has closed.
 *
 * Exactly once: the final save and this take the same lock
 * (`acquireFinalLock`), and each ends the attack session or drops the
 * checkpoint before letting go, so whichever comes second finds nothing to do.
 */

export type FinaliseOutcome = "finalised" | "none" | "busy" | "stale";

/** How an attack is landed from its checkpoint. */
export interface LandOptions {
  /**
   * Whether the report says the attacker left: true (the default) for an
   * attack its attacker abandoned; false for an auto-attack, which nobody left.
   */
  readonly left?: boolean;
  /**
   * Whether the landed attack becomes the attacker's plan for the camp's tribe
   * and level (issue #221): true (the default) for an attack played by hand,
   * false for an auto-attack, which only ever repeats one.
   */
  readonly recordPlan?: boolean;
}

/** What landing an attack wrote, for an auto-attack's result (issue #221). */
export interface LandedAttack {
  /** The replay's outcome: damage, health, flung, champions, report. */
  readonly outcome: AbandonedOutcome;
  /** The defender's stored damage before and after, whole (#72). */
  readonly damageBefore: number;
  readonly damageAfter: number;
  /** What the loot rule credited the attacker, before the storage cap. */
  readonly credit: ResourceAmounts;
  /** What landed in the attacker's pool, and what did not fit. */
  readonly credited: ResourceAmounts;
  readonly overflow: ResourceAmounts;
  /** The bombs charged, by id. */
  readonly bombs: readonly string[];
  /** The log the replay fought (`fightableLog`), and the tick it ran to. */
  readonly fought: FlingLog;
  readonly tick: number;
}

/** A finalisation's answer, with what it landed when it landed anything. */
export interface Finalised {
  readonly status: FinaliseOutcome;
  readonly landed?: LandedAttack;
}

/** How often the sweep looks for expired attacks. */
export const FINALISE_SWEEP_MS = 60_000;


/**
 * The attacker's source cells, each caught up to now (monsters only,
 * `services/yard/armies.ts`) so what hatched during the attack stays: the
 * main yard's housing lives on the main save, every other cell on its own
 * row, which must be theirs. A main yard whose HCC finished meanwhile also
 * gets its queue refund on `userSave.resources`.
 */
const sourceCells = async (
  checkpoint: AttackCheckpoint,
  attacker: User,
  userSave: Save,
  now: number
): Promise<{ cells: SourceCell[]; rows: Map<string, Save> }> => {
  const others = checkpoint.sources.filter((baseid) => baseid !== userSave.baseid);
  const found =
    others.length === 0
      ? []
      : await postgres.em.find(Save, { baseid: { $in: others }, saveuserid: attacker.userid });
  const rows = new Map(found.map((row) => [row.baseid, row]));

  const cells: SourceCell[] = [];
  for (const baseid of checkpoint.sources) {
    const row = baseid === userSave.baseid ? userSave : rows.get(baseid);
    if (!row) continue;
    const army = catchUpArmyRow(row, userSave, now);
    if (army.resources !== row.resources) row.resources = army.resources;
    cells.push({ baseid, m: army.monsters ?? {} });
  }
  return { cells, rows };
};

/**
 * Writes an abandoned attack's result. Runs inside its own ORM context and
 * holding the final lock.
 */
const finaliseLocked = async (basesaveid: number, trigger: string, options: LandOptions): Promise<Finalised> => {
  const checkpoint = await readCheckpoint(basesaveid);
  if (!checkpoint) return { status: "none" };

  const defender = await postgres.em.findOne(Save, { basesaveid });

  // The row has moved on: the attack was saved after all, or a new one began.
  // Nothing of this one can be written against it any more.
  if (!defender || defender.attackid !== checkpoint.attackid) {
    await discardCheckpoint(basesaveid);
    logger.warn("Abandoned attack on {basesaveid} could not be finalised: the row moved on", {
      event: "attack-finalise-stale",
      basesaveid,
      trigger,
      attackid: checkpoint.attackid,
      storedAttackId: defender?.attackid ?? null,
    });
    return { status: "stale" };
  }

  const attacker = await postgres.em.findOne(User, { userid: checkpoint.attackerid }, { populate: ["save"] });
  const userSave = attacker?.save;
  if (!attacker || !userSave) {
    await discardCheckpoint(basesaveid);
    return { status: "stale" };
  }

  const now = getCurrentDateTime();
  const outpostOwnerSave = await getOutpostOwnerSave(defender, attacker);
  const height = await combatCellHeight(defender);

  // The attack as its load recorded it: the roster, the pool and the level
  // the client fought with (`checkpointSession`).
  const session = checkpointSession(checkpoint);
  const pool = (outpostOwnerSave ?? defender).resources;

  // The same battle the attack save replays (`battle.ts`), to the moment the
  // attacker was last seen. In a worker, off the event loop (issue #23, C5): a
  // replay past its deadline throws and the checkpoint stays for the next pass.
  const input = battleReplayInput({
    flinglog: checkpoint.flinglog,
    session,
    defender: {
      type: defender.type,
      buildingdata: defender.buildingdata,
      buildinghealthdata: defender.buildinghealthdata,
      resources: pool,
      height,
    },
    attacker: userSave,
    tick: checkpoint.tick,
    declareWar: await isDeclareWarRunning(attacker.alliance_id),
    left: options.left ?? true,
  });
  if (!input) {
    await discardCheckpoint(basesaveid);
    return { status: "stale" };
  }
  const outcome = await replayAbandonedInWorker(input);

  // Both sides' loot by the final save's rule, the replay standing in for the
  // client's figures, against the rows before anything below is written (the
  // attacker's champions above all), as `baseSave.ts` reads them. The replay
  // is also the rule's bound: it fought only the fightable log, over the
  // served pool at the served level, and stopped no later than the longest
  // end, so running the battle again to that end could only give as much.
  const loot = attackLootOf({
    sent: outcome.attackloot,
    reported: outcome.defenderDelta,
    flinglog: checkpoint.flinglog,
    session,
    defender: {
      type: defender.type,
      buildingdata: defender.buildingdata,
      buildinghealthdata: defender.buildinghealthdata,
      resources: pool,
      height,
    },
    attacker: userSave,
    mapRoom3: userSave.mapversion === MapRoomVersion.V3,
    fought: foughtLoot(outcome),
  });

  // The attacker: what was flung leaves its cells for good, and the rest of
  // the attacker's keys land as the save would land them (`baseSave.ts`).
  const { cells, rows } = await sourceCells(checkpoint, attacker, userSave, now);
  const { updates, unpaid } = spendFlung(cells, outcome.flung);
  for (const update of updates) {
    if (update.baseid === userSave.baseid) {
      userSave.monsters = update.m;
      continue;
    }
    const row = rows.get(update.baseid);
    if (!row) continue;
    row.protected = 0;
    row.monsters = update.m;
    postgres.em.persist(row);
  }
  if (Object.keys(unpaid).length > 0) {
    logger.warn("Abandoned attack on {basesaveid} flung monsters its cells no longer hold", {
      event: "attack-finalise-unpaid",
      basesaveid,
      attackerid: attacker.userid,
      unpaid,
    });
  }

  if (outcome.attackerchampion) userSave.champion = outcome.attackerchampion;
  // Each champion that fought learns from it, once, under the final lock (issue #219).
  userSave.champion = championsAfterLessons(userSave.champion, outcome.lessons, input.log) ?? userSave.champion;
  if (outcome.attackersiege) userSave.siege = outcome.attackersiege;

  // Priced against the pool the attack began with, as `recordBombSpend` prices a save's.
  const bombs = bombSpendOf(checkpoint.flinglog, {
    resources: session.attackerResources ?? userSave.resources,
    catapultLevel: catapultLevelOf(userSave),
  });
  // Bombs, then loot up to the attacker's storage cap, as `baseSave.ts` lands them (issue #166).
  if (bombs.charges.length > 0) userSave.resources = chargeBombSpend(bombs.spend, userSave.resources);
  const banked = bankAttackLoot(userSave, loot.credit, loot.krallenBuff);
  postgres.em.persist(userSave);

  // The defender.
  const damageBefore = defender.damage ?? 0;
  const storedHealthData = defender.buildinghealthdata;
  buildingDataHandler(buildingDataWithout(defender.buildingdata, outcome.firedTraps), defender);
  // A bunker the battle brought down loses its garrison, and each the battle
  // fought with holds what it left it, as the save's own would (issues #130,
  // #195, `bunkerGarrison.ts`); the caged champion keeps what health it has.
  defender.buildingdata = garrisonsAfterBattle(defender.buildingdata, outcome);
  defender.champion = championsAfterDefence(defender.champion, outcome.defenderChampion) ?? defender.champion;
  defender.buildinghealthdata = outcome.buildinghealthdata;
  // Whole and cut down, as the attack's own save stores it (#72).
  defender.damage = storedDamage(outcome.damage) ?? defender.damage;
  if (outcome.destroyed !== undefined) defender.destroyed = outcome.destroyed;
  // A Housing that fell takes its share of the housed monsters, the overflow
  // is culled, and the report says so, as the save lands it (issue #160,
  // `housingLoss.ts`).
  const housingLoss = landHousingLoss(
    defender,
    { before: storedHealthData, after: outcome.buildinghealthdata },
    await getHousingOwner(defender),
    now
  );
  (defender as unknown as { attackreport: unknown }).attackreport = reportWithHousingLoss(
    outcome.attackreport,
    housingLoss
  );

  const lootTarget = outpostOwnerSave ?? defender;
  defenderLootHandler(loot.defenderDelta, lootTarget);
  postgres.em.persist(lootTarget);

  const isProtectable = defender.type === BaseType.MAIN || defender.type === BaseType.OUTPOST;
  // A destroyed player outpost gives the attacker their one chance at it even
  // when the server finishes the attack (issue #182, `takeoverGrant.ts`).
  if (isProtectable && !isMR3Structure(defender.wmid)) await protectAfterAttack(defender, attacker.userid);
  // Its owner is told of an attack on an outpost however it ended (outposts WP8, #187).
  if (!isMR3Structure(defender.wmid)) {
    await noticeOutpostAttack(postgres.em, {
      outpost: defender,
      attacker,
      defenderDelta: loot.defenderDelta,
      housedLost: lostCount(housingLoss),
      now,
    });
    // And a Map Room 1 main yard's, the same; an attacked bot books its
    // repair and maybe a revenge (bot neighbours, #241).
    await afterYardDefended(postgres.em, {
      yard: defender,
      attacker,
      defenderDelta: loot.defenderDelta,
      housedLost: lostCount(housingLoss),
      now,
    });
  }

  defender.attackid = 0;
  if (defender.buildingdata) {
    defender.buildingdata = advanceBuildingTimers(defender.buildingdata, storedHealthData, now - defender.savetime);
  }
  defender.id = defender.savetime;
  defender.savetime = now;
  postgres.em.persist(defender);
  await postgres.em.flush();

  await endAttackSession(basesaveid);
  await discardCheckpoint(basesaveid);

  // An attack played by hand on a Map Room 2 camp is the attacker's plan for
  // its tribe and level from now on (issue #221); an auto-attack never is.
  if (options.recordPlan ?? true) await recordAttackPlan(attacker.userid, defender, input.log, input.tick);

  logger.info("Finalised {username}'s abandoned attack on base {baseid} at tick {tick}", {
    event: "attack-finalised",
    trigger,
    username: attacker.username,
    attackerid: attacker.userid,
    baseid: defender.baseid,
    basesaveid,
    tick: outcome.tick,
    damage: outcome.damage,
    loot: loot.credit,
    lootBasis: loot.basis,
    flung: outcome.flung,
    bunkerLosses: outcome.bunkerLosses,
    housingLosses: housingLoss?.lost ?? {},
    bombs: bombs.charges.map(({ id }) => id),
  });

  return {
    status: "finalised",
    landed: {
      outcome,
      damageBefore,
      damageAfter: defender.damage ?? 0,
      credit: loot.credit,
      credited: banked.credited,
      overflow: banked.overflow,
      bombs: bombs.charges.map(({ id }) => id),
      fought: input.log,
      tick: input.tick,
    },
  };
};

/**
 * Finishes one defender row's abandoned attack, if it has a checkpoint.
 *
 * Runs in an ORM context of its own, so it can be called from inside a
 * request without sharing — or flushing — that request's entities. A caller
 * inside a request must call it before it loads any row this may write: the
 * attacker's own save, above all.
 *
 * @param basesaveid - The defender row.
 * @param trigger - What asked, for the log line.
 */
export const finaliseAbandonedAttack = async (basesaveid: number, trigger: string): Promise<FinaliseOutcome> =>
  (await landCheckpointedAttack(basesaveid, trigger)).status;

/**
 * Lands one defender row's checkpointed attack now, as the finaliser does,
 * and says what it wrote: the finaliser's own path, which an auto-attack
 * lands through too (issue #221), with its checkpoint written by the server.
 *
 * @param basesaveid - The defender row.
 * @param trigger - What asked, for the log line.
 * @param options - How to land it ({@link LandOptions}).
 */
export const landCheckpointedAttack = (
  basesaveid: number,
  trigger: string,
  options: LandOptions = {}
): Promise<Finalised> =>
  RequestContext.create(postgres.orm.em, async () => {
    if (!(await acquireFinalLock(basesaveid))) return { status: "busy" as const };
    try {
      return await finaliseLocked(basesaveid, trigger, options);
    } finally {
      await releaseFinalLock(basesaveid);
    }
  });

/**
 * Finishes every abandoned attack `choose` picks, one at a time, logging and
 * carrying on past a failure so one bad checkpoint cannot block a load.
 */
const finaliseWhere = async (
  choose: (checkpoint: AttackCheckpoint) => boolean,
  trigger: string
): Promise<number> => {
  let finalised = 0;
  for (const { basesaveid, checkpoint } of await listCheckpoints()) {
    if (!choose(checkpoint)) continue;
    try {
      if ((await finaliseAbandonedAttack(basesaveid, trigger)) === "finalised") finalised++;
    } catch (err) {
      logger.error(`Finalising the abandoned attack on ${basesaveid} failed: ${err}`);
    }
  }
  return finalised;
};

/**
 * Before a player's yard load or attack: every attack they left without a
 * save, and — once its window has closed — every attack left on their own yard.
 *
 * @param userid - The player loading.
 * @param trigger - What asked, for the log line.
 */
export const finaliseAttacksFor = (userid: number, trigger: string): Promise<number> => {
  const now = getCurrentDateTime();
  return finaliseWhere(
    (checkpoint) =>
      checkpoint.attackerid === userid ||
      (checkpoint.defenderid === userid && checkpointExpired(checkpoint, now)),
    trigger
  );
};

/**
 * Before a new attack on a row: its previous attack, if that one's window has
 * closed without a save. Without this, the new attack's `attackid` would
 * leave the old checkpoint nothing to be written against.
 *
 * @param baseid - The row about to be attacked.
 */
export const finaliseExpiredOnBase = async (baseid: string): Promise<void> => {
  const now = getCurrentDateTime();
  const row = await RequestContext.create(postgres.orm.em, () =>
    postgres.em.findOne(Save, { baseid }, { fields: ["basesaveid"] })
  );
  if (!row?.basesaveid) return;
  const checkpoint = await readCheckpoint(row.basesaveid);
  if (checkpoint && checkpointExpired(checkpoint, now)) {
    await finaliseAbandonedAttack(row.basesaveid, "superseded");
  }
};

/**
 * What `/base/load` runs first (`baseLoad.ts`), before it reads a single row:
 * on the player's own yard load and before their next attack, every attack
 * they left without a save; before an attack, the target's previous attack if
 * it expired unsaved. Never throws — a failure here must not cost the player
 * their yard; the sweep tries again.
 *
 * @param userid - The player loading.
 * @param mode - The load's `type`.
 * @param baseid - The base being loaded.
 * @param attacking - Whether the load starts an attack.
 */
export const finaliseBeforeLoad = async (
  userid: number,
  mode: string,
  baseid: string,
  attacking: boolean
): Promise<void> => {
  try {
    await finaliseAttacksFor(userid, mode);
    if (attacking) await finaliseExpiredOnBase(baseid);
  } catch (err) {
    logger.error(`Finalising abandoned attacks before a ${mode} load failed: ${err}`);
  }
};

/** Every attack whose window has closed without a save. */
export const finaliseExpiredAttacks = (): Promise<number> => {
  const now = getCurrentDateTime();
  return finaliseWhere((checkpoint) => checkpointExpired(checkpoint, now), "expired");
};

/**
 * Starts the minute sweep. Returns the stop function.
 */
export const startAttackFinaliser = (): (() => void) => {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await finaliseExpiredAttacks();
    } catch (err) {
      logger.error(`Abandoned attack sweep failed: ${err}`);
    } finally {
      running = false;
    }
  }, FINALISE_SWEEP_MS);
  return () => clearInterval(timer);
};
