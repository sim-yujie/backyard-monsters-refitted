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
  endInfernoPlayerSession,
  listInfernoPlayerAttacks,
  readInfernoPlayerCheckpoint,
  readInfernoPlayerSession,
  releaseInfernoPlayerFinalLock,
  type InfernoPlayerSession,
} from "./infernoPlayerSession.js";
import { playerLoot, playerReplayInput, writePlayerLanding } from "./infernoPlayerLanding.js";

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
 * it. An attack with no checkpoint flung nothing (the client sends one the
 * moment anything is flung), so, as on the surface
 * (`releaseUnfoughtAttackOf`), nothing is written but the yard's attack mark
 * cleared. Either way the session ends, so the same attack can be neither
 * saved nor started again.
 *
 * When it runs:
 * - the attacker's next yard load (`/base/load`, `/bm/inferno/load`) and next
 *   `attack/start` of any kind: they have plainly left that battle;
 * - the defender's own Inferno yard load (any attack whose window has closed),
 *   and an `attack/start` on that yard, once the window has closed (the
 *   attacker could still save before);
 * - a sweep every minute, once the window (420 s: the fight's limit and a
 *   margin) has closed.
 *
 * Exactly once: the final save and this take the same lock, and whichever
 * comes second finds the session gone.
 */

export type InfernoCloseOutcome = "landed" | "released" | "none" | "busy" | "stale";

/** Whether the attack's window has closed, so its attacker can no longer save it. */
const expired = (attack: InfernoPlayerSession, now: number): boolean =>
  now - attack.session.startedat >= ATTACK_SESSION_WINDOW;

const closeLocked = async (basesaveid: number, trigger: string): Promise<InfernoCloseOutcome> => {
  const em = postgres.em;
  const attack = await readInfernoPlayerSession(basesaveid);
  if (!attack) return "none";

  const yard = await em.findOne(Save, { basesaveid });
  // The row moved on (another attack holds it) or is gone: nothing of this one can land.
  if (!yard || yard.type !== BaseType.INFERNO || Number(yard.attackid) !== attack.session.attackid) {
    await endInfernoPlayerSession(basesaveid);
    return "stale";
  }

  const checkpoint = await readInfernoPlayerCheckpoint(basesaveid);
  const log = checkpoint?.attackid === attack.session.attackid ? checkpoint : null;
  const user = log ? await em.findOne(User, { userid: attack.session.attackerid }, { populate: ["save"] }) : null;
  const input =
    log && user?.save && attack.session.entryHoused
      ? playerReplayInput(attack, yard, log.flinglog, log.tick, true)
      : null;

  if (!input || !user) {
    // Nothing was flung: the mark goes, nothing else is written.
    await em.nativeUpdate(Save, { basesaveid, attackid: attack.session.attackid }, { attackid: 0 });
    await endInfernoPlayerSession(basesaveid);
    logger.info("Released an Inferno player attack left with nothing fought", {
      event: "inferno-attack-released",
      basesaveid,
      attackerid: attack.session.attackerid,
      trigger,
    });
    return "released";
  }

  // In a worker, off the event loop; a replay past its deadline throws and the
  // attack stays for the next pass.
  const battle = await replayAbandonedInWorker(input);
  const loot = playerLoot(attack, yard, { sent: battle.attackloot, reported: battle.defenderDelta, flinglog: log!.flinglog }, battle);
  await writePlayerLanding(user, attack, yard, battle, loot, getCurrentDateTime());

  logger.info("Closed an Inferno player attack its attacker left", {
    event: "inferno-attack-closed",
    basesaveid,
    attackerid: attack.session.attackerid,
    tick: log!.tick,
    trigger,
  });
  return "landed";
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
 * Before the player loads their Inferno yard: the attacks they left, and any
 * whose window has closed, their own yard's among them. Never throws.
 *
 * @param userid - The player loading.
 */
export const closeBeforeInfernoLoad = async (userid: number): Promise<void> => {
  try {
    const now = getCurrentDateTime();
    await closeWhere((_, attack) => attack.session.attackerid === userid || expired(attack, now), "inferno-load");
  } catch (err) {
    logger.error(`Closing Inferno player attacks before ${userid}'s Inferno load failed: ${err}`);
  }
};

/**
 * Before anyone attacks the yard: its attack, once the window has closed
 * without a save. Never throws.
 *
 * @param basesaveid - The Inferno yard.
 * @param trigger - What asked, for the log line.
 */
export const closeExpiredInfernoPlayerAttackOn = async (basesaveid: number, trigger: string): Promise<void> => {
  try {
    const attack = await readInfernoPlayerSession(basesaveid);
    if (attack && expired(attack, getCurrentDateTime())) await closeInfernoPlayerAttack(basesaveid, trigger);
  } catch (err) {
    logger.error(`Closing the expired Inferno player attack on ${basesaveid} failed: ${err}`);
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
