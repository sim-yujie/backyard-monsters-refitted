import type { Context } from "koa";
import type { TypeOf } from "zod";

import { combatConfig } from "../../config/CombatConfig.js";
import { monsterUpdateHandler } from "../../controllers/base/save/handlers/monsterUpdateHandler.js";
import { InfernoProgress } from "../../database/models/infernoprogress.model.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { attackNotBoundErr } from "../../errors/errors.js";
import type { FlingLog, ResourceAmounts } from "../../game-rules/combat/index.js";
import { BaseSaveSchema } from "../../schemas/BaseSaveSchema.js";
import { postgres } from "../../server.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { SaveData } from "../../types/EntityData.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { recordAchievementEvents } from "../achievements/events.js";
import { checkpointSession, parseFlingLog } from "../base/attackCheckpoint.js";
import type { AbandonedOutcome } from "../base/combat/abandonedAttack.js";
import { replayAbandonedInWorker } from "../base/combat/replayRunner.js";
import { endRowlessAttack, landRowlessOnce, type RowlessCheckpoint } from "../base/rowlessCheckpoint.js";
import { checkAttackBinding } from "../base/attackSession.js";
import { battleReplayInput, battleTick } from "../base/combat/battle.js";
import { championsAfterAttack, championsAfterBattle } from "../base/combat/attackerRow.js";
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
 * (`attack-replay-mismatch`). Where they disagree, even under
 * `COMBAT_SAVE_VALIDATION=reject`, the save is flagged as any other but not
 * refused: the attack lands with the server's own full battle, and the answer
 * says so (`overruled`; owner, 12 Nov 2026). Refusing it left the finaliser to
 * land the attack from its last checkpoint, up to 5 seconds short of the end:
 * less damage, less loot, sometimes a yard that should have fallen.
 *
 * What lands: the flung monsters leave the main yard's housing; the loot goes
 * into the Inferno purse (`iresources`) with no cap; the yard is beaten or
 * keeps its damage (`descentProgressAfter`); the 13th win passes the Descent
 * and makes the player's Inferno yard (`createInfernoYard`); and the
 * achievements hear Flash's Descent counter (18 "Into the Depths" at 1, after
 * any first attack; 19 "Rock Bottom" at 14).
 *
 * A replay past its deadline lands nothing yet: the answer is
 * `attackResultPendingErr` and the session is kept for a resent save, as for
 * a Map Room 1 tribe. An attack left without a final save lands from its last
 * checkpoint, through this same landing (`landDescentFromCheckpoint`,
 * `finaliseRowlessAttack.ts`; owner, 2 Nov 2026).
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
  /**
   * The save's own result disagreed with the server's battle, which landed
   * instead (owner, 12 Nov 2026). Present only then.
   */
  overruled?: true;
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

/** The Descent yard as the start served it, with the player's progress through the Descent. */
interface ServedDescent {
  readonly baseid: string;
  readonly index: number;
  readonly template: SaveData;
  readonly progress: Awaited<ReturnType<typeof readInfernoProgress>>;
  readonly kept: DescentYardState | undefined;
  readonly yard: Save;
}

const servedDescent = async (user: User, baseid: string): Promise<ServedDescent> => {
  const index = descentIndexOf(baseid)!;
  const template = descentYardOf(index);
  const progress = await readInfernoProgress(postgres.em, user.userid);
  const kept = progress.descentYards[baseid];
  return { baseid, index, template, progress, kept, yard: descentYard(template, baseid, kept) };
};

const land = async (ctx: Context, user: User, saveData: BaseSaveData, finalises: boolean) => {
  const userSave = user.save!;
  const now = getCurrentDateTime();
  const baseid = String(saveData.baseid);

  const descent = await requireDescentBinding(ctx, user, saveData, now);
  const served = await servedDescent(user, baseid);

  if (!finalises) return { save: served.yard, descent: null };

  const battle = await descentBattle(ctx, user, saveData, descent, served.yard);

  // Only the main yard flings in the Descent.
  const entries = Array.isArray(saveData.monsterupdate) ? saveData.monsterupdate : [];
  return writeDescentLanding(
    user,
    descent,
    served,
    battle,
    {
      entries: entries.filter((entry: { baseid?: unknown }) => String(entry?.baseid) === String(userSave.baseid)),
      // Overruled, the champions come home as the server's battle left them, as from a checkpoint.
      attackerchampion: battle?.overruled ? battle.attackerchampion : saveData.attackerchampion,
      flinglog: saveData.flinglog,
    },
    now
  );
};

/**
 * The server's battle for a Descent attack, with the log it fought, and
 * whether it overruled the save's own result (`recordBattleMismatches`).
 */
type DescentBattle = AbandonedOutcome & { log: FlingLog; overruled?: boolean };

/** The attacker's side of a landing: what the save (or the checkpoint) says of the attacker's own row. */
interface DescentAttackerSide {
  /** The main yard's `monsterupdate` entries; the fling log decides what leaves. */
  readonly entries: readonly unknown[];
  readonly attackerchampion: unknown;
  readonly flinglog: unknown;
}

/**
 * Lands a Descent attack (see the file comment) and ends it: the final save's
 * path, and the finaliser's for an attack its attacker left
 * (`finaliseRowlessAttack.ts`). The caller holds the Descent's final lock.
 */
const writeDescentLanding = async (
  user: User,
  descent: DescentSession,
  served: ServedDescent,
  battle: DescentBattle | null,
  attacker: DescentAttackerSide,
  now: number
): Promise<{ save: Save; descent: DescentLanded }> => {
  const em = postgres.em;
  const userSave = user.save!;
  const { baseid, index, template, progress, kept, yard } = served;
  const ref = { kind: "descent" as const, userid: user.userid, baseid };

  // Marked landed before anything is written: whatever a crash after the
  // write leaves behind lands nothing more (`landRowlessOnce`).
  const { loot, update, infernobaseid } = await landRowlessOnce(ref, descent.session, async () => {
    // The army leaves the main yard's housing through the fling log, capped by
    // what it housed at the start (the session's `entryHoused`), as a Map Room 1
    // attack's does.
    await monsterUpdateHandler([...attacker.entries], userSave, {
      session: descent.session,
      finalises: true,
      flinglog: attacker.flinglog,
      now,
      mapRoom3: false,
    });

    // The attacker's champions as the log explains them (#23, C1), and what
    // each that fought learned from the server's battle (issue #219). No siege
    // weapon is used in the Descent, so the siege stock is left alone.
    if (attacker.attackerchampion) {
      userSave.champion = championsAfterAttack(userSave.champion, attacker.attackerchampion as never, attacker.flinglog);
    }
    // A champion the server's battle flung comes home at the replay's health,
    // Vorg heals kept, whatever the save reported.
    if (battle) userSave.champion = championsAfterBattle(userSave.champion, battle, descent.session.championHealth);
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
    return { loot, update, infernobaseid };
  });

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

  // Spent: the lock is still held, so a copy of this save finds nothing, and
  // the attack's checkpoint goes with it, so the finaliser does not land it again.
  await endRowlessAttack(ref, descent.session.attackid);

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
      ...(battle?.overruled ? { overruled: true as const } : {}),
    },
  };
};

/**
 * The replay input for a Descent attack: the log cut to what the attack can
 * do (`descentFightableLog`), over the yard as an Inferno yard, to `tick`.
 * Shared by the save and the finaliser.
 */
const descentReplayInput = (
  user: User,
  descent: DescentSession,
  yard: Save,
  log: FlingLog,
  tick: number,
  left: boolean | undefined
) => {
  const { session } = descent;
  return battleReplayInput({
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
    attacker: { ...user.save!, catapult: 0, siege: null } as never,
    tick,
    left,
    // From yard 7 the fight burns surface monsters (WP 1.21), as the client's does.
    descentYard: descentIndexOf(String(yard.baseid))! + 1,
  });
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
): Promise<DescentBattle | null> => {
  const { session } = descent;
  const log = parseFlingLog(saveData.flinglog);
  if (!session.entryHoused || !log) return null;

  const input = descentReplayInput(user, descent, yard, log, battleTick(saveData.tick), saveData.left);
  if (!input) return null;

  const base = { baseid: String(saveData.baseid), rowless: "descent" as const };
  const fought = await replayBattleForSave(ctx, user, base, input, "the finaliser lands it from its checkpoint");
  const battle: DescentBattle = { ...fought, log: input.log };

  // Where the save disagrees with it: flagged, and under
  // `COMBAT_SAVE_VALIDATION=reject` overruled rather than refused: the
  // server's full battle lands (owner, 12 Nov 2026).
  battle.overruled = await recordBattleMismatches(
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
    combatConfig.mode,
    { refuse: false }
  );
  return battle;
};

/**
 * Lands a Descent attack its attacker left without the final save, from the
 * attack's last checkpoint (`finaliseRowlessAttack.ts`; owner, 2 Nov 2026):
 * the battle replayed to the moment the attacker was last seen, then landed
 * exactly as the final save lands it: the monsters flung by then spent, the
 * yard beaten only if that battle beat it, its damage and loot of that
 * moment, and the Descent's counter. With `replay` false (a replay that keeps
 * failing) there is no battle: the flung monsters are spent all the same and
 * the yard keeps what it had. The caller holds the Descent's final lock.
 */
export const landDescentFromCheckpoint = async (
  user: User,
  stored: RowlessCheckpoint,
  now: number,
  replay = true
): Promise<{ save: Save; descent: DescentLanded }> => {
  const { checkpoint } = stored;
  const descent: DescentSession = {
    baseid: stored.baseid,
    flingerCapacity: stored.flingerCapacity,
    session: checkpointSession(checkpoint),
  };
  const served = await servedDescent(user, stored.baseid);

  let battle: DescentBattle | null = null;
  if (replay && descent.session.entryHoused) {
    const input = descentReplayInput(user, descent, served.yard, checkpoint.flinglog, checkpoint.tick, true);
    if (input) battle = { ...(await replayAbandonedInWorker(input)), log: input.log };
  }

  return writeDescentLanding(
    user,
    descent,
    served,
    battle,
    {
      entries: [{ baseid: user.save!.baseid, m: {} }],
      attackerchampion: battle?.attackerchampion,
      flinglog: checkpoint.flinglog,
    },
    now
  );
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
