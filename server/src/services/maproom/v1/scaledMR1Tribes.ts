import type { Context } from "koa";
import type { TypeOf } from "zod";
import { attackNotBoundErr, saveFailureErr } from "../../../errors/errors.js";
import { Maproom } from "../../../database/models/maproom.model.js";
import { Save } from "../../../database/models/save.model.js";
import { User } from "../../../database/models/user.model.js";
import { postgres } from "../../../server.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { logger } from "../../../utils/logger.js";
import { BaseSaveSchema } from "../../../schemas/BaseSaveSchema.js";
import { attackLootHandler } from "../../../controllers/base/save/handlers/attackLootHandler.js";
import { monsterUpdateHandler } from "../../../controllers/base/save/handlers/monsterUpdateHandler.js";
import { MR1_TRIBES_MAP } from "../../../game-data/tribes/v1/index.js";
import { combatConfig } from "../../../config/CombatConfig.js";
import { chargeBombSpend } from "../../base/combat/bombSpend.js";
import { recordBombSpend } from "../../base/combat/recordBombSpend.js";
import { checkAttackBinding, type AttackSession } from "../../base/attackSession.js";
import { storedDamage } from "../../base/storedDamage.js";
import { RESOURCE_KEYS } from "../../../game-rules/combat/index.js";
import { creditableMR1Loot, mr1TribePool } from "./mr1TribeRules.js";
import {
  acquireMR1TribeFinalLock,
  endMR1TribeSession,
  readMR1TribeSession,
  releaseMR1TribeFinalLock,
} from "./mr1TribeSession.js";

type BaseSaveData = TypeOf<typeof BaseSaveSchema>;

/**
 * The result of a Map Room 1 tribe attack (`/base/save` naming a tribe base).
 *
 * Bound to an attack this caller started on this tribe (issue #161): the
 * attack load minted a session (`mr1TribeSession.ts`), and a save without one,
 * from another account, after the 420-second window or for another attack is
 * refused before anything is written. Only the save carrying `over` touches
 * the attacker: it lands once, under a lock, and ends the session, so a copy
 * of it sent again as the page closes is refused. A save without `over` only
 * records the tribe's damage.
 *
 * Loot is capped by what the tribe holds (`creditableMR1Loot`), counted over
 * the tribe's life until it respawns. The army leaves the main yard's housing
 * through the fling log, as on Map Room 2.
 *
 * @param {Context} ctx - The Koa context, for the caller's IP in the logs.
 * @param {User} user - The attacking user
 * @param {BaseSaveData} saveData - Parsed save payload from the client
 * @returns {Promise<Save>} Synthetic Save reflecting updated tribe state
 */
export const scaledMR1Tribes = async (ctx: Context, user: User, saveData: BaseSaveData) => {
  const finalises = Boolean(saveData.over);
  const { userid } = user;
  const { baseid } = saveData;

  if (finalises && !(await acquireMR1TribeFinalLock(userid, baseid))) throw attackNotBoundErr("finalising");

  try {
    return await saveTribeAttack(ctx, user, saveData, finalises);
  } finally {
    if (finalises) await releaseMR1TribeFinalLock(userid, baseid);
  }
};

const saveTribeAttack = async (ctx: Context, user: User, saveData: BaseSaveData, finalises: boolean) => {
  const userSave = user.save!;
  const now = getCurrentDateTime();

  const session = await requireTribeBinding(ctx, user, saveData, now);

  const maproom = await postgres.em.findOne(Maproom, { userid: user.userid });

  if (!maproom) throw new Error(`MapRoom not found for userid: ${user.username}`);

  const existingTribe = maproom.tribedata.find((tribe) => tribe.baseid === saveData.baseid);

  if (!existingTribe) throw saveFailureErr();

  const tribeData = MR1_TRIBES_MAP.get(saveData.baseid);

  if (!tribeData) throw new Error(`No MR1 tribe data found for baseid: ${saveData.baseid}`);

  const tribeSave = Object.assign(new Save(), { ...tribeData, baseid: saveData.baseid });

  // Worked out before anything is written, so a refusal in `reject` mode
  // leaves every row as it was (issue #90, as `baseSave.ts` does).
  const bombs = finalises
    ? recordBombSpend(ctx, user, userSave, tribeSave, saveData.flinglog, combatConfig.mode)
    : null;

  const wasDestroyed = Boolean(existingTribe.destroyed);

  existingTribe.tribeHealthData = saveData.buildinghealthdata ?? existingTribe.tribeHealthData;
  existingTribe.monsters = saveData.monsters;
  existingTribe.destroyed = saveData.destroyed;
  existingTribe.destroyedAt = saveData.destroyed
    ? wasDestroyed ? existingTribe.destroyedAt ?? now : now
    : undefined;

  const damage = storedDamage((ctx.request.body as Record<string, unknown> | undefined)?.damage);
  if (damage !== null) existingTribe.damage = damage;

  userSave.wmstatus.forEach((tribe) => {
    if (tribe[0] === Number(saveData.baseid)) tribe[2] = saveData.destroyed ?? 0;
  });

  if (finalises) {
    // The army settles as a Map Room 2 attack's does (issue #132): the flung
    // monsters leave the main yard's housing as caught up now, capped by what
    // it housed at entry (the session's `entryHoused`). Only the main yard
    // flings on Map Room 1, and Flash's `attackcreatures` blob is never written.
    const entries = Array.isArray(saveData.monsterupdate) ? saveData.monsterupdate : [];
    await monsterUpdateHandler(
      entries.filter((entry: { baseid?: unknown }) => String(entry?.baseid) === String(userSave.baseid)),
      userSave,
      { session, finalises: true, flinglog: saveData.flinglog, now, mapRoom3: false }
    );

    if (saveData.attackerchampion) userSave.champion = saveData.attackerchampion;

    if (saveData.attackersiege) userSave.siege = saveData.attackersiege;

    const credit = creditableMR1Loot(saveData.attackloot, mr1TribePool(tribeData), existingTribe.looted);
    attackLootHandler(credit, userSave);

    const looted = { ...existingTribe.looted };
    for (const key of RESOURCE_KEYS) looted[key] = (looted[key] ?? 0) + credit[key];
    existingTribe.looted = looted;

    if (bombs) userSave.resources = chargeBombSpend(bombs.spend, userSave.resources);
  }

  postgres.em.persist(maproom);
  postgres.em.persist(userSave);
  await postgres.em.flush();

  // Spent: the lock is still held, so a copy of this save finds nothing.
  if (finalises) await endMR1TribeSession(user.userid, saveData.baseid);

  return Object.assign(tribeSave, {
    buildinghealthdata: existingTribe.tribeHealthData,
    monsters: existingTribe.monsters ?? tribeData.monsters,
  });
};

/**
 * Refuses a tribe save that is not the result of this caller's attack on this
 * tribe, the way `baseSave.ts` refuses one for a Map Room 2 row.
 */
const requireTribeBinding = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  now: number
): Promise<AttackSession> => {
  const session = await readMR1TribeSession(user.userid, saveData.baseid);
  const submitted = saveData.attackid ? Number(saveData.attackid) : undefined;

  const result = checkAttackBinding({
    session,
    callerid: user.userid,
    storedAttackId: session?.attackid ?? 0,
    submittedAttackId: submitted,
    now,
  });

  if (result.ok) return session!;

  logger.warn(
    "Map Room 1 tribe save refused for {username} (userid {userid}) on tribe {baseid}: {reason}",
    {
      event: "attack-binding-refused",
      reason: result.reason,
      userid: user.userid,
      username: user.username,
      baseid: saveData.baseid,
      submittedAttackId: saveData.attackid ?? null,
      ip: ctx.ip,
    }
  );

  throw attackNotBoundErr(result.reason);
};
