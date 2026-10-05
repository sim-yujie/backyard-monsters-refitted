import { LockMode, type EntityManager } from "@mikro-orm/core";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { Tribe, Tribes } from "../../enums/Tribes.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { TOWN_HALL_TYPE } from "../yardplanner/costs.js";
import type { AchievementEvents } from "./evaluate.js";
import { recordAchievements, type AchievementsRecorded } from "./record.js";

/**
 * Achievement events the map and attacks bring about
 * (`docs/design/achievements.md` §7.2, issue #204, WP3): the ones that land
 * outside a yard action, so outside the main row's lock.
 *
 * An attack landing (the `/base/save` attack branch, the finaliser, and so
 * auto-attack) holds the defender's lock, not the attacker's main row, so its
 * event is evaluated in a short transaction of its own that takes that lock
 * (`SELECT … FOR UPDATE`, as every yard action does), as `recordTribeDestroyed`
 * counts a Map Room 1 tribe (`services/goals/tribeCounter.ts`).
 */

/** A Map Room 2 Kozu camp's `wmid`: tribe index × 10 + 1 (`tribeSaveV2.ts`). */
export const KOZU_CAMP_WMID = Tribes.indexOf(Tribe.KOZU) * 10 + 1;

/** A building health map: an id to its health, 0 for fallen. */
type HealthMap = Readonly<Record<string, unknown>> | null | undefined;

/** The defender, as {@link kozuHallFell} reads it. */
export interface DefenderLike {
  type?: string | null;
  wmid?: number | null;
  buildingdata?: BuildingDataMap | null;
}

/** Fallen in a health map: present and at 0 or below. Absent is full health. */
const fallenIn = (health: HealthMap, id: string): boolean => {
  const value = health?.[id];
  return value !== undefined && value !== null && Number(value) <= 0;
};

/**
 * Whether this attack brought down a Map Room 2 Kozu camp's Town Hall:
 * `wm2hall` (Flash `ATTACK.as:961-963`, a Kozu Town Hall at 0 health when a
 * wild monster attack ends). The Town Hall must have been standing when the
 * attack began, so a camp someone else already flattened gives nothing.
 *
 * @param defender - The camp's row, its `buildingdata` as landed.
 * @param before - `buildinghealthdata` as the attack began.
 * @param after - The battle's `buildinghealthdata`.
 */
export const kozuHallFell = (defender: DefenderLike, before: HealthMap, after: HealthMap): boolean => {
  if (defender.type !== BaseType.TRIBE || Number(defender.wmid) !== KOZU_CAMP_WMID) return false;
  return Object.entries(defender.buildingdata ?? {}).some(([key, entry]) => {
    if (Number(entry?.t) !== TOWN_HALL_TYPE) return false;
    // The id the engine knows an entry by: its `id`, else its key (`buildEngineYard`).
    const id = String(entry.id ?? key);
    return fallenIn(after, id) && !fallenIn(before, id);
  });
};

/**
 * Adds `events` to the player's achievements in a short transaction that locks
 * their main row, re-read there, and evaluates it (unlock, and pay when
 * rewards are on, `record.ts`). Null when the row is gone.
 *
 * @param em - The caller's entity manager.
 * @param basesaveid - The player's main save.
 * @param events - The event stats to add.
 * @param now - Unix seconds.
 */
export const recordAchievementEvents = (
  em: EntityManager,
  basesaveid: number,
  events: AchievementEvents,
  now: number = getCurrentDateTime()
): Promise<AchievementsRecorded | null> =>
  em.transactional(async (tx) => {
    const main = await tx.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    if (!main) return null;
    const recorded = await recordAchievements(tx, main, now, events);
    await tx.flush();
    return recorded;
  });

/** What {@link recordAttackAchievements} reads of a landed attack. */
export interface LandedAttack {
  /** The attacker's main save. */
  attackerBasesaveid: number;
  /** The defender's row, as landed. */
  defender: DefenderLike;
  /** `buildinghealthdata` as the attack began. */
  before: HealthMap;
  /** The battle's `buildinghealthdata`. */
  after: HealthMap;
}

/**
 * The achievement events of a landed attack: `wm2hall` for a Map Room 2 Kozu
 * Town Hall brought down. Called once the landing is written; the attack has
 * landed whatever happens here, so a failure is logged, never thrown.
 *
 * @returns Whether an event was recorded.
 */
export const recordAttackAchievements = async (em: EntityManager, attack: LandedAttack): Promise<boolean> => {
  if (!kozuHallFell(attack.defender, attack.before, attack.after)) return false;
  try {
    return (await recordAchievementEvents(em, attack.attackerBasesaveid, { wm2hall: 1 })) !== null;
  } catch (err) {
    logger.error(`Recording the Kozu Town Hall for main save ${attack.attackerBasesaveid} failed: ${err}`);
    return false;
  }
};
