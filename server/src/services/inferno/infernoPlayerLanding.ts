import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { Context } from "koa";
import type { TypeOf } from "zod";

import { combatConfig } from "../../config/CombatConfig.js";
import { buildingDataHandler } from "../../controllers/base/save/handlers/buildingDataHandler.js";
import { InfernoMaproom } from "../../database/models/infernomaproom.model.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { attackNotBoundErr, noInfernoYardErr } from "../../errors/errors.js";
import { HOUSING_BUNKER_TYPE, RESOURCE_KEYS, type FlingLog, type ResourceAmounts } from "../../game-rules/combat/index.js";
import { BaseSaveSchema } from "../../schemas/BaseSaveSchema.js";
import { postgres } from "../../server.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { NeighbourData } from "../../types/NeighbourData.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { parseFlingLog } from "../base/attackCheckpoint.js";
import { checkAttackBinding } from "../base/attackSession.js";
import { buildingDataWithout, type AbandonedInput, type AbandonedOutcome } from "../base/combat/abandonedAttack.js";
import { attackLootOf, type AttackLoot } from "../base/combat/attackLoot.js";
import { battleReplayInput, battleTick, foughtLoot } from "../base/combat/battle.js";
import { garrisonsAfterBattle } from "../base/combat/bunkerGarrison.js";
import { housedDefenders } from "../base/combat/defenderForces.js";
import { recordBattleMismatches, replayBattleForSave } from "../base/combat/saveBattle.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { storedDamage } from "../base/storedDamage.js";
import { createNeighbourData } from "../maproom/createNeighbourData.js";
import { damageProtection } from "../maproom/v2/damageProtection.js";
import { countsOf, flungPerYard, subtractHoused, type Counts } from "../yard/attackRoster.js";
import { catchUpYard } from "../yard/catchUp.js";
import { fundPurse, lootPurse } from "../yard/surfaceInferno.js";
import { descentFightableLog, purseAmounts } from "./descent.js";
import { requireInfernoEnabled } from "./infernoGate.js";
import { syncInfernoCap } from "./infernoLoad.js";
import {
  acquireInfernoPlayerFinalLock,
  endInfernoPlayerSession,
  readInfernoPlayerSession,
  releaseInfernoPlayerFinalLock,
  type InfernoPlayerSession,
} from "./infernoPlayerSession.js";
import { housedAfterBattle, inInfernoRange, withAttackFrom, withAttackOn } from "./infernoPvp.js";
import { infernoYardLevel } from "./infernoTribes.js";

type BaseSaveData = TypeOf<typeof BaseSaveSchema>;

/**
 * The result of an attack on another player's Inferno yard
 * (`docs/design/inferno.md` §2.7, WP 3.3): a `/base/save` naming that yard's
 * row, from anyone but its owner.
 *
 * Bound to the attack `POST /bm/inferno/attack/start` minted on this yard for
 * this caller (`infernoPlayerSession.ts`, the row's `attackid`): anything else
 * is refused before anything is written, and only the save carrying `over`
 * lands, once, under a lock. A save without `over` writes nothing. An attack
 * left without a final save is closed by the server from its last checkpoint
 * (`infernoPlayerFinalise.ts`, owner 27 Oct), through the same landing.
 *
 * The battle is the server's: the fling log cut to what the attack can do (no
 * bombs, no siege, each fling within a Housing Bunker's load), replayed over
 * the yard as it stood when the attack began, with the defence and the purse
 * the start served. What lands, in one transaction, the attacker's rows
 * locked first, then the defender's, each main row before its Inferno yard:
 * - the monsters that fought leave the attacker's Housing Bunkers;
 * - the loot (`attackLootOf`, the client's claim held to the replay's) goes
 *   into the attacker's Inferno purse up to its caps, and the defender's
 *   purse loses at least what was credited and at most what the replay took,
 *   never below 0;
 * - the defender's yard keeps the replay's health, damage, fired traps and
 *   report; each Housing Bunker still standing keeps the monsters the battle
 *   left it, one that fell loses all it housed (`housedAfterBattle`); the
 *   attack mark is cleared;
 * - the defender gets Inferno damage protection by the surface rule
 *   (`damageProtection.ts`, §2.7: 4 attacks in an hour, 1 hour; 50% or more,
 *   36 hours);
 * - the revenge counters: one more attack from the attacker on the
 *   defender's list, one more on the defender on the attacker's, paid back
 *   when it was out of range (`withAttackFrom`, `withAttackOn`).
 */

/** What the landing answers about the attack, for the client. */
export interface InfernoPlayerLanded {
  /** The server's damage, 0-100. */
  damage: number;
  /** What the attack took from the defender's purse. */
  loot: ResourceAmounts;
  /** What of it the attacker's purse took, up to its caps. */
  lootcredited: ResourceAmounts;
  /** The attacker's purse now. */
  total: ResourceAmounts;
  /** The housed monsters the defender lost with their fallen Housing Bunkers. */
  housedlost: Counts;
}

/** What the landing hands back: the yard, and on the final save what landed with the notice's facts. */
export interface InfernoPlayerLanding {
  save: Save;
  player: InfernoPlayerLanded | null;
}

export const landInfernoPlayerAttack = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  yard: Save
): Promise<InfernoPlayerLanding> => {
  requireInfernoEnabled();
  const finalises = Boolean(saveData.over);
  const key = yard.basesaveid;

  if (finalises && !(await acquireInfernoPlayerFinalLock(key))) throw attackNotBoundErr("finalising");

  try {
    return await land(ctx, user, saveData, yard, finalises);
  } finally {
    if (finalises) await releaseInfernoPlayerFinalLock(key);
  }
};

const land = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  yard: Save,
  finalises: boolean
): Promise<InfernoPlayerLanding> => {
  const now = getCurrentDateTime();
  const attack = await requirePlayerBinding(ctx, user, saveData, yard, now);
  if (!finalises) return { save: yard, player: null };

  const battle = await playerBattle(ctx, user, saveData, attack, yard);
  const loot = playerLoot(
    attack,
    yard,
    { sent: saveData.attackloot, reported: saveData.resources, flinglog: saveData.flinglog },
    battle
  );
  return writePlayerLanding(user, attack, yard, battle, loot, now);
};

/** The fightable part of a fling log, replayed over the yard as an Inferno yard (see the file comment). */
export const playerReplayInput = (
  attack: InfernoPlayerSession,
  yard: Save,
  log: FlingLog,
  tick: number,
  left: boolean | undefined
): AbandonedInput | null =>
  battleReplayInput({
    flinglog: descentFightableLog(log, attack.flingerCapacity, attack.session.attackerAcademy),
    session: attack.session,
    defender: {
      type: String(yard.type),
      kind: "inferno",
      buildingdata: yard.buildingdata as JsonObject | undefined,
      buildinghealthdata: (yard.buildinghealthdata ?? {}) as JsonObject,
      resources: null,
    },
    // The Inferno yard has no champion, catapult or siege.
    attacker: { champion: [], catapult: 0, siege: null },
    tick,
    declareWar: attack.session.declareWar ?? false,
    left,
  });

/**
 * The loot by the surface save's rule (`attackLootOf`): the client's claim
 * (or the replay's own figures, for an attack closed from its checkpoint)
 * held to the server's battle, over the purse the start froze.
 */
export const playerLoot = (
  attack: InfernoPlayerSession,
  yard: Save,
  claim: { sent: unknown; reported: unknown; flinglog: unknown },
  battle: AbandonedOutcome | null
): AttackLoot => {
  const purseAtStart = attack.session.defenderResources ?? { r1: 0, r2: 0, r3: 0, r4: 0 };
  return attackLootOf({
    ...claim,
    session: attack.session,
    defender: {
      type: String(yard.type),
      buildingdata: yard.buildingdata as never,
      buildinghealthdata: yard.buildinghealthdata as never,
      resources: purseAtStart as unknown as JsonObject,
    },
    attacker: { academy: null, champion: [], catapult: 0, buildingdata: null },
    mapRoom3: false,
    fought: battle ? foughtLoot(battle) : null,
  });
};

/**
 * Lands the attack (see the file comment) and ends its session: the final
 * save's path, and the finaliser's for an attack its attacker left
 * (`infernoPlayerFinalise.ts`). The caller holds the attack's final lock.
 *
 * @param user - The attacker, with their main save.
 * @param yard - The defender's Inferno yard.
 * @param battle - The server's battle, or null when there was none to fight.
 */
export const writePlayerLanding = async (
  user: User,
  attack: InfernoPlayerSession,
  yard: Save,
  battle: AbandonedOutcome | null,
  loot: AttackLoot,
  now: number
): Promise<InfernoPlayerLanding> => {
  const em = postgres.em;
  const landed = await em.transactional(async (tx) => {
    const main = await lockRow(tx, { basesaveid: user.save!.basesaveid });
    const inferno = await lockArmyYard(tx, user, main);
    const defenderMain = await tx.findOne(
      Save,
      { userid: yard.userid, type: BaseType.MAIN },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    );
    const target = await lockRow(tx, { basesaveid: yard.basesaveid });

    // The monsters that fought leave the attacker's Housing Bunkers, as caught
    // up now, capped by what they held at the start (`entryHoused`).
    if (!isAttackActive(inferno)) catchUpYard(inferno, now);
    const taken = flungPerYard({
      cells: [{ baseid: inferno.baseid, housed: countsOf(inferno.monsters?.housed) }],
      sent: {},
      entryHoused: attack.session.entryHoused,
      logged: battle?.flung ?? null,
    });
    inferno.monsters = subtractHoused(inferno.monsters, taken[inferno.baseid]);

    // The loot: out of the defender's purse, into the attacker's up to its caps.
    const loss: ResourceAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
    for (const key of RESOURCE_KEYS) loss[key] = -Math.min(0, loot.defenderDelta[key]);
    const looted = lootPurse(defenderMain?.iresources, loss);
    if (defenderMain) defenderMain.iresources = looted.iresources;
    syncInfernoCap(main, inferno);
    const funded = fundPurse(main.iresources, loot.credit);
    main.iresources = funded.iresources;

    // The defender's yard as the battle left it.
    let housedLost: Counts = {};
    if (battle) {
      const before = { ...(target.buildinghealthdata ?? {}) };
      buildingDataHandler(buildingDataWithout(target.buildingdata as JsonObject, battle.firedTraps), target);
      target.buildinghealthdata = battle.buildinghealthdata as Save["buildinghealthdata"];
      target.damage = storedDamage(battle.damage) ?? target.damage;
      if (battle.destroyed !== undefined) target.destroyed = battle.destroyed;
      (target as unknown as { attackreport: unknown }).attackreport = battle.attackreport;
      // A Monster Bunker keeps what the battle left it; the Housing Bunkers'
      // monsters are the yard's housed ones, never a garrison of their own.
      target.buildingdata = garrisonsAfterBattle(target.buildingdata, {
        buildinghealthdata: battle.buildinghealthdata,
        bunkerGarrisons: monsterBunkersOnly(target.buildingdata, battle.bunkerGarrisons),
      });
      const housed = housedAfterBattle({
        buildingdata: target.buildingdata,
        housed: housedDefenders(target.monsters),
        before,
        after: battle.buildinghealthdata,
        garrisons: battle.bunkerGarrisons,
      });
      target.monsters = { ...(target.monsters ?? {}), housed: housed.housed };
      housedLost = housed.lost;
    }
    target.attackid = 0;
    await damageProtection(target, undefined, tx);

    await countRevenge(tx, user, inferno, target, now);

    await tx.flush();
    return {
      credited: funded.credited,
      lost: looted.lost,
      total: purseAmounts(main.iresources),
      housedLost,
      target,
    };
  });

  // Spent: the lock is still held, so a copy of this save finds nothing.
  await endInfernoPlayerSession(yard.basesaveid);

  return {
    save: landed.target,
    player: {
      damage: Math.max(0, Math.min(100, Math.floor(battle?.damage ?? 0))),
      loot: landed.lost,
      lootcredited: landed.credited,
      total: landed.total,
      housedlost: landed.housedLost,
    },
  };
};

/** The garrisons of the Monster Bunkers alone: a Housing Bunker's monsters are the yard's housed ones. */
const monsterBunkersOnly = (
  buildingdata: Save["buildingdata"],
  garrisons: Readonly<Record<number, Readonly<Record<string, number>>>>
): Record<number, Readonly<Record<string, number>>> => {
  const housing = new Set(
    Object.entries(buildingdata ?? {})
      .filter(([, entry]) => Number(entry?.t) === HOUSING_BUNKER_TYPE)
      .map(([key, entry]) => Math.floor(Number(entry?.id ?? key)))
  );
  return Object.fromEntries(Object.entries(garrisons).filter(([id]) => !housing.has(Number(id))));
};

/**
 * The revenge counters (`maproom_inferno.neighbors`): one more attack from
 * the attacker on the defender's list, one more on the defender on the
 * attacker's, paid back when the defender was out of the attacker's range.
 * Either row is made when missing.
 */
const countRevenge = async (tx: EntityManager, user: User, inferno: Save, target: Save, now: number): Promise<void> => {
  const mine = infernoYardLevel(inferno);
  const theirs = infernoYardLevel(target);
  const clock = new Date(now * 1000);
  const owner = await tx.findOne(User, { userid: target.userid }, { fields: ["username", "pic_square"] });
  const entryOf = (save: Save, level: number, name: string, pic: string | null | undefined): NeighbourData =>
    createNeighbourData({ userid: save.userid, baseid: save.baseid, lastupdateAt: clock }, { username: name, pic_square: pic ?? "" }, level);

  const rowOf = async (userid: number) =>
    (await tx.findOne(InfernoMaproom, { userid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })) ??
    tx.create(InfernoMaproom, { userid });

  const attackerRow = await rowOf(user.userid);
  attackerRow.neighbors = withAttackOn(
    attackerRow.neighbors ?? [],
    entryOf(target, theirs, owner?.username ?? "", owner?.pic_square),
    !inInfernoRange(mine, theirs)
  );
  tx.persist(attackerRow);

  const defenderRow = await rowOf(target.userid);
  defenderRow.neighbors = withAttackFrom(
    defenderRow.neighbors ?? [],
    entryOf(inferno, mine, user.username, user.pic_square)
  );
  tx.persist(defenderRow);
};

/** A row, locked and read afresh. */
const lockRow = async (tx: EntityManager, where: { basesaveid: number }): Promise<Save> => {
  const row = await tx.findOne(Save, where, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
  if (!row) throw noInfernoYardErr();
  return row;
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
 * The server's battle for the save that ends the attack, or null when there
 * is none to fight: no roster in the session, or no usable fling log.
 *
 * @throws {ClientSafeError} `attackResultPendingErr` when the replay timed out.
 */
const playerBattle = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  attack: InfernoPlayerSession,
  yard: Save
) => {
  const log = parseFlingLog(saveData.flinglog);
  if (!attack.session.entryHoused || !log) return null;

  const input = playerReplayInput(attack, yard, log, battleTick(saveData.tick), saveData.left);
  if (!input) return null;

  const base = { baseid: String(saveData.baseid) };
  const battle = await replayBattleForSave(ctx, user, base, input, "the attack is closed from its last checkpoint");

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
 * Refuses a save on an Inferno yard that is not the result of this caller's
 * attack on it, the way a surface attack save is refused.
 */
const requirePlayerBinding = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  yard: Save,
  now: number
): Promise<InfernoPlayerSession> => {
  const stored = await readInfernoPlayerSession(yard.basesaveid);
  const attack = stored && stored.baseid === yard.baseid ? stored : null;
  const submitted = saveData.attackid ? Number(saveData.attackid) : undefined;

  const result = checkAttackBinding({
    session: attack?.session ?? null,
    callerid: user.userid,
    storedAttackId: Number(yard.attackid) || 0,
    submittedAttackId: submitted,
    now,
  });

  if (result.ok) return attack!;

  logger.warn("Inferno player attack save refused for {username} (userid {userid}) on yard {baseid}: {reason}", {
    event: "attack-binding-refused",
    reason: result.reason,
    userid: user.userid,
    username: user.username,
    baseid: yard.baseid,
    submittedAttackId: saveData.attackid ?? null,
    ip: ctx.ip,
  });

  throw attackNotBoundErr(result.reason);
};
