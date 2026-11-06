import { LockMode, type EntityManager } from "@mikro-orm/core";
import { AllianceMessageType, AlliancePowerupType } from "../../enums/Alliance.js";
import { AlliancePowerup } from "../../database/models/alliancepowerup.model.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { invalidateAllianceSight } from "../maproom/sight/sightService.js";
import { notMainYardErr } from "../yard/yardErrors.js";
import {
  notEnoughShinyErr,
  powerupNotReadyErr,
  powerupReadyErr,
  powerupRunningErr,
  powerupUnknownErr,
} from "../../errors/errors.js";
import { POWERUP_RULES, type PowerupRules } from "../../config/AllianceConfig.js";
import { announceShout } from "./allianceMessages.js";

interface Powerup {
  rules: PowerupRules;
  status: AlliancePowerup;
}

export interface PowerupPurchase {
  allianceId: number;
  author: User;
  /** The paying player's main save, locked while the Shiny is spent. */
  basesaveid: number;
  powerupId: number;
  hours: number;
}

export interface PowerupActivation {
  allianceId: number;
  author: User;
  powerupId: number;
}


interface RunningPowerup {
  id: AlliancePowerupType;
  endtime: number;
}

/**
 * Loads an alliance's power-ups, seeding and expiring them as it goes.
 
 * A power-up an alliance has never held is created charging from now rather than
 * from the alliance's creation date, so alliances that predate this table start a
 * charge instead of appearing instantly ready.
 *
 * @param {number} allianceId - The alliance whose power-ups are being read.
 * @param {EntityManager} em - The entity manager to read with: a transaction's, to lock the rows.
 * @param {boolean} lock - Whether to lock the rows (`SELECT ... FOR UPDATE`) and read them afresh.
 * @returns {Promise<Powerup[]>} All three power-ups, in tab order.
 */
export const alliancePowerup = async (
  allianceId: number,
  em: EntityManager = postgres.em,
  lock = false
): Promise<Powerup[]> => {
  const rows = await em.find(
    AlliancePowerup,
    { alliance_id: allianceId },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true } : {}
  );

  const now = getCurrentDateTime();

  const powerups = POWERUP_RULES.map((rules) => {
    let status = rows.find((row) => row.powerup === rules.type);

    if (!status) {
      status = em.create(AlliancePowerup, {
        alliance_id: allianceId,
        powerup: rules.type,
        active: false,
        end_time: now + rules.recharge_time,
        updated_at: new Date(),
      });

      em.persist(status);
    } else if (status.active && status.end_time <= now) {
      status.active = false;
      status.end_time += rules.recharge_time;
    }

    return { rules, status };
  });

  await em.flush();

  return powerups;
};

/**
 * Starts a charged power-up, buffing every member of the alliance for its running time.
 *
 * The charge is read, checked and written inside one transaction holding the
 * alliance's power-up rows' lock, as {@link reducePowerupCharge} does. Read
 * outside it, two starts sent at once both passed the "charged" check and
 * both announced the start (security audit 2026-10-29, wave 2).
 *
 * @param {number} allianceId - The alliance starting it.
 * @param {number} powerupId - Which power-up, from the getpowerups rows.
 * @returns {Promise<Powerup[]>} All the alliance's power-ups, the started one updated.
 * @throws {ClientSafeError} When the id is unknown, or it is already running or still charging.
 */
export const startPowerup = async ({ allianceId, author, powerupId }: PowerupActivation): Promise<Powerup[]> => {
  // A power-up the alliance has never held is seeded first, outside the lock.
  await alliancePowerup(allianceId);

  const outcome = await postgres.em.transactional(async (em) => {
    const powerups = await alliancePowerup(allianceId, em, true);

    const powerup = powerups.find(({ rules }) => rules.powerup_id === powerupId);

    if (!powerup) throw powerupUnknownErr();

    const { rules, status } = powerup;
    const now = getCurrentDateTime();

    if (status.active) throw powerupRunningErr();
    if (status.end_time > now) throw powerupNotReadyErr();

    status.active = true;
    status.end_time = now + rules.running_time;

    await em.flush();

    return { powerups, type: rules.type };
  });

  // Declare War's +2 reach changes every member's Map Room 2 fog of war
  // sight; a cache built before this start is missing it (issue #329,
  // `docs/design/fog-of-war.md` §9).
  if (outcome.type === AlliancePowerupType.DECLARE_WAR) await invalidateAllianceSight(allianceId);

  await announceShout({
    allianceId,
    author,
    type: AllianceMessageType.POWERUP_ACTIVATED,
    body: outcome.type,
  });

  return outcome.powerups;
};

/**
 * Spends Shiny to bring a charging power-up closer to ready.
 *
 * The balance and the charge are read, checked and written inside one
 * transaction holding the paying save's row lock (the one yard actions take)
 * and the alliance's power-up rows' (security audit 2026-10-29, M1). Read
 * outside it, two purchases sent at once both passed the check and only one
 * charge stuck, and a yard action's Shiny spend landing in between was
 * written over with the old balance.
 *
 * @param {PowerupPurchase} purchase - Alliance, paying save, power-up and hours asked for.
 * @returns {Promise<{ powerups: Powerup[]; credits: number }>} All the alliance's power-ups, the sped-up one updated, and the Shiny left.
 * @throws {ClientSafeError} When the id is unknown, it is running or already charged, or Shiny is short.
 */
export const reducePowerupCharge = async ({ allianceId, author, basesaveid, powerupId, hours }: PowerupPurchase) => {
  // A power-up the alliance has never held is seeded first, outside the lock.
  await alliancePowerup(allianceId);

  const outcome = await postgres.em.transactional(async (em) => {
    // The paying save first, then the power-ups: always in this order.
    const userSave = await em.findOne(
      Save,
      { basesaveid },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    );
    if (!userSave) throw notMainYardErr();

    const powerups = await alliancePowerup(allianceId, em, true);

    const powerup = powerups.find(({ rules }) => rules.powerup_id === powerupId);
    if (!powerup) throw powerupUnknownErr();

    const { rules, status } = powerup;
    const now = getCurrentDateTime();

    if (status.active) throw powerupRunningErr();

    if (status.end_time <= now) throw powerupReadyErr();

    const remainingHours = Math.ceil((status.end_time - now) / 3600);
    const boughtHours = Math.min(hours, remainingHours);

    const cost = boughtHours * rules.hourly_cost;

    if (userSave.credits < cost) throw notEnoughShinyErr();

    userSave.credits -= cost;

    status.end_time = Math.max(now, status.end_time - boughtHours * 3600);

    await em.flush();

    return { powerups, credits: userSave.credits, type: rules.type, boughtHours };
  });

  await announceShout({
    allianceId,
    author,
    type: AllianceMessageType.POWERUP_PURCHASE,
    body: JSON.stringify({ powerup: outcome.type, hours: outcome.boughtHours }),
  });

  return { powerups: outcome.powerups, credits: outcome.credits };
};

/**
 * The alliance's running power-ups, in the shape base load hands the client.
 *
 * @param {User["alliance_id"]} allianceId - The viewing player's alliance, if any.
 * @returns {Promise<RunningPowerup[]>} Rows for POWERUPS.Setup.
 */
/**
 * Whether an alliance has Declare War running now: the longer countdown an
 * attack's battle runs to (`GLOBAL.as:839-842`), for the server's replays.
 *
 * @param allianceId - The attacker's alliance, if any.
 */
export const isDeclareWarRunning = async (allianceId: User["alliance_id"]): Promise<boolean> =>
  (await runningPowerups(allianceId)).some(({ id }) => id === AlliancePowerupType.DECLARE_WAR);

export const runningPowerups = async (allianceId: User["alliance_id"]): Promise<RunningPowerup[]> => {
  if (!allianceId) return [];

  const now = getCurrentDateTime();
  const powerups = await alliancePowerup(allianceId);

  return powerups
    .filter(({ status }) => status.active && status.end_time > now)
    .map(({ status }) => ({ id: status.powerup, endtime: status.end_time }));
};
