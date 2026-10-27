import { RequestContext } from "@mikro-orm/core";

import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { ATTACK_SESSION_WINDOW } from "../base/attackSession.js";
import { replayAbandonedInWorker } from "../base/combat/replayRunner.js";
import {
  acquireInfernoPlayerFinalLock,
  countInfernoPlayerCloseFailure,
  endInfernoPlayerSession,
  listInfernoPlayerAttacks,
  readInfernoPlayerCheckpoint,
  readInfernoPlayerCloseFailures,
  readInfernoPlayerSession,
  releaseInfernoPlayerFinalLock,
  type InfernoPlayerSession,
} from "./infernoPlayerSession.js";
import { NO_LOOT, playerLoot, playerReplayInput, spendsWholeArmy, writePlayerLanding } from "./infernoPlayerLanding.js";

/**
 * Closes an Inferno player attack its attacker left without the final save
 * (`docs/design/inferno.md` §2.7; owner, 27 Oct): once `attack/start`
 * succeeds the attack is used, so nobody can fling, fail, refresh and attack
 * again for nothing. Tribes and the Descent keep their own rule (an attack
 * left unsaved lands nothing there).
 *
 * The attack lands from its last checkpoint (`/base/checkpoint`, kept in
 * `infernoPlayerSession.ts`) through the final save's own landing
 * (`infernoPlayerLanding.ts`), the battle replayed to the moment the attacker
 * was last seen, as the surface finaliser does (`finaliseAttack.ts`): the
 * monsters flung by then are spent, the damage and loot of that moment land,
 * the defender is protected by the usual rule and both revenge lists count
 * it. An attack with no battle the server can fight (no checkpoint, or none
 * usable) cannot be taken at its word that nothing was flung: a client may
 * simply withhold them. So past a short grace (`INFERNO_NO_BATTLE_GRACE`,
 * 10 s) it lands as having used its whole army: every monster committed at
 * the start is spent, no damage or loot, the defender is protected by the
 * usual rule, the revenge lists count it and the defender is told. Left
 * within the grace, as on the surface (`releaseUnfoughtAttackOf`), only the
 * yard's attack mark is cleared. Either way the session ends, so the same
 * attack can be neither saved nor started again.
 *
 * When it runs:
 * - the attacker's next yard load (`/base/load`, `/bm/inferno/load`) and next
 *   `attack/start` of any kind: they have plainly left that battle;
 * - the defender's own Inferno yard load, and an `attack/start` on that yard,
 *   once the window has closed (the attacker could still save before);
 *   a load never closes anybody else's attack;
 * - a sweep every minute, once the window (420 s: the fight's limit and a
 *   margin) has closed.
 *
 * Exactly once: the final save and this take the same lock, and whichever
 * comes second finds the session gone. A replay that fails
 * {@link INFERNO_CLOSE_ATTEMPTS} times is given up (the attack lands with no
 * battle, its army spent), and an attack that cannot land even so is released
 * after as many more: never retried for the session's 7 days.
 */

export type InfernoCloseOutcome = "landed" | "released" | "none" | "busy" | "stale";

/** Whether the attack's window has closed, so its attacker can no longer save it. */
const expired = (attack: InfernoPlayerSession, now: number): boolean =>
  now - attack.session.startedat >= ATTACK_SESSION_WINDOW;

/** How many failed closes an attack gets before it is given up. */
export const INFERNO_CLOSE_ATTEMPTS = 3;

/** Clears the yard's mark (only if it is still this attack's) and ends the session; nothing else is written. */
const release = async (basesaveid: number, attack: InfernoPlayerSession, trigger: string, event: string): Promise<void> => {
  await postgres.em.nativeUpdate(Save, { basesaveid, attackid: attack.session.attackid }, { attackid: 0 });
  await endInfernoPlayerSession(basesaveid, attack.session.attackid);
  const facts = { event, basesaveid, attackerid: attack.session.attackerid, trigger };
  if (event === "inferno-attack-released") logger.info("Released an Inferno player attack left with nothing fought", facts);
  else logger.error("Gave up closing an Inferno player attack; released it", facts);
};

const closeLocked = async (basesaveid: number, trigger: string): Promise<InfernoCloseOutcome> => {
  const em = postgres.em;
  const attack = await readInfernoPlayerSession(basesaveid);
  if (!attack) return "none";

  const yard = await em.findOne(Save, { basesaveid });
  // The row moved on (another attack holds it) or is gone: nothing of this one can land.
  if (!yard || yard.type !== BaseType.INFERNO || Number(yard.attackid) !== attack.session.attackid) {
    await endInfernoPlayerSession(basesaveid, attack.session.attackid);
    return "stale";
  }

  const now = getCurrentDateTime();
  const checkpoint = await readInfernoPlayerCheckpoint(basesaveid);
  const log = checkpoint?.attackid === attack.session.attackid ? checkpoint : null;
  const user = await em.findOne(User, { userid: attack.session.attackerid }, { populate: ["save"] });
  const input =
    log && user?.save && attack.session.entryHoused
      ? playerReplayInput(attack, yard, log.flinglog, log.tick, true)
      : null;

  // A close that keeps failing is given up, not retried until the session's
  // 7 days run out: after a few failed replays the attack lands as one with no
  // battle, and should even that keep failing, it is released.
  const failures = await readInfernoPlayerCloseFailures(basesaveid);
  if (failures >= 2 * INFERNO_CLOSE_ATTEMPTS) {
    await release(basesaveid, attack, trigger, "inferno-attack-given-up");
    return "released";
  }

  try {
    if (input && user && failures < INFERNO_CLOSE_ATTEMPTS) {
      // In a worker, off the event loop; a replay past its deadline throws and
      // the attack stays for the next pass, counted.
      const battle = await replayAbandonedInWorker(input);
      const loot = playerLoot(attack, yard, { sent: battle.attackloot, reported: battle.defenderDelta, flinglog: log!.flinglog }, battle);
      await writePlayerLanding(user, attack, yard, battle, loot, now);
      logger.info("Closed an Inferno player attack its attacker left", {
        event: "inferno-attack-closed",
        basesaveid,
        attackerid: attack.session.attackerid,
        tick: log!.tick,
        trigger,
      });
      return "landed";
    }

    // No battle to fight (no checkpoint, none usable, or a replay given up):
    // past the grace the attack is used all the same, its whole army spent
    // (`spendsWholeArmy`), so withholding checkpoints is no free retry.
    if (user?.save && (input || spendsWholeArmy(attack, now))) {
      await writePlayerLanding(user, attack, yard, null, NO_LOOT, now, true);
      logger.info("Closed an Inferno player attack left with no battle; its army is spent", {
        event: "inferno-attack-spent",
        basesaveid,
        attackerid: attack.session.attackerid,
        failures,
        trigger,
      });
      return "landed";
    }
  } catch (err) {
    await countInfernoPlayerCloseFailure(basesaveid);
    throw err;
  }

  // Left in the first seconds with nothing flung: the mark goes, nothing else is written.
  await release(basesaveid, attack, trigger, "inferno-attack-released");
  return "released";
};

/**
 * Closes the open Inferno player attack on one yard now (the rules above),
 * in an ORM context of its own so a request's entities are neither shared
 * nor flushed. A caller inside a request must call it before it loads any
 * row this may write.
 *
 * @param basesaveid - The defender's Inferno yard.
 * @param trigger - What asked, for the log line.
 */
export const closeInfernoPlayerAttack = (basesaveid: number, trigger: string): Promise<InfernoCloseOutcome> =>
  RequestContext.create(postgres.orm.em, async () => {
    if (!(await acquireInfernoPlayerFinalLock(basesaveid))) return "busy" as const;
    try {
      return await closeLocked(basesaveid, trigger);
    } finally {
      await releaseInfernoPlayerFinalLock(basesaveid);
    }
  });

/** Closes every open attack `choose` picks, carrying on past a failure. */
const closeWhere = async (
  choose: (basesaveid: number, attack: InfernoPlayerSession) => boolean,
  trigger: string
): Promise<number> => {
  let closed = 0;
  for (const { basesaveid, attack } of await listInfernoPlayerAttacks()) {
    if (!choose(basesaveid, attack)) continue;
    try {
      const outcome = await closeInfernoPlayerAttack(basesaveid, trigger);
      if (outcome === "landed" || outcome === "released") closed++;
    } catch (err) {
      logger.error(`Closing the Inferno player attack on ${basesaveid} failed: ${err}`);
    }
  }
  return closed;
};

/**
 * Before a player's yard load or attack start: every Inferno player attack
 * they started and left. Never throws.
 *
 * @param userid - The player.
 * @param trigger - What asked, for the log line.
 */
export const closeInfernoPlayerAttacksOf = async (userid: number, trigger: string): Promise<number> => {
  try {
    return await closeWhere((_, attack) => attack.session.attackerid === userid, trigger);
  } catch (err) {
    logger.error(`Closing the Inferno player attacks of ${userid} failed: ${err}`);
    return 0;
  }
};

/**
 * Before the player loads their Inferno yard: the attacks they left, and the
 * one on their own yard once its window has closed. Nobody else's: other
 * players' expired attacks are the minute sweep's work, never a load's.
 * Never throws.
 *
 * @param userid - The player loading.
 */
export const closeBeforeInfernoLoad = async (userid: number): Promise<void> => {
  try {
    const now = getCurrentDateTime();
    // Read in a context of its own: the close writes this row in another.
    const main = await postgres.em
      .fork()
      .findOne(Save, { userid, type: BaseType.MAIN }, { fields: ["baseid_inferno"] });
    const ownYard = Number(main?.baseid_inferno) > 0 ? String(main!.baseid_inferno) : null;
    await closeWhere(
      (_, attack) =>
        attack.session.attackerid === userid || (ownYard !== null && attack.baseid === ownYard && expired(attack, now)),
      "inferno-load"
    );
  } catch (err) {
    logger.error(`Closing Inferno player attacks before ${userid}'s Inferno load failed: ${err}`);
  }
};

/**
 * Before anyone attacks the yard: its attack, once the window has closed
 * without a save. Never throws: a close that failed answers "failed", and the
 * caller must then treat the yard as still attacked (fail closed).
 *
 * @param basesaveid - The Inferno yard.
 * @param trigger - What asked, for the log line.
 * @returns "open" when the yard's attack is still within its window.
 */
export const closeExpiredInfernoPlayerAttackOn = async (
  basesaveid: number,
  trigger: string
): Promise<InfernoCloseOutcome | "open" | "failed"> => {
  try {
    const attack = await readInfernoPlayerSession(basesaveid);
    if (!attack) return "none";
    if (!expired(attack, getCurrentDateTime())) return "open";
    return await closeInfernoPlayerAttack(basesaveid, trigger);
  } catch (err) {
    logger.error(`Closing the expired Inferno player attack on ${basesaveid} failed: ${err}`);
    return "failed";
  }
};

/** Every Inferno player attack whose window has closed without a save. */
export const closeExpiredInfernoPlayerAttacks = (): Promise<number> => {
  const now = getCurrentDateTime();
  return closeWhere((_, attack) => expired(attack, now), "expired");
};

/** How often the sweep looks for expired attacks: the surface finaliser's minute. */
export const INFERNO_PLAYER_SWEEP_MS = 60_000;

/** Starts the minute sweep. Returns the stop function. */
export const startInfernoPlayerFinaliser = (): (() => void) => {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await closeExpiredInfernoPlayerAttacks();
    } catch (err) {
      logger.error(`Inferno player attack sweep failed: ${err}`);
    } finally {
      running = false;
    }
  }, INFERNO_PLAYER_SWEEP_MS);
  return () => clearInterval(timer);
};
