import type { Context } from "koa";
import type { TypeOf } from "zod";

import { combatConfig } from "../../config/CombatConfig.js";
import { monsterUpdateHandler } from "../../controllers/base/save/handlers/monsterUpdateHandler.js";
import { InfernoProgress } from "../../database/models/infernoprogress.model.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { attackNotBoundErr } from "../../errors/errors.js";
import type { ResourceAmounts } from "../../game-rules/combat/index.js";
import { BaseSaveSchema } from "../../schemas/BaseSaveSchema.js";
import { postgres } from "../../server.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { SaveData } from "../../types/EntityData.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { recordAchievementEvents } from "../achievements/events.js";
import { parseFlingLog } from "../base/attackCheckpoint.js";
import { checkAttackBinding } from "../base/attackSession.js";
import { battleReplayInput, battleTick } from "../base/combat/battle.js";
import { championsAfterAttack } from "../base/combat/attackerRow.js";
import { championsAfterLessons } from "../base/combat/championBrain.js";
import { recordBattleMismatches, replayBattleForSave } from "../base/combat/saveBattle.js";
import { creditableMR1Loot, mr1TribePool } from "../maproom/v1/mr1TribeRules.js";
import {
  descentFightableLog,
  descentIndexOf,
  descentProgressAfter,
  descentYardOf,
  purseAfterDescentLoot,
  purseAmounts,
  type DescentYardState,
} from "./descent.js";
import {
  acquireDescentFinalLock,
  endDescentSession,
  readDescentSession,
  releaseDescentFinalLock,
  type DescentSession,
} from "./descentSession.js";
import { requireInfernoEnabled } from "./infernoGate.js";
import { readInfernoProgress } from "./infernoProgress.js";
import { createInfernoYard } from "./infernoYard.js";

type BaseSaveData = TypeOf<typeof BaseSaveSchema>;

/**
 * The result of a Descent attack (`docs/design/inferno.md` §2.4, WP 1.12): a
 * `/base/save` naming a Descent yard, `"201"`-`"213"`, which has no row.
 *
 * Bound to the attack `POST /bm/inferno/attack/start` minted for this caller
 * on this yard (`descentSession.ts`): a save without one, from another
 * account, after the 420-second window, for another attack or another yard
 * is refused before anything is written. Only the save carrying `over` lands:
 * once, under a lock, and it ends the session. A save without `over` writes
 * nothing.
 *
 * The battle is the server's: the fling log, cut to what a Descent attack can
 * do (`descentFightableLog`: no bombs, no siege, each fling within the
 * Flinger), is replayed over the yard as an Inferno yard, with the defence
 * the start served. Its damage decides the attack (a win at 90%), its loot is
 * credited (capped by what the yard holds less what it gave before), and the
 * save's own `damage`, `destroyed`, health and `attackloot` are only compared
 * (`attack-replay-mismatch`).
 *
 * What lands: the flung monsters leave the main yard's housing; the loot goes
 * into the Inferno purse (`iresources`) with no cap; the yard is beaten or
 * keeps its damage (`descentProgressAfter`); the 13th win passes the Descent
 * and makes the player's Inferno yard (`createInfernoYard`); and the
 * achievements hear Flash's Descent counter (18 "Into the Depths" at 1, after
 * any first attack; 19 "Rock Bottom" at 14).
 *
 * A replay past its deadline lands nothing: the answer is
 * `attackResultPendingErr` and the session is kept for a resent save, as for
 * a Map Room 1 tribe. An attack left without a final save lands nothing.
 */

/** What the landing answers about the Descent, for the report and the map. */
export interface DescentLanded {
  won: boolean;
  /** The server's damage, 0-100. */
  damage: number;
  /** Flash's counter after the attack, 1-14. */
  level: number;
  /** The loot this attack credited to the Inferno purse. */
  loot: ResourceAmounts;
  /** The purse now: the Descent's running total (`descent_battlereport`). */
  total: ResourceAmounts;
  /** The 13th yard fell: the Descent is passed. */
  captured: boolean;
  /** The player's Inferno yard, once captured. */
  infernobaseid: string | null;
}

export const landDescentAttack = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData
): Promise<{ save: Save; descent: DescentLanded | null }> => {
  requireInfernoEnabled();
  const finalises = Boolean(saveData.over);
  const { userid } = user;

  if (finalises && !(await acquireDescentFinalLock(userid))) throw attackNotBoundErr("finalising");

  try {
    return await land(ctx, user, saveData, finalises);
  } finally {
    if (finalises) await releaseDescentFinalLock(userid);
  }
};

/** The Descent yard as the start served it: the data file's, with the health it kept. */
const descentYard = (template: SaveData, baseid: string, kept: DescentYardState | undefined): Save =>
  Object.assign(new Save(), {
    ...structuredClone(template),
    baseid,
    buildinghealthdata: { ...(kept?.health ?? {}) },
  });

const land = async (ctx: Context, user: User, saveData: BaseSaveData, finalises: boolean) => {
  const em = postgres.em;
  const userSave = user.save!;
  const now = getCurrentDateTime();
  const baseid = String(saveData.baseid);

  const descent = await requireDescentBinding(ctx, user, saveData, now);
  const index = descentIndexOf(baseid)!;
  const template = descentYardOf(index);
  const progress = await readInfernoProgress(em, user.userid);
  const kept = progress.descentYards[baseid];
  const yard = descentYard(template, baseid, kept);

  if (!finalises) return { save: yard, descent: null };

  const battle = await descentBattle(ctx, user, saveData, descent, yard);

  // The army leaves the main yard's housing through the fling log, capped by
  // what it housed at the start (the session's `entryHoused`), as a Map Room 1
  // attack's does. Only the main yard flings in the Descent.
  const entries = Array.isArray(saveData.monsterupdate) ? saveData.monsterupdate : [];
  await monsterUpdateHandler(
    entries.filter((entry: { baseid?: unknown }) => String(entry?.baseid) === String(userSave.baseid)),
    userSave,
    { session: descent.session, finalises: true, flinglog: saveData.flinglog, now, mapRoom3: false }
  );

  // The attacker's champions as the log explains them (#23, C1), and what
  // each that fought learned from the server's battle (issue #219). No siege
  // weapon is used in the Descent, so the siege stock is left alone.
  if (saveData.attackerchampion) {
    userSave.champion = championsAfterAttack(userSave.champion, saveData.attackerchampion, saveData.flinglog);
  }
  if (battle) userSave.champion = championsAfterLessons(userSave.champion, battle.lessons, battle.log) ?? userSave.champion;

  // The replay's gain, capped by what the yard has left to give, into the
  // Inferno purse in full.
  const loot = creditableMR1Loot(battle?.attackloot, mr1TribePool(template), kept?.looted);
  userSave.iresources = purseAfterDescentLoot(userSave.iresources, loot);

  const update = descentProgressAfter(progress, {
    index,
    damage: battle?.damage ?? 0,
    health: battle?.buildinghealthdata ?? kept?.health ?? {},
    loot,
  });

  let row = await em.findOne(InfernoProgress, { userid: user.userid });
  if (!row) {
    row = em.create(InfernoProgress, { userid: user.userid });
  }
  row.descent_destroyed = update.descentDestroyed;
  row.descent_best = update.descentBest;
  row.descent_yards = update.descentYards as InfernoProgress["descent_yards"];
  row.updated_at = new Date(now * 1000);

  let infernobaseid = progress.infernoBaseid;
  if (update.captured) {
    row.descent_passed_at = new Date(now * 1000);
    if (!infernobaseid) {
      const infernoYard = await createInfernoYard(em, user, userSave);
      infernobaseid = infernoYard.baseid;
      row.inferno_baseid = infernobaseid;
      // Owning the yard unlocks Korath on the surface (owner I10, WP 5.1).
      row.korath_unlocked_at ??= new Date(now * 1000);
    }
  }

  em.persist(row);
  em.persist(userSave);
  await em.flush();

  if (update.captured) {
    logger.info("Descent passed by {username} (userid {userid}): Inferno yard {baseid}", {
      event: "inferno-descent-passed",
      userid: user.userid,
      username: user.username,
      baseid: infernobaseid,
    });
  }

  // Achievements 18 and 19 hear Flash's counter after every Descent attack,
  // win or lose (`ATTACK.as:975`). The attack has landed whatever happens here.
  try {
    await recordAchievementEvents(em, userSave.basesaveid, { descent: update.level }, now);
  } catch (err) {
    logger.error(`Recording Descent achievements for main save ${userSave.basesaveid} failed: ${err}`);
  }

  // Spent: the lock is still held, so a copy of this save finds nothing.
  await endDescentSession(user.userid);

  if (battle) yard.buildinghealthdata = battle.buildinghealthdata;
  return {
    save: yard,
    descent: {
      won: update.won,
      damage: Math.max(0, Math.min(100, Math.floor(battle?.damage ?? 0))),
      level: update.level,
      loot,
      total: purseAmounts(userSave.iresources),
      captured: update.captured,
      infernobaseid: infernobaseid ?? null,
    },
  };
};

/**
 * The server's battle for the save that ends a Descent attack, or null when
 * there is none to fight: no roster in the session, or no usable fling log.
 *
 * @throws {ClientSafeError} `attackResultPendingErr` when the replay timed out.
 */
const descentBattle = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  descent: DescentSession,
  yard: Save
) => {
  const { session } = descent;
  const log = parseFlingLog(saveData.flinglog);
  if (!session.entryHoused || !log) return null;

  const userSave = user.save!;
  const input = battleReplayInput({
    flinglog: descentFightableLog(log, descent.flingerCapacity, session.attackerAcademy),
    session,
    defender: {
      type: String(yard.type),
      kind: "inferno",
      buildingdata: yard.buildingdata as JsonObject | undefined,
      buildinghealthdata: (yard.buildinghealthdata ?? {}) as JsonObject,
      resources: yard.resources as JsonObject | undefined,
    },
    // No catapult and no siege in the Descent: the cut log has neither, and
    // the attacker fights with none.
    attacker: { ...userSave, catapult: 0, siege: null } as never,
    tick: battleTick(saveData.tick),
    declareWar: session.declareWar ?? false,
    left: saveData.left,
    // From yard 7 the fight burns surface monsters (WP 1.21), as the client's does.
    descentYard: descentIndexOf(String(saveData.baseid))! + 1,
  });
  if (!input) return null;

  const base = { baseid: String(saveData.baseid) };
  const fought = await replayBattleForSave(ctx, user, base, input, "a Descent attack has no finaliser, so nothing lands");
  const battle = { ...fought, log: input.log };

  // Where the save disagrees with it: logged, or refused under
  // `COMBAT_SAVE_VALIDATION=reject` before anything is written.
  await recordBattleMismatches(
    ctx,
    user,
    base,
    {
      damage: (ctx.request.body as Record<string, unknown> | undefined)?.damage,
      destroyed: saveData.destroyed,
      buildinghealthdata: saveData.buildinghealthdata,
      buildingdata: saveData.buildingdata,
      attackloot: saveData.attackloot,
      attackerchampion: saveData.attackerchampion,
      attackersiege: saveData.attackersiege,
    },
    battle,
    yard.buildingdata as JsonObject | undefined,
    combatConfig.mode
  );
  return battle;
};

/**
 * Refuses a Descent save that is not the result of this caller's attack on
 * this yard, the way a Map Room 1 tribe save is refused.
 */
const requireDescentBinding = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  now: number
): Promise<DescentSession> => {
  const stored = await readDescentSession(user.userid);
  const descent = stored && stored.baseid === String(saveData.baseid) ? stored : null;
  const submitted = saveData.attackid ? Number(saveData.attackid) : undefined;

  const result = checkAttackBinding({
    session: descent?.session ?? null,
    callerid: user.userid,
    storedAttackId: descent?.session.attackid ?? 0,
    submittedAttackId: submitted,
    now,
  });

  if (result.ok) return descent!;

  logger.warn("Descent save refused for {username} (userid {userid}) on yard {baseid}: {reason}", {
    event: "attack-binding-refused",
    reason: result.reason,
    userid: user.userid,
    username: user.username,
    baseid: saveData.baseid,
    submittedAttackId: saveData.attackid ?? null,
    ip: ctx.ip,
  });

  throw attackNotBoundErr(result.reason);
};
