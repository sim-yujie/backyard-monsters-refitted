import { RequestContext } from "@mikro-orm/core";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { AlliancePowerupType } from "../../enums/Alliance.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { attackLootHandler } from "../../controllers/base/save/handlers/attackLootHandler.js";
import { buildingDataHandler } from "../../controllers/base/save/handlers/buildingDataHandler.js";
import { defenderLootHandler } from "../../controllers/base/save/handlers/defenderLootHandler.js";
import { runningPowerups } from "../alliance/powerups.js";
import { damageProtection } from "../maproom/v2/damageProtection.js";
import { isMR3Structure } from "../maproom/v3/utils/isMR3Structure.js";
import { advanceBuildingTimers } from "./advanceBuildingTimers.js";
import { checkpointExpired, type AttackCheckpoint } from "./attackCheckpoint.js";
import {
  acquireFinalLock,
  discardCheckpoint,
  listCheckpoints,
  readCheckpoint,
  releaseFinalLock,
} from "./attackCheckpointStore.js";
import { endAttackSession } from "./attackSessionStore.js";
import {
  buildingDataWithout,
  replayAbandonedAttack,
  type AbandonedDefender,
  spendFlung,
  type SourceCell,
} from "./combat/abandonedAttack.js";
import { bombSpendOf, catapultLevelOf, chargeBombSpend } from "./combat/bombSpend.js";
import { getOutpostOwnerSave } from "./getOutpostOwnerSave.js";
import { catchUpArmyRow } from "../yard/armies.js";

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

/** How often the sweep looks for expired attacks. */
export const FINALISE_SWEEP_MS = 60_000;

const hasDeclareWar = async (allianceId: User["alliance_id"]): Promise<boolean> =>
  (await runningPowerups(allianceId)).some(({ id }) => id === AlliancePowerupType.DECLARE_WAR);

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
const finaliseLocked = async (basesaveid: number, trigger: string): Promise<FinaliseOutcome> => {
  const checkpoint = await readCheckpoint(basesaveid);
  if (!checkpoint) return "none";

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
    return "stale";
  }

  const attacker = await postgres.em.findOne(User, { userid: checkpoint.attackerid }, { populate: ["save"] });
  const userSave = attacker?.save;
  if (!attacker || !userSave) {
    await discardCheckpoint(basesaveid);
    return "stale";
  }

  const now = getCurrentDateTime();
  const outpostOwnerSave = await getOutpostOwnerSave(defender, attacker);

  const outcome = replayAbandonedAttack({
    defender: {
      type: defender.type,
      buildingdata: defender.buildingdata,
      buildinghealthdata: defender.buildinghealthdata,
      resources: (outpostOwnerSave ?? defender).resources as AbandonedDefender["resources"],
    },
    attacker: { academy: userSave.academy, champion: userSave.champion, siege: userSave.siege },
    log: checkpoint.flinglog,
    tick: checkpoint.tick,
    declareWar: await hasDeclareWar(attacker.alliance_id),
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
  if (outcome.attackersiege) userSave.siege = outcome.attackersiege;

  // Priced against the pool before the loot, as `recordBombSpend` prices a save's.
  const bombs = bombSpendOf(checkpoint.flinglog, {
    resources: userSave.resources,
    catapultLevel: catapultLevelOf(userSave),
  });
  attackLootHandler(outcome.attackloot, userSave);
  if (bombs.charges.length > 0) userSave.resources = chargeBombSpend(bombs.spend, userSave.resources);
  postgres.em.persist(userSave);

  // The defender.
  const storedHealthData = defender.buildinghealthdata;
  buildingDataHandler(buildingDataWithout(defender.buildingdata, outcome.firedTraps), defender);
  defender.buildinghealthdata = outcome.buildinghealthdata;
  defender.damage = outcome.damage;
  if (outcome.destroyed !== undefined) defender.destroyed = outcome.destroyed;
  (defender as unknown as { attackreport: unknown }).attackreport = outcome.attackreport;

  const lootTarget = outpostOwnerSave ?? defender;
  defenderLootHandler(outcome.defenderDelta, lootTarget);
  postgres.em.persist(lootTarget);

  const isProtectable = defender.type === BaseType.MAIN || defender.type === BaseType.OUTPOST;
  if (isProtectable && !isMR3Structure(defender.wmid)) await damageProtection(defender);

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

  logger.info("Finalised {username}'s abandoned attack on base {baseid} at tick {tick}", {
    event: "attack-finalised",
    trigger,
    username: attacker.username,
    attackerid: attacker.userid,
    baseid: defender.baseid,
    basesaveid,
    tick: outcome.tick,
    damage: outcome.damage,
    flung: outcome.flung,
    bombs: bombs.charges.map(({ id }) => id),
  });

  return "finalised";
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
export const finaliseAbandonedAttack = (basesaveid: number, trigger: string): Promise<FinaliseOutcome> =>
  RequestContext.create(postgres.orm.em, async () => {
    if (!(await acquireFinalLock(basesaveid))) return "busy";
    try {
      return await finaliseLocked(basesaveid, trigger);
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
