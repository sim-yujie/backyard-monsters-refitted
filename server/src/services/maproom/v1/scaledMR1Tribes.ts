import type { Context } from "koa";
import type { TypeOf } from "zod";
import { attackNotBoundErr, baseGoneErr } from "../../../errors/errors.js";
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
import { bombSpendOf, catapultLevelOf, chargeBombSpend, type BombSpend } from "../../base/combat/bombSpend.js";
import { checkpointSession, parseFlingLog } from "../../base/attackCheckpoint.js";
import type { AbandonedOutcome } from "../../base/combat/abandonedAttack.js";
import { replayAbandonedInWorker } from "../../base/combat/replayRunner.js";
import { endRowlessAttack, landRowlessOnce, type RowlessCheckpoint } from "../../base/rowlessCheckpoint.js";
import { recordBombSpend } from "../../base/combat/recordBombSpend.js";
import { requireFlingsInRoom } from "../../base/combat/recordFlingRoom.js";
import { checkAttackBinding, type AttackSession } from "../../base/attackSession.js";
import { storedDamage } from "../../base/storedDamage.js";
import { championsAfterAttack, championsAfterBattle, siegeAfterAttack } from "../../base/combat/attackerRow.js";
import { championsAfterLessons } from "../../base/combat/championBrain.js";
import {
  RESOURCE_KEYS,
  derivedDestroyed,
  type FlingLog,
  type ResourceAmounts,
} from "../../../game-rules/combat/index.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import type { TribeData } from "../../../types/TribeData.js";
import { battleReplayInput, battleTick } from "../../base/combat/battle.js";
import { recordBattleMismatches, replayBattleForSave } from "../../base/combat/saveBattle.js";
import { creditableMR1Loot, mr1TribePool } from "./mr1TribeRules.js";
import { withTribeGooBonus } from "../../base/tribeGooBonus.js";
import { recordTribeDestroyed } from "../../goals/tribeCounter.js";
import { tribeOfBase } from "../../goals/counters.js";
import { addQuestEvents, questEvent } from "../../quests/state.js";
import { catapultQuestEvents, lootQuestEvents } from "../../quests/hooks.js";
import { recordQuestEvents } from "../../quests/record.js";
import { removedCampStandIn } from "./practiceCamp.js";
import { countAttackLoot } from "../../events/lootEvents.js";
import { plunderPercent, weekendBoostUsed, withPlunderBonus } from "../../events/weekendBoosts.js";
import { recordAttackAchievements } from "../../achievements/events.js";
import {
  acquireMR1TribeFinalLock,
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

/** The tribe as the attack load served it, and the player's stored copy of it. */
interface ServedTribe {
  readonly maproom: Maproom;
  readonly existingTribe: TribeData;
  readonly tribeData: NonNullable<ReturnType<typeof MR1_TRIBES_MAP.get>>;
  readonly tribeSave: Save;
}

const servedTribe = async (user: User, baseid: string): Promise<ServedTribe> => {
  const maproom = await postgres.em.findOne(Maproom, { userid: user.userid });

  if (!maproom) throw new Error(`MapRoom not found for userid: ${user.username}`);

  let existingTribe = maproom.tribedata.find((tribe) => tribe.baseid === baseid);

  // The practice camp, removed by a guide skip during this attack: the attack
  // lands on a stand-in that is never written back.
  if (!existingTribe) {
    existingTribe = removedCampStandIn(baseid);
    if (existingTribe) {
      logger.info("Practice camp attack by {username} (userid {userid}) landed after a guide skip", {
        event: "practice-camp-stand-in",
        userid: user.userid,
        username: user.username,
      });
    }
  }

  // Its entry is gone from the player's Map Room since the attack began.
  if (!existingTribe) {
    logger.warn("Save refused for {username} (userid {userid}): attack on base {baseid} gone", {
      event: "save-base-gone",
      userid: user.userid,
      username: user.username,
      baseid,
      saveType: "attack",
      cause: "tribeGone",
    });
    throw baseGoneErr("tribeGone");
  }

  const tribeData = MR1_TRIBES_MAP.get(baseid);

  if (!tribeData) throw new Error(`No MR1 tribe data found for baseid: ${baseid}`);

  const tribeSave = Object.assign(new Save(), { ...tribeData, baseid });
  return { maproom, existingTribe, tribeData, tribeSave };
};

/** The tribe as the response shows it: its stored health and monsters. */
const tribeAsStored = ({ tribeSave, existingTribe, tribeData }: ServedTribe): Save =>
  Object.assign(tribeSave, {
    buildinghealthdata: existingTribe.tribeHealthData,
    monsters: existingTribe.monsters ?? tribeData.monsters,
  });

const saveTribeAttack = async (ctx: Context, user: User, saveData: BaseSaveData, finalises: boolean) => {
  const userSave = user.save!;
  const now = getCurrentDateTime();

  const session = await requireTribeBinding(ctx, user, saveData, now);
  const served = await servedTribe(user, saveData.baseid);

  if (!finalises) return { save: tribeAsStored(served), credited: null };

  // Worked out before anything is written, so a refusal in `reject` mode
  // leaves every row as it was (issue #90, as `baseSave.ts` does).
  const bombs = recordBombSpend(
    ctx,
    user,
    userSave,
    served.tribeSave,
    saveData.flinglog,
    combatConfig.mode,
    session?.attackerResources
  );

  // Every fling within the Flinger's room (`recordFlingRoom.ts`), checked
  // before anything is written, as the bombs are.
  await requireFlingsInRoom(
    ctx,
    user,
    { baseid: saveData.baseid, rowless: "mr1-tribe" },
    saveData.flinglog,
    session?.attackerAcademy,
    combatConfig.mode,
    session?.attackid,
    "save"
  );

  // The battle, replayed to the client's clock over the tribe as the attack
  // load served it (issue #23, C4), in a worker. A replay past its deadline
  // lands nothing: the save is answered `attackResultPendingErr` and the
  // session is left for a resent save, or for the finaliser to land from the
  // attack's last checkpoint (`finaliseRowlessAttack.ts`).
  const battle = await tribeBattle(ctx, user, saveData, session, served);

  // Only the main yard flings on Map Room 1, and Flash's `attackcreatures`
  // blob is never written.
  const entries = Array.isArray(saveData.monsterupdate) ? saveData.monsterupdate : [];
  return writeTribeLanding(
    user,
    String(saveData.baseid),
    session,
    served,
    battle,
    {
      entries: entries.filter((entry: { baseid?: unknown }) => String(entry?.baseid) === String(userSave.baseid)),
      attackerchampion: saveData.attackerchampion,
      flinglog: saveData.flinglog,
      bombs,
    },
    now
  );
};

/** The server's battle for a tribe attack: the replay's outcome with the camp's `destroyed` and the log it fought. */
type TribeBattle = AbandonedOutcome & { destroyed: number; log: FlingLog };

/** The attacker's side of a landing: what the save (or the checkpoint) says of the attacker's own row. */
interface TribeAttackerSide {
  /** The main yard's `monsterupdate` entries; the fling log decides what leaves. */
  readonly entries: readonly unknown[];
  readonly attackerchampion: unknown;
  readonly flinglog: unknown;
  readonly bombs: BombSpend | null;
}

/**
 * Lands a tribe attack (see `scaledMR1Tribes`) and ends it: the final save's
 * path, and the finaliser's for an attack its attacker left
 * (`finaliseRowlessAttack.ts`). The caller holds the tribe's final lock.
 */
const writeTribeLanding = async (
  user: User,
  baseid: string,
  session: AttackSession,
  served: ServedTribe,
  battle: TribeBattle | null,
  attacker: TribeAttackerSide,
  now: number
) => {
  const userSave = user.save!;
  const { maproom, existingTribe, tribeData } = served;
  const ref = { kind: "mr1" as const, userid: user.userid, baseid };

  const wasDestroyed = Boolean(existingTribe.destroyed);

  // Marked landed before anything is written: whatever a crash after the
  // write leaves behind lands nothing more (`landRowlessOnce`).
  const { credit, credited } = await landRowlessOnce(ref, session, async () => {
    // The tribe keeps its own monsters, the stored ones or its template's: the
    // save's copy is never written (issue #23, C2). What the battle did to it
    // is the replay's; a landing without one writes none of it.
    if (battle) {
      existingTribe.tribeHealthData = battle.buildinghealthdata;
      existingTribe.destroyed = battle.destroyed;
      existingTribe.destroyedAt = battle.destroyed
        ? wasDestroyed ? existingTribe.destroyedAt ?? now : now
        : undefined;
      existingTribe.damage = storedDamage(battle.damage) ?? existingTribe.damage;

      userSave.wmstatus.forEach((tribe) => {
        if (tribe[0] === Number(baseid)) tribe[2] = battle.destroyed;
      });
    }

    // The army settles as a Map Room 2 attack's does (issue #132): the flung
    // monsters leave the main yard's housing as caught up now, capped by what
    // it housed at entry (the session's `entryHoused`).
    await monsterUpdateHandler([...attacker.entries], userSave, {
      session,
      finalises: true,
      flinglog: attacker.flinglog,
      now,
      mapRoom3: false,
    });

    // Read before the champions below are written (`attackLootOf` reads them the same way).
    const krallenBuff = krallenBuffOf(parseFlingLog(attacker.flinglog), userSave.champion);

    // The attacker's own row as the log explains it, not as the save says it
    // (#23, C1): siege less what was used, champion health only downwards,
    // except that a champion the server's battle flung comes home at the
    // replay's health, Vorg heals kept, whatever the save reported.
    if (attacker.attackerchampion) {
      userSave.champion = championsAfterAttack(userSave.champion, attacker.attackerchampion as never, attacker.flinglog);
    }
    if (battle) userSave.champion = championsAfterBattle(userSave.champion, battle, session.championHealth);
    // Each champion that fought learns from the server's battle, once, under
    // the tribe's final lock (issue #219).
    if (battle) userSave.champion = championsAfterLessons(userSave.champion, battle.lessons, battle.log) ?? userSave.champion;
    userSave.siege = siegeAfterAttack(userSave.siege, attacker.flinglog);

    if (attacker.bombs) userSave.resources = chargeBombSpend(attacker.bombs.spend, userSave.resources);

    // The replay's gain, capped by what the tribe has left to give. The tribe
    // gives up the whole credit; the attacker keeps what fits in their
    // storage (issue #166, `bankAttackLoot`), as on Map Room 2.
    const credit = creditableMR1Loot(battle?.attackloot, mr1TribePool(tribeData), existingTribe.looted);
    // Tribe Plunder: the attacker banks that much more; the tribe gives up only `credit` (`weekendBoosts.ts`).
    // Wild tribes also give 25% more Goo (patch 6.9, `tribeGooBonus.ts`).
    const plunder = plunderPercent(true, now);
    const credited: ResourceAmounts = bankAttackLoot(
      userSave,
      withPlunderBonus(withTribeGooBonus(credit, true), plunder),
      krallenBuff
    ).credited;
    if (plunder > 0) weekendBoostUsed(user.userid, "plunder", now);

    const looted = { ...existingTribe.looted };
    for (const key of RESOURCE_KEYS) looted[key] = (looted[key] ?? 0) + credit[key];
    existingTribe.looted = looted;

    postgres.em.persist(maproom);
    postgres.em.persist(userSave);
    await postgres.em.flush();
    return { credit, credited };
  });

  // Event loot (the monthly Krallen Hunt): the tribe's whole credit, before
  // the attacker's cap, once, under the tribe's final lock.
  await countAttackLoot(postgres.em, user.userid, userSave, credit, now);

  // Goals WM1-WM4 (#227): a tribe this replay destroyed, counted on the
  // attacker's main row under its own lock.
  const destroyedNow = !!battle?.destroyed && !wasDestroyed;
  if (destroyedNow) await recordTribeDestroyed(postgres.em, userSave.basesaveid, baseid);
  // Quests: the tribe's loot before the cap (decision 13), a tribe's yard
  // destroyed, which is also a won attack, and catapult hits on the tribe's
  // buildings (from the replayed log, as a Map Room 2 camp's are counted).
  await recordQuestEvents(
    postgres.em,
    userSave.basesaveid,
    addQuestEvents(
      lootQuestEvents(credit),
      destroyedNow ? questEvent("tribeDestroy", tribeOfBase(baseid)) : null,
      destroyedNow ? { attackWin: 1 } : null,
      catapultQuestEvents(battle?.log, tribeData.buildingdata as JsonObject | undefined)
    ),
    now
  );

  // Each biggest Putty bomb fired counts towards Huge Rage (#299), and an
  // attack that damaged a Kozu tribe towards Kozu Hunter (#392); a Map Room 1
  // Kozu tribe destroyed is counted by its tribe counter above, never here.
  await recordAttackAchievements(postgres.em, {
    attackerBasesaveid: userSave.basesaveid,
    defender: {},
    before: null,
    after: null,
    bombs: attacker.bombs?.charges,
    damage: battle?.damage,
    kozuCamp: tribeOfBase(baseid) === "kozu",
  });

  // Spent: the lock is still held, so a copy of this save finds nothing, and
  // the attack's checkpoint goes with it, so the finaliser does not land it again.
  await endRowlessAttack(ref, session.attackid);

  return { save: tribeAsStored(served), credited };
};

/**
 * The replay input for a tribe attack: the tribe as the web client fights it
 * (the template's buildings, the health it has kept since it respawned, the
 * template's pool, as the engine's `"tribe"` kind, `AttackSession.combatKind`),
 * the fling log to `tick`. Shared by the save and the finaliser.
 */
const tribeReplayInput = async (
  user: User,
  session: AttackSession,
  { tribeData, existingTribe }: ServedTribe,
  flinglog: unknown,
  tick: number,
  left: boolean | undefined
) =>
  battleReplayInput({
    flinglog,
    session,
    defender: {
      type: String(tribeData.type),
      kind: "tribe",
      buildingdata: tribeData.buildingdata as JsonObject | undefined,
      buildinghealthdata: (existingTribe.tribeHealthData ?? {}) as JsonObject,
      resources: tribeData.resources as JsonObject | undefined,
    },
    attacker: user.save!,
    tick,
    left,
  });

/**
 * The battle a replay fought: `destroyed` is the client's own figure for a
 * tribe, worked out with a camp's threshold (`attackSave.ts` passes
 * `session.target.kind`, `"wild"`), and the tribe's respawn reads it. The log
 * it fought rides along for the champions' lessons (issue #219).
 */
const tribeBattleOf = (fought: AbandonedOutcome, log: FlingLog): TribeBattle => ({
  ...fought,
  destroyed: derivedDestroyed(fought.damage, "wild") ?? 0,
  log,
});

/**
 * The server's battle for the save that ends a tribe attack (issue #23, C4),
 * or null when there is none to fight: no roster in the session, or no usable
 * fling log.
 *
 * @throws {ClientSafeError} `attackResultPendingErr` when the replay timed out.
 */
const tribeBattle = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  session: AttackSession,
  served: ServedTribe
): Promise<TribeBattle | null> => {
  if (!session.entryHoused) return null;
  const input = await tribeReplayInput(user, session, served, saveData.flinglog, battleTick(saveData.tick), saveData.left);
  if (!input) return null;

  const base = { baseid: saveData.baseid, rowless: "mr1-tribe" as const };
  const battle = tribeBattleOf(
    await replayBattleForSave(ctx, user, base, input, "the finaliser lands it from its checkpoint"),
    input.log
  );

  // Where the save disagrees with it: logged, or refused under
  // `COMBAT_SAVE_VALIDATION=reject` before anything is written (C7). A refused
  // tribe attack is left to the finaliser, which lands the server's own
  // result from the attack's last checkpoint.
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
    served.tribeData.buildingdata as JsonObject | undefined,
    combatConfig.mode
  );
  return battle;
};

/**
 * Lands a tribe attack its attacker left without the final save, from the
 * attack's last checkpoint (`finaliseRowlessAttack.ts`; owner, 2 Nov 2026):
 * the battle replayed to the moment the attacker was last seen, then landed
 * exactly as the final save lands it: the monsters flung by then spent, the
 * bombs charged, the tribe's damage, `destroyed` and loot of that moment.
 * With `replay` false (a replay that keeps failing) there is no battle: the
 * flung monsters and the bombs are spent all the same, and nothing is won.
 * The caller holds the tribe's final lock.
 */
export const landMR1TribeFromCheckpoint = async (
  user: User,
  stored: RowlessCheckpoint,
  now: number,
  replay = true
) => {
  const { checkpoint } = stored;
  const userSave = user.save!;
  const session = checkpointSession(checkpoint);
  const served = await servedTribe(user, stored.baseid);

  let battle: TribeBattle | null = null;
  if (replay && session.entryHoused) {
    const input = await tribeReplayInput(user, session, served, checkpoint.flinglog, checkpoint.tick, true);
    if (input) battle = tribeBattleOf(await replayAbandonedInWorker(input), input.log);
  }

  // Priced against the pool the attack began with, as `recordBombSpend` prices a save's.
  const bombs = bombSpendOf(checkpoint.flinglog, {
    resources: (session.attackerResources as JsonObject | undefined) ?? userSave.resources,
    catapultLevel: catapultLevelOf(userSave),
  });

  return writeTribeLanding(
    user,
    stored.baseid,
    session,
    served,
    battle,
    {
      entries: [{ baseid: userSave.baseid, m: {} }],
      attackerchampion: battle?.attackerchampion,
      flinglog: checkpoint.flinglog,
      bombs,
    },
    now
  );
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
