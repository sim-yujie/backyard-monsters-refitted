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
import { monsterUpdateHandler } from "../../../controllers/base/save/handlers/monsterUpdateHandler.js";
import { MR1_TRIBES_MAP } from "../../../game-data/tribes/v1/index.js";
import { combatConfig } from "../../../config/CombatConfig.js";
import { bankAttackLoot, krallenBuffOf } from "../../base/combat/attackLoot.js";
import { chargeBombSpend } from "../../base/combat/bombSpend.js";
import { parseFlingLog } from "../../base/attackCheckpoint.js";
import { recordBombSpend } from "../../base/combat/recordBombSpend.js";
import { checkAttackBinding, type AttackSession } from "../../base/attackSession.js";
import { storedDamage } from "../../base/storedDamage.js";
import { championsAfterAttack, siegeAfterAttack } from "../../base/combat/attackerRow.js";
import { RESOURCE_KEYS, derivedDestroyed, type ResourceAmounts } from "../../../game-rules/combat/index.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import type { SaveData } from "../../../types/EntityData.js";
import type { TribeData } from "../../../types/TribeData.js";
import { isDeclareWarRunning } from "../../alliance/powerups.js";
import { battleReplayInput, battleTick } from "../../base/combat/battle.js";
import { logBattleMismatches, replayBattleForSave } from "../../base/combat/saveBattle.js";
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
 * of it sent again as the page closes is refused. A save without `over`
 * writes nothing.
 *
 * The battle is the server's (issue #23, C4): the save that ends the attack
 * replays its fling log, as a Map Room 2 save does (`baseSave.ts`), and the
 * tribe's health, damage and `destroyed` and the loot come from that replay,
 * never from the save. The loot is then capped by what the tribe holds
 * (`creditableMR1Loot`), counted over the tribe's life until it respawns. The
 * army leaves the main yard's housing through the fling log, as on Map Room 2.
 *
 * @param {Context} ctx - The Koa context, for the caller's IP in the logs.
 * @param {User} user - The attacking user
 * @param {BaseSaveData} saveData - Parsed save payload from the client
 * @returns Synthetic Save reflecting updated tribe state, and what the
 *   attacker's pool took of the loot (null for a save without `over`)
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
    ? recordBombSpend(ctx, user, userSave, tribeSave, saveData.flinglog, combatConfig.mode, session?.attackerResources)
    : null;

  // The battle, replayed to the client's clock over the tribe as the attack
  // load served it (issue #23, C4), in a worker. A tribe keeps no checkpoint
  // and no finaliser lands its attacks, so a replay past its deadline lands
  // nothing: the save is answered `attackResultPendingErr`, the session is
  // left for a resent save, and the tribe respawns in time anyway.
  const battle = finalises ? await tribeBattle(ctx, user, saveData, session, tribeData, existingTribe) : null;

  const wasDestroyed = Boolean(existingTribe.destroyed);
  /** What the attacker's pool took of the loot, for the response. */
  let credited: ResourceAmounts | null = null;

  // The tribe keeps its own monsters, the stored ones or its template's: the
  // save's copy is never written (issue #23, C2). What the battle did to it
  // is the replay's; a save without one writes none of it.
  if (battle) {
    existingTribe.tribeHealthData = battle.buildinghealthdata;
    existingTribe.destroyed = battle.destroyed;
    existingTribe.destroyedAt = battle.destroyed
      ? wasDestroyed ? existingTribe.destroyedAt ?? now : now
      : undefined;
    existingTribe.damage = storedDamage(battle.damage) ?? existingTribe.damage;

    userSave.wmstatus.forEach((tribe) => {
      if (tribe[0] === Number(saveData.baseid)) tribe[2] = battle.destroyed;
    });
  }

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

    // Read before the champions below are written (`attackLootOf` reads them the same way).
    const krallenBuff = krallenBuffOf(parseFlingLog(saveData.flinglog), userSave.champion);

    // The attacker's own row as the log explains it, not as the save says it
    // (#23, C1): siege less what was used, champion health only downwards.
    if (saveData.attackerchampion) {
      userSave.champion = championsAfterAttack(userSave.champion, saveData.attackerchampion, saveData.flinglog);
    }
    userSave.siege = siegeAfterAttack(userSave.siege, saveData.flinglog);

    if (bombs) userSave.resources = chargeBombSpend(bombs.spend, userSave.resources);

    // The replay's gain, capped by what the tribe has left to give. The tribe
    // gives up the whole credit; the attacker keeps what fits in their
    // storage (issue #166, `bankAttackLoot`), as on Map Room 2.
    const credit = creditableMR1Loot(battle?.attackloot, mr1TribePool(tribeData), existingTribe.looted);
    credited = bankAttackLoot(userSave, credit, krallenBuff).credited;

    const looted = { ...existingTribe.looted };
    for (const key of RESOURCE_KEYS) looted[key] = (looted[key] ?? 0) + credit[key];
    existingTribe.looted = looted;
  }

  postgres.em.persist(maproom);
  postgres.em.persist(userSave);
  await postgres.em.flush();

  // Spent: the lock is still held, so a copy of this save finds nothing.
  if (finalises) await endMR1TribeSession(user.userid, saveData.baseid);

  const save = Object.assign(tribeSave, {
    buildinghealthdata: existingTribe.tribeHealthData,
    monsters: existingTribe.monsters ?? tribeData.monsters,
  });
  return { save, credited };
};

/**
 * The server's battle for the save that ends a tribe attack (issue #23, C4),
 * or null when there is none to fight: no roster in the session, or no usable
 * fling log.
 *
 * The tribe is fought as the web client fights it: the template's buildings,
 * the health it has kept since it respawned, the template's pool, as the
 * engine's `"tribe"` kind (`AttackSession.combatKind`). `destroyed` is the
 * client's own figure for it too: the web save works it out with a camp's
 * threshold (`attackSave.ts` passes `session.target.kind`, `"wild"`), and the
 * tribe's respawn reads it.
 *
 * @throws {ClientSafeError} `attackResultPendingErr` when the replay timed out.
 */
const tribeBattle = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  session: AttackSession,
  tribeData: Pick<SaveData, "type" | "buildingdata" | "resources">,
  existingTribe: TribeData
) => {
  if (!session.entryHoused) return null;
  const input = battleReplayInput({
    flinglog: saveData.flinglog,
    session,
    defender: {
      type: String(tribeData.type),
      kind: "tribe",
      buildingdata: tribeData.buildingdata as JsonObject | undefined,
      buildinghealthdata: (existingTribe.tribeHealthData ?? {}) as JsonObject,
      resources: tribeData.resources as JsonObject | undefined,
    },
    attacker: user.save!,
    tick: battleTick(saveData.tick),
    declareWar: await isDeclareWarRunning(user.alliance_id),
    left: false,
  });
  if (!input) return null;

  const base = { baseid: saveData.baseid };
  const fought = await replayBattleForSave(ctx, user, base, input, "a tribe has no finaliser, so nothing lands");
  const battle = { ...fought, destroyed: derivedDestroyed(fought.damage, "wild") ?? 0 };

  logBattleMismatches(
    ctx,
    user,
    base,
    {
      damage: (ctx.request.body as Record<string, unknown> | undefined)?.damage,
      destroyed: saveData.destroyed,
      buildinghealthdata: saveData.buildinghealthdata,
      buildingdata: saveData.buildingdata,
      attackloot: saveData.attackloot,
    },
    battle,
    tribeData.buildingdata as JsonObject | undefined
  );
  return battle;
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
