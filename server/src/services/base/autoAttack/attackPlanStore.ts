import { AttackPlanRow } from "../../../database/models/attackplan.model.js";
import type { FlingLog } from "../../../game-rules/combat/index.js";
import { postgres } from "../../../server.js";
import { logger } from "../../../utils/logger.js";
import { campKeyOf, parseStoredPlan, planFromFought, type AttackPlan, type CampKey } from "./attackPlan.js";

/**
 * Where auto-attack plans are kept (issue #221): `bym.attack_plan`, one row
 * per player, camp tribe and level, and slot (`attackplan.model.ts`).
 */

/** The slot the last hand-played attack is kept in. */
export const LAST_SLOT = "last";

/** A stored plan with what the panels say about it. */
export interface StoredPlan {
  readonly plan: AttackPlan;
  /** The camp it was played on. */
  readonly baseid: string;
  /** Unix seconds. */
  readonly recordedAt: number;
}

/**
 * Keeps a landed hand-played attack as the player's plan for the camp's tribe
 * and level, replacing the one before. Does nothing for anything but a Map
 * Room 2 wild monster camp, or a log that flung nothing. Never throws: a plan
 * that cannot be written must not cost the player the attack that landed.
 *
 * @param userid - The attacker.
 * @param defender - The camp's row.
 * @param fought - The log the server's replay fought.
 * @param tick - The tick it was fought to.
 */
export const recordAttackPlan = async (
  userid: number,
  defender: { baseid: string; type?: string | null; wmid?: number | null; level?: number | null },
  fought: FlingLog,
  tick: number
): Promise<void> => {
  const key = campKeyOf(defender);
  if (!key) return;
  const plan = planFromFought(fought, tick);
  if (!plan) return;
  try {
    await postgres.em.upsert(AttackPlanRow, {
      userid,
      wmid: key.wmid,
      level: key.level,
      slot: LAST_SLOT,
      baseid: defender.baseid,
      plan,
      recorded_at: new Date(),
    });
  } catch (err) {
    logger.error("Could not record the attack plan for userid {userid} on {baseid}: {error}", {
      userid,
      baseid: defender.baseid,
      error: err,
    });
  }
};

/**
 * The player's plan for a camp's tribe and level, or null when they have none
 * (or it no longer reads).
 *
 * @param userid - The player.
 * @param key - The camp's tribe and level.
 */
export const findAttackPlan = async (userid: number, key: CampKey): Promise<StoredPlan | null> => {
  const row = await postgres.em.findOne(AttackPlanRow, {
    userid,
    wmid: key.wmid,
    level: key.level,
    slot: LAST_SLOT,
  });
  if (!row) return null;
  const plan = parseStoredPlan(row.plan);
  if (!plan) return null;
  return { plan, baseid: row.baseid, recordedAt: Math.floor(new Date(row.recorded_at).getTime() / 1000) };
};
