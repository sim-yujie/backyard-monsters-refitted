import type { Context } from "koa";
import type { TypeOf } from "zod";

import { combatConfig } from "../../../config/CombatConfig.js";
import { monsterUpdateHandler } from "../../../controllers/base/save/handlers/monsterUpdateHandler.js";
import { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import { attackNotBoundErr, baseGoneErr } from "../../../errors/errors.js";
import { yardEventByKey, type YardEventDefinition } from "../../../game-data/events/yardEvents.js";
import { EVENT_OF_YARD } from "../../../game-data/tribes/events/index.js";
import { RESOURCE_KEYS, type FlingLog, type ResourceAmounts } from "../../../game-rules/combat/index.js";
import { BaseSaveSchema } from "../../../schemas/BaseSaveSchema.js";
import { postgres } from "../../../server.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import type { SaveData } from "../../../types/EntityData.js";
import { extractTownHall } from "../../../utils/extractTownHall.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { logger } from "../../../utils/logger.js";
import { checkpointSession, parseFlingLog } from "../../base/attackCheckpoint.js";
import { checkAttackBinding, type AttackSession } from "../../base/attackSession.js";
import type { AbandonedOutcome } from "../../base/combat/abandonedAttack.js";
import { bankAttackLoot, krallenBuffOf } from "../../base/combat/attackLoot.js";
import { championsAfterAttack, championsAfterBattle, siegeAfterAttack } from "../../base/combat/attackerRow.js";
import { battleReplayInput, battleTick } from "../../base/combat/battle.js";
import { bombSpendOf, catapultLevelOf, chargeBombSpend, type BombSpend } from "../../base/combat/bombSpend.js";
import { championsAfterLessons } from "../../base/combat/championBrain.js";
import { recordBombSpend } from "../../base/combat/recordBombSpend.js";
import { requireFlingsInRoom } from "../../base/combat/recordFlingRoom.js";
import { replayAbandonedInWorker } from "../../base/combat/replayRunner.js";
import { startedOnOldPage, stampOf } from "../../base/combat/rulesStamp.js";
import { recordBattleMismatches, replayBattleForSave } from "../../base/combat/saveBattle.js";
import { endRowlessAttack, landRowlessOnce, type RowlessCheckpoint } from "../../base/rowlessCheckpoint.js";
import { storedDamage } from "../../base/storedDamage.js";
import { creditableMR1Loot, mr1TribePool } from "../../maproom/v1/mr1TribeRules.js";
import { recordQuestEvents } from "../../quests/record.js";
import { acquireEventYardFinalLock, readEventYardSession, releaseEventYardFinalLock } from "./eventYardSession.js";
import { fightTemplateOf } from "./yardEventGate.js";
import { yardRunIdAt } from "./yardEventRun.js";
import { payYardPrizes, type PaidPrize } from "./yardPrizes.js";
import { landedState, readYardState, readYardStates, standingHealth, writeYardState, type YardState } from "./yardStore.js";

type BaseSaveData = TypeOf<typeof BaseSaveSchema>;

/**
 * The result of an attack on a Brukkarg event yard (beta 10, bruk-port): a
 * `/base/save` naming an event yard, which has no row. Built on the Map Room
 * 1 tribe landing (`scaledMR1Tribes.ts`), whose rules it keeps:
 *
 * - Bound to the attack the load minted for this caller on this yard
 *   (`eventYardSession.ts`); anything else is refused before anything is
 *   written, and only the save carrying `over` lands, once, under a lock.
 * - The battle is the server's: the fling log replayed over the yard as the
 *   load served it (the engine's `"tribe"` kind, the yard's standing health).
 * - The army leaves the main yard's housing by the fling log; bombs, siege
 *   and champions settle as on Map Room 1.
 * - The loot is the replay's, capped by what the yard has left to give over
 *   the whole run (`looted`, kept across the 24-hour repair so a repaired yard
 *   gives nothing twice), banked up to the storage cap.
 *
 * What it does NOT do, on purpose (lead to confirm): the event loot counts
 * for no other event (no Krallen Hunt ladder, `countAttackLoot`), takes no
 * Tribe Plunder or wild-tribe Goo bonus, earns no loot points, no tribe goals
 * and no monster usage row (that table's `arena` has no event value). The
 * Brukkarg yards hold 4-14 million of each resource; any of those would make
 * them the best farm in the game.
 *
 * The yard is beaten when its Town Hall falls (Flash, upstream
 * `getBaseDestroyed`): then it stays wrecked for the run, the next yard opens
 * and the prizes for that many yards are paid in the same landing
 * (`yardPrizes.ts`). Otherwise it keeps its damage until 24 hours after its
 * first hit.
 *
 * An attack left without its final save lands from its last checkpoint
 * through {@link landEventYardFromCheckpoint} (`finaliseRowlessAttack.ts`).
 */

/** What the landing answers about the event yard, for the result and prize pop-ups. */
export interface EventYardLanded {
  readonly event: string;
  readonly baseid: string;
  /** The Town Hall fell. */
  readonly won: boolean;
  readonly damage: number;
  /** Yards of the event beaten now. */
  readonly beaten: number;
  readonly total: number;
  readonly prizes: readonly PaidPrize[];
}

export const landEventYardAttack = async (ctx: Context, user: User, saveData: BaseSaveData) => {
  const finalises = Boolean(saveData.over);
  const { userid } = user;
  const baseid = String(saveData.baseid);

  if (finalises && !(await acquireEventYardFinalLock(userid, baseid))) throw attackNotBoundErr("finalising");

  try {
    return await saveYardAttack(ctx, user, saveData, finalises);
  } finally {
    if (finalises) await releaseEventYardFinalLock(userid, baseid);
  }
};

/** The yard as the attack load served it, and the player's stored state of it. */
interface ServedYard {
  readonly baseid: string;
  readonly event: YardEventDefinition;
  readonly runId: string;
  readonly template: SaveData;
  readonly state: YardState | null;
  /** The health the attack began with. */
  readonly health: JsonObject;
}

const servedYard = async (user: User, baseid: string, session: AttackSession, now: number): Promise<ServedYard> => {
  const key = EVENT_OF_YARD.get(baseid);
  const event = key ? yardEventByKey(key) : null;
  const runId = key ? yardRunIdAt(key, session.startedat) : null;
  const template = runId ? await fightTemplateOf(postgres.em, user.userid, runId, baseid) : null;
  if (!event || !runId || !template) {
    logger.warn("Save refused for {username} (userid {userid}): event yard {baseid} gone", {
      event: "save-base-gone",
      userid: user.userid,
      username: user.username,
      baseid,
      saveType: "attack",
      cause: "eventYardGone",
    });
    throw baseGoneErr("eventYardGone");
  }
  const state = await readYardState(postgres.em, user.userid, runId, baseid);
  // The health the load served: as it stood when the attack began.
  return { baseid, event, runId, template, state, health: standingHealth(state, session.startedat || now) };
};

/** The yard as the response shows it. */
const yardAsStored = (served: ServedYard, health: JsonObject = served.health): Save =>
  Object.assign(new Save(), { ...structuredClone(served.template), baseid: served.baseid, buildinghealthdata: health });

const saveYardAttack = async (ctx: Context, user: User, saveData: BaseSaveData, finalises: boolean) => {
  const userSave = user.save!;
  const now = getCurrentDateTime();
  const baseid = String(saveData.baseid);

  const session = await requireYardBinding(ctx, user, saveData, now);
  const served = await servedYard(user, baseid, session, now);

  if (!finalises) return { save: yardAsStored(served), credited: null, landed: null };

  const yardSave = yardAsStored(served);
  const bombs = recordBombSpend(ctx, user, userSave, yardSave, saveData.flinglog, combatConfig.mode, session.attackerResources);
  await requireFlingsInRoom(
    ctx,
    user,
    { baseid, rowless: "event-yard" },
    saveData.flinglog,
    session.attackerAcademy,
    combatConfig.mode,
    session.attackid,
    "save"
  );

  const battle = await yardBattle(ctx, user, saveData, session, served);
  const entries = Array.isArray(saveData.monsterupdate) ? saveData.monsterupdate : [];
  return writeYardLanding(
    user,
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

type YardBattle = AbandonedOutcome & { won: boolean; log: FlingLog };

interface YardAttackerSide {
  readonly entries: readonly unknown[];
  readonly attackerchampion: unknown;
  readonly flinglog: unknown;
  readonly bombs: BombSpend | null;
}

/** The Town Hall is down in `health` (0 health): the attack is won. */
export const townHallDown = (buildingdata: unknown, health: JsonObject): boolean => {
  const hall = extractTownHall((buildingdata ?? {}) as JsonObject);
  if (!hall) return false;
  const left = health[String(hall.id)];
  return left !== undefined && Number(left) <= 0;
};

/** Every resource the yard gives up now added to what it gave before. */
const addLooted = (looted: Partial<ResourceAmounts>, credit: ResourceAmounts): Partial<ResourceAmounts> => {
  const out = { ...looted };
  for (const key of RESOURCE_KEYS) out[key] = (out[key] ?? 0) + credit[key];
  return out;
};

const writeYardLanding = async (
  user: User,
  session: AttackSession,
  served: ServedYard,
  battle: YardBattle | null,
  attacker: YardAttackerSide,
  now: number
): Promise<{ save: Save; credited: ResourceAmounts; landed: EventYardLanded }> => {
  const userSave = user.save!;
  const { baseid, event, runId, template, state } = served;
  const ref = { kind: "event" as const, userid: user.userid, baseid };
  const wasDestroyed = Boolean(state?.destroyed);

  const { credited, hatched, landed, health } = await landRowlessOnce(ref, session, () =>
    postgres.em.transactional(async (tx) => {
      const hatched = await monsterUpdateHandler([...attacker.entries], userSave, {
        session,
        finalises: true,
        flinglog: attacker.flinglog,
        now,
        mapRoom3: false,
      });

      const krallenBuff = krallenBuffOf(parseFlingLog(attacker.flinglog), userSave.champion);
      if (attacker.attackerchampion) {
        userSave.champion = championsAfterAttack(userSave.champion, attacker.attackerchampion as never, attacker.flinglog);
      }
      if (battle) userSave.champion = championsAfterBattle(userSave.champion, battle, session.championHealth);
      if (battle) userSave.champion = championsAfterLessons(userSave.champion, battle.lessons, battle.log) ?? userSave.champion;
      userSave.siege = siegeAfterAttack(userSave.siege, attacker.flinglog);
      if (attacker.bombs) userSave.resources = chargeBombSpend(attacker.bombs.spend, userSave.resources);

      // The replay's gain, capped by what the yard has left to give this run.
      const credit = creditableMR1Loot(battle?.attackloot, mr1TribePool(template), state?.looted);
      const credited: ResourceAmounts = bankAttackLoot(userSave, credit, krallenBuff).credited;

      // The yard: a battle's health and win; without one (a replay that kept
      // failing) only the loot count moves, nothing is won.
      const won = wasDestroyed || Boolean(battle?.won);
      const health = battle ? (battle.buildinghealthdata as JsonObject) : served.health;
      const next = landedState(
        state,
        {
          health,
          destroyed: won,
          damage: battle ? (storedDamage(battle.damage) ?? 0) : (state?.damage ?? 0),
          looted: addLooted(state?.looted ?? {}, credit),
        },
        now
      );
      await writeYardState(tx, user.userid, runId, baseid, next);

      const states = await readYardStates(tx, user.userid, runId);
      const beaten = [...states.values()].filter((one) => one.destroyed).length;
      const prizes = won && !wasDestroyed ? await payYardPrizes(tx, user.userid, runId, event, beaten, userSave) : [];

      tx.persist(userSave);
      await tx.flush();
      const total = event.prizes.length > 0 ? Math.max(...event.prizes.map((prize) => prize.yards)) : states.size;
      const landed: EventYardLanded = {
        event: event.key,
        baseid,
        won,
        damage: next.damage,
        beaten,
        total,
        prizes,
      };
      return { credited, hatched, landed, health };
    })
  );

  // Quests: only the monsters that hatched on the main yard during the attack
  // (no tribe or loot quests: see the file comment).
  await recordQuestEvents(postgres.em, userSave.basesaveid, hatched, now);

  if (landed.won && !wasDestroyed) {
    logger.info("Event yard beaten", { event: "event-yard-beaten", userid: user.userid, baseid, run: runId, beaten: landed.beaten });
  }

  await endRowlessAttack(ref, session.attackid);
  return { save: yardAsStored(served, health), credited, landed };
};

const yardReplayInput = async (
  user: User,
  session: AttackSession,
  served: ServedYard,
  flinglog: unknown,
  tick: number,
  left: boolean | undefined
) =>
  battleReplayInput({
    flinglog,
    session,
    defender: {
      type: String(served.template.type ?? "tribe"),
      kind: "tribe",
      buildingdata: served.template.buildingdata as JsonObject | undefined,
      buildinghealthdata: served.health,
      resources: served.template.resources as JsonObject | undefined,
    },
    attacker: user.save!,
    tick,
    left,
  });

const yardBattleOf = (fought: AbandonedOutcome, log: FlingLog, served: ServedYard): YardBattle => ({
  ...fought,
  won: townHallDown(served.template.buildingdata, fought.buildinghealthdata as JsonObject),
  log,
});

const yardBattle = async (
  ctx: Context,
  user: User,
  saveData: BaseSaveData,
  session: AttackSession,
  served: ServedYard
): Promise<YardBattle | null> => {
  if (!session.entryHoused) return null;
  const input = await yardReplayInput(user, session, served, saveData.flinglog, battleTick(saveData.tick), saveData.left);
  if (!input) return null;

  const base = { baseid: String(saveData.baseid), rowless: "event-yard" as const };
  const battle = yardBattleOf(
    await replayBattleForSave(ctx, user, base, input, "the finaliser lands it from its checkpoint"),
    input.log,
    served
  );
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
    served.template.buildingdata as JsonObject | undefined,
    combatConfig.mode,
    { oldPage: startedOnOldPage(session.rules), pageRules: stampOf(ctx.request.body) }
  );
  return battle;
};

/**
 * Lands an event yard attack its attacker left without the final save, from
 * the attack's last checkpoint (`finaliseRowlessAttack.ts`), exactly as the
 * Map Room 1 tribe's (`landMR1TribeFromCheckpoint`). The caller holds the
 * yard's final lock.
 */
export const landEventYardFromCheckpoint = async (user: User, stored: RowlessCheckpoint, now: number, replay = true) => {
  const { checkpoint } = stored;
  const userSave = user.save!;
  const session = checkpointSession(checkpoint);
  const served = await servedYard(user, stored.baseid, session, now);

  let battle: YardBattle | null = null;
  if (replay && session.entryHoused) {
    const input = await yardReplayInput(user, session, served, checkpoint.flinglog, checkpoint.tick, true);
    if (input) battle = yardBattleOf(await replayAbandonedInWorker(input), input.log, served);
  }

  const bombs = bombSpendOf(checkpoint.flinglog, {
    resources: (session.attackerResources as JsonObject | undefined) ?? userSave.resources,
    catapultLevel: catapultLevelOf(userSave),
  });

  return writeYardLanding(
    user,
    session,
    served,
    battle,
    { entries: [{ baseid: userSave.baseid, m: {} }], attackerchampion: battle?.attackerchampion, flinglog: checkpoint.flinglog, bombs },
    now
  );
};

/** Refuses a save that is not the result of this caller's attack on this yard. */
const requireYardBinding = async (ctx: Context, user: User, saveData: BaseSaveData, now: number): Promise<AttackSession> => {
  const session = await readEventYardSession(user.userid, String(saveData.baseid));
  const result = checkAttackBinding({
    session,
    callerid: user.userid,
    storedAttackId: session?.attackid ?? 0,
    submittedAttackId: saveData.attackid ? Number(saveData.attackid) : undefined,
    now,
  });
  if (result.ok) return session!;

  logger.warn("Event yard save refused for {username} (userid {userid}) on yard {baseid}: {reason}", {
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
