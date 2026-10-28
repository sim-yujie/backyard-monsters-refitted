import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { Context } from "koa";
import type { TypeOf } from "zod";

import { combatConfig } from "../../config/CombatConfig.js";
import { InfernoMaproom } from "../../database/models/infernomaproom.model.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { attackNotBoundErr, noInfernoYardErr } from "../../errors/errors.js";
import { RESOURCE_KEYS, type ResourceAmounts } from "../../game-rules/combat/index.js";
import { BaseSaveSchema } from "../../schemas/BaseSaveSchema.js";
import { postgres } from "../../server.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { SaveData } from "../../types/EntityData.js";
import type { TribeData } from "../../types/TribeData.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { parseFlingLog } from "../base/attackCheckpoint.js";
import { checkAttackBinding } from "../base/attackSession.js";
import { battleReplayInput, battleTick } from "../base/combat/battle.js";
import { recordBattleMismatches, replayBattleForSave } from "../base/combat/saveBattle.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { creditableMR1Loot, mr1TribePool } from "../maproom/v1/mr1TribeRules.js";
import { countsOf, flungPerYard, subtractHoused } from "../yard/attackRoster.js";
import { catchUpYard } from "../yard/catchUp.js";
import { fundPurse } from "../yard/surfaceInferno.js";
import { descentFightableLog, purseAmounts } from "./descent.js";
import { requireInfernoEnabled } from "./infernoGate.js";
import { syncInfernoCap } from "./infernoLoad.js";
import { infernoTribeOf } from "./infernoTribeMap.js";
import { infernoTribeRespawnAt, infernoTribeYardOf, underHallFallen } from "./infernoTribes.js";
import {
  acquireInfernoTribeFinalLock,
  endInfernoTribeSession,
  readInfernoTribeSession,
  releaseInfernoTribeFinalLock,
  type InfernoTribeSession,
} from "./infernoTribeSession.js";

type BaseSaveData = TypeOf<typeof BaseSaveSchema>;

/**
 * The result of a Moloch tribe attack (`docs/design/inferno.md` §2.7, WP 2.8):
 * a `/base/save` naming a tribe yard, `"214"`-`"234"`, which has no row.
 *
 * Bound to the attack `POST /bm/inferno/attack/start` minted for this caller
 * on this tribe (`infernoTribeSession.ts`), as a Descent save is: anything
 * else is refused before anything is written, and only the save carrying
 * `over` lands, once, under a lock. A save without `over` writes nothing.
 *
 * The battle is the server's: the fling log cut to what the attack can do (no
 * bombs, no siege, each fling within a Housing Bunker's load,
 * `descentFightableLog`), replayed over the tribe as an Inferno yard with the
 * defence the start served. The attack is won when the tribe's Under Hall
 * falls (`ATTACK.as:957-967`); the tribe then lies wrecked for an hour.
 * Otherwise it keeps the health the fight left it.
 *
 * What lands, in one transaction under the main and Inferno yards' locks:
 * - the monsters that fought leave the Inferno yard's Housing Bunkers (the
 *   yard is caught up first, so what hatched meanwhile stays);
 * - the loot, the replay's gain capped by what the tribe has left to give
 *   (`creditableMR1Loot`), goes into the Inferno purse up to its caps:
 *   Flash caps loot on the Inferno yard once the Descent is passed
 *   (`ATTACK.Loot`, `ATTACK.as:703-708`). The tribe gives up the whole
 *   credit, whatever the purse kept;
 * - the tribe's health, damage, wreck and loot given, in `maproom_inferno`.
 *
 * A replay past its deadline lands nothing (`attackResultPendingErr`; the
 * session is kept for a resent save). An attack left without a final save
 * lands nothing, and the monsters stay home.
 */

/** What the landing answers about the tribe, for the report and the map. */
export interface InfernoTribeLanded {
  /** The Under Hall fell. */
  won: boolean;
  /** The server's damage, 0-100. */
  damage: number;
  /** The loot the tribe gave up. */
  loot: ResourceAmounts;
  /** What of it the purse took, up to its caps. */
  lootcredited: ResourceAmounts;
  /** The purse now. */
  total: ResourceAmounts;
  /** When the tribe is back, once it has fallen (unix seconds), else 0. */
  respawnat: number;
}

export const landInfernoTribeAttack = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData
): Promise<{ save: Save; tribe: InfernoTribeLanded | null }> => {
  requireInfernoEnabled();
  const finalises = Boolean(saveData.over);
  const { userid } = user;

  if (finalises && !(await acquireInfernoTribeFinalLock(userid))) throw attackNotBoundErr("finalising");

  try {
    return await land(ctx, user, saveData, finalises);
  } finally {
    if (finalises) await releaseInfernoTribeFinalLock(userid);
  }
};

/** The tribe yard as the start served it: the data file's, with the health it kept. */
const tribeYard = (template: SaveData, baseid: string, kept: TribeData | undefined): Save =>
  Object.assign(new Save(), {
    ...structuredClone(template),
    baseid,
    buildinghealthdata: { ...(kept?.tribeHealthData ?? {}) },
  });

const land = async (ctx: Context, user: User, saveData: BaseSaveData, finalises: boolean) => {
  const em = postgres.em;
  const now = getCurrentDateTime();
  const baseid = String(saveData.baseid);

  const tribe = await requireTribeBinding(ctx, user, saveData, now);
  const template = infernoTribeYardOf(baseid)!;
  const stored = await em.findOne(InfernoMaproom, { userid: user.userid });
  const kept = stored ? infernoTribeOf(stored, baseid) : undefined;
  const yard = tribeYard(template, baseid, kept);

  if (!finalises) return { save: yard, tribe: null };

  const battle = await tribeBattle(ctx, user, saveData, tribe, yard);
  const won = battle ? underHallFallen(template.buildingdata as JsonObject, battle.buildinghealthdata) : false;
  const loot = creditableMR1Loot(battle?.attackloot, mr1TribePool(template), kept?.looted);

  const landed = await em.transactional(async (tx) => {
    const main = await lockMain(tx, user);
    const inferno = await lockArmyYard(tx, user, main);

    // The monsters that fought leave the Housing Bunkers, as caught up now,
    // capped by what they held at the start (`entryHoused`). A yard someone
    // else is attacking right now is only measured, not caught up: their
    // attack owns its row.
    if (!isAttackActive(inferno)) catchUpYard(inferno, now);
    const taken = flungPerYard({
      cells: [{ baseid: inferno.baseid, housed: countsOf(inferno.monsters?.housed) }],
      sent: {},
      entryHoused: tribe.session.entryHoused,
      logged: battle?.flung ?? null,
    });
    inferno.monsters = subtractHoused(inferno.monsters, taken[inferno.baseid]);

    syncInfernoCap(main, inferno);
    const funded = fundPurse(main.iresources, loot);
    main.iresources = funded.iresources;

    const row = (await tx.findOne(InfernoMaproom, { userid: user.userid }, { lockMode: LockMode.PESSIMISTIC_WRITE })) ??
      tx.create(InfernoMaproom, { userid: user.userid });
    const tribedata = [...(row.tribedata ?? [])];
    let state = tribedata.find((entry) => String(entry.baseid) === baseid);
    if (!state) {
      state = { baseid, tribeHealthData: {} };
      tribedata.push(state);
    }
    if (battle) {
      state.tribeHealthData = battle.buildinghealthdata;
      state.damage = Math.max(0, Math.min(100, Math.floor(battle.damage)));
    }
    if (won) {
      state.destroyed = 1;
      state.destroyedAt = now;
    }
    const looted = { ...state.looted };
    for (const key of RESOURCE_KEYS) looted[key] = (looted[key] ?? 0) + loot[key];
    state.looted = looted;
    row.tribedata = tribedata;
    tx.persist(row);

    await tx.flush();
    return { credited: funded.credited, total: purseAmounts(main.iresources), state };
  });

  // Spent: the lock is still held, so a copy of this save finds nothing.
  await endInfernoTribeSession(user.userid);

  if (battle) yard.buildinghealthdata = battle.buildinghealthdata;
  return {
    save: yard,
    tribe: {
      won,
      damage: Math.max(0, Math.min(100, Math.floor(battle?.damage ?? 0))),
      loot,
      lootcredited: landed.credited,
      total: landed.total,
      respawnat: infernoTribeRespawnAt(landed.state),
    },
  };
};

/** The attacker's main row, locked and read afresh: the purse lives on it. */
const lockMain = async (tx: EntityManager, user: User): Promise<Save> => {
  const main = await tx.findOne(
    Save,
    { basesaveid: user.save!.basesaveid },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
  );
  if (!main) throw noInfernoYardErr();
  return main;
};

/** The Inferno yard the army flung from, locked: the one the main save names, theirs. */
const lockArmyYard = async (tx: EntityManager, user: User, main: Save): Promise<Save> => {
  const baseid = Number(main.baseid_inferno);
  if (!(baseid > 0)) throw noInfernoYardErr();
  const inferno = await tx.findOne(
    Save,
    { baseid: String(baseid) },
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
  );
  if (!inferno || inferno.type !== BaseType.INFERNO || inferno.userid !== user.userid) throw noInfernoYardErr();
  return inferno;
};

/**
 * The server's battle for the save that ends a tribe attack, or null when
 * there is none to fight: no roster in the session, or no usable fling log.
 *
 * @throws {ClientSafeError} `attackResultPendingErr` when the replay timed out.
 */
const tribeBattle = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  tribe: InfernoTribeSession,
  yard: Save
) => {
  const { session } = tribe;
  const log = parseFlingLog(saveData.flinglog);
  if (!session.entryHoused || !log) return null;

  const input = battleReplayInput({
    flinglog: descentFightableLog(log, tribe.flingerCapacity, session.attackerAcademy),
    session,
    defender: {
      type: String(yard.type),
      kind: "inferno",
      buildingdata: yard.buildingdata as JsonObject | undefined,
      buildinghealthdata: (yard.buildinghealthdata ?? {}) as JsonObject,
      resources: yard.resources as JsonObject | undefined,
    },
    // The Inferno yard has no champion, catapult or siege: the cut log has no
    // bomb or siege, and a champion fling finds no champion to send.
    attacker: { champion: [], catapult: 0, siege: null },
    tick: battleTick(saveData.tick),
    declareWar: session.declareWar ?? false,
    left: saveData.left,
  });
  if (!input) return null;

  const base = { baseid: String(saveData.baseid) };
  const battle = await replayBattleForSave(ctx, user, base, input, "a Moloch tribe has no finaliser, so nothing lands");

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
 * Refuses a tribe save that is not the result of this caller's attack on this
 * tribe, the way a Descent save is refused.
 */
const requireTribeBinding = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  now: number
): Promise<InfernoTribeSession> => {
  const stored = await readInfernoTribeSession(user.userid);
  const tribe = stored && stored.baseid === String(saveData.baseid) ? stored : null;
  const submitted = saveData.attackid ? Number(saveData.attackid) : undefined;

  const result = checkAttackBinding({
    session: tribe?.session ?? null,
    callerid: user.userid,
    storedAttackId: tribe?.session.attackid ?? 0,
    submittedAttackId: submitted,
    now,
  });

  if (result.ok) return tribe!;

  logger.warn("Moloch tribe save refused for {username} (userid {userid}) on tribe {baseid}: {reason}", {
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
