import { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { Tribes, type Tribe } from "../../../enums/Tribes.js";
import { autoAttackRefusedErr, attackResultPendingErr, baseUnderAttackErr } from "../../../errors/errors.js";
import { MR1_TRIBE_IDS } from "../../../game-data/tribes/v1/index.js";
import { academyRanks, type ResourceAmounts } from "../../../game-rules/combat/index.js";
import { postgres, redis } from "../../../server.js";
import { generateBaseId } from "../../../utils/generateBaseId.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { logger } from "../../../utils/logger.js";
import { baseModeAttack } from "../../../controllers/base/load/modes/baseModeAttack.js";
import { playerMapVersion } from "../../maproom/playerMapVersion.js";
import { calculateTribeLevel } from "../../maproom/v2/calculateTribeLevel.js";
import { ownYardsInReach } from "../../maproom/v2/ownYardsInReach.js";
import { cellCoordsFromBaseId, type CellCoords } from "../../maproom/v2/rangeCheck.js";
import { TAKEOVER_DAMAGE } from "../../maproom/v2/takeoverRules.js";
import { rangeCheckV2 } from "../../maproom/v2/validateRange.js";
import { isWildMonsterExpired } from "../../maproom/wildMonsterExpiry.js";
import { isCampInPlay } from "../../maproom/campInPlay.js";
import { newCheckpoint } from "../attackCheckpoint.js";
import { storeCheckpoint } from "../attackCheckpointStore.js";
import { readAttackSession } from "../attackSessionStore.js";
import { playerLevelOf } from "../calculateBaseLevel.js";
import { finaliseAttacksFor, finaliseExpiredOnBase, landCheckpointedAttack } from "../finaliseAttack.js";
import { isAttackActive } from "../isAttackActive.js";
import { mapSaveData } from "../mapSaveData.js";
import { academyLevels } from "../combat/abandonedAttack.js";
import { catapultLevelOf } from "../combat/bombSpend.js";
import {
  REPEAT_QUEUE_WAIT_MS,
  ReplayTimeoutError,
  isReplayDeferred,
  noteReplayBusy,
  replayAbandonedInWorker,
  reserveReplaySlot,
} from "../combat/replayRunner.js";
import {
  TRIBE_NAMES,
  campKeyOf,
  planLog,
  planNeeds,
  planShortfall,
  puttyShotCost,
  type CampKey,
  type OwnedChampion,
  type PlanShortfall,
} from "./attackPlan.js";
import { findAttackPlan, isUntouchedCamp, type StoredPlan } from "./attackPlanStore.js";
import { planFlingOnBuilding } from "./planCheck.js";
import { repeatFeeFor } from "./repeatFee.js";
import { movesKey, planMoves, type MovePlan, type YardMove } from "./movePlan.js";
import {
  labelsOf,
  makeRepeatMoves,
  repeatYardsFor,
  sizeOfFor,
  undoRepeatMoves,
  type YardLabel,
} from "./repeatMoves.js";

/**
 * Auto-attack (issue #221): the player's last hand-played attack on a Map
 * Room 2 wild monster camp of the same tribe and level, repeated on a camp and
 * resolved by the server at once.
 *
 * The owner's rules (`docs/design/auto-attack.md`, decisions of 2026-10-01):
 * Map Room 2 wild camps only; one attack per press; no partial attacks, so a
 * single missing monster, the champion or a bomb refuses it; one in progress
 * per player and ten a minute.
 *
 * A plan is checked against the camp's fresh layout before it runs (beta 9,
 * `planCheck.ts`): a fling that would land on a standing building refuses the
 * Repeat with nothing spent, and the player records a new plan by hand.
 *
 * The putty fee (owner, 20 Nov 2026, superseding "free beyond the monsters
 * spent"): a heavy convenience fee by the camp's level (`repeatFee.ts`:
 * Lv 25-29 1M, 30-34 1.5M, 35-39 2M, 40-44 2.5M putty since 22 Nov 2026),
 * burned before the attack starts, in the same flush that starts it
 * (`baseModeAttack`'s `beforeCommit`). The pool must hold the fee and the
 * Catapult's putty shots together, or the attack is refused with nothing
 * spent. Once started the fee is gone, won or lost; only an attack that
 * started but can never land (no session, no checkpoint, its row moved on)
 * gets it back. Hand-played attacks stay free. It is a convenience fee, not a
 * promise of a putty loss: a full destroy of a fresh camp can bank more putty
 * than its fee, which the owner accepts (it weighs most on the easy low-level
 * camps, and players still need putty for outpost kits).
 *
 * Nothing comes from the client but the camp's base id. The attack goes
 * through the same doors as a hand-played one: the attack load's own
 * `baseModeAttack` mints the attack and its session, the server writes the
 * checkpoint the client would have sent, from the plan, under a fresh seed,
 * and the finaliser lands it (`landCheckpointedAttack`), holding the attack's
 * final lock. So a server that falls over in between leaves a checkpoint the
 * sweep lands later, exactly once, as it would a hand-played attack.
 */

/** The per-player lock: one auto-attack in progress at a time. */
export const autoAttackLockKey = (userid: number) => `auto-attack:${userid}`;
/**
 * Longer than an auto-attack can take: the line's 15 s, the plan check's
 * 10 s and the landing's 20 s (deadlines counted from the ask, queue time
 * included), plus its database work.
 */
export const AUTO_ATTACK_LOCK_SECONDS = 60;

/** Where the last auto-attack's battle is kept for Watch. */
export const autoAttackReplayKey = (userid: number) => `auto-attack-replay:${userid}`;
export const AUTO_ATTACK_REPLAY_TTL = 60 * 60;

/** A camp to repeat a plan on. */
export interface Camp {
  readonly baseid: string;
  readonly cell: CellCoords;
  readonly key: CampKey;
  /** Its row, or null for a camp nobody has attacked yet. */
  readonly row: Save | null;
  /** Its row is past its 12 hours: the camp has regenerated. */
  readonly expired: boolean;
}

/** Repeat attack's putty fee for a camp; a level no band covers is no camp to repeat. */
const feeOf = (camp: Camp): number => {
  const fee = repeatFeeFor(camp.key.level);
  if (fee === null) throw autoAttackRefusedErr("notACamp");
  return fee;
};

/**
 * The Map Room 2 camp a base id names on the player's own world, or a
 * `notACamp` refusal: a Map Room 1 tribe, a player's yard or outpost, a Map
 * Room 3 structure, the Inferno, another world.
 */
export const campOf = async (userSave: Save, baseid: string, now: number): Promise<Camp> => {
  const cell = cellCoordsFromBaseId(baseid);
  if (MR1_TRIBE_IDS.has(baseid) || !cell || !userSave.worldid) throw autoAttackRefusedErr("notACamp");

  const row = await postgres.em.findOne(Save, { baseid });
  if (row) {
    const key = row.worldid === userSave.worldid ? campKeyOf(row) : null;
    if (!key) throw autoAttackRefusedErr("notACamp");
    return { baseid, cell, key, row, expired: isWildMonsterExpired(row, now) };
  }

  // Nobody has attacked it yet: it is known by its id alone, which has to be
  // this world's id for the cell, and its tribe and level are its
  // coordinates' (`tribeSaveV2.ts`).
  if (baseid !== generateBaseId(userSave.worldid, cell.x, cell.y)) throw autoAttackRefusedErr("notACamp");
  const tribeIndex = (cell.x + cell.y) % Tribes.length;
  const key = { wmid: tribeIndex * 10 + 1, level: calculateTribeLevel(cell.x, cell.y, Tribes[tribeIndex] as Tribe) };
  return { baseid, cell, key, row: null, expired: false };
};

/** What the attacker has for a plan now, and what has to move first. */
interface Assessment {
  /** What they lack: monsters even counting every yard, and champions and bombs. */
  readonly missing: PlanShortfall[];
  /** The planner's verdict (`movePlan.ts`). */
  readonly move: MovePlan;
  /** The yards whose own Flinger reaches the camp. */
  readonly reaching: readonly string[];
  /** Where the yards the verdict names sit. */
  readonly yards: Record<string, YardLabel>;
}

/**
 * What the attacker lacks for a plan right now, and the moves that would
 * gather its monsters into the yards in range (Smart Repeat attack, owner,
 * 16 Nov 2026).
 *
 * Only the yards whose own flinger reaches the camp can fling at it
 * (`ownYardsInReach`, the cells the Attack window sums), each caught up to
 * now without writing, as the attack load's `catchUpArmiesForAttack` will
 * then write it. What they lack may move in from the player's other yards
 * (`planMoves`); a monster is missing only when every yard together lacks it.
 * Champions and bombs are the main yard's, as before.
 */
const assess = async (user: User, camp: Camp, stored: StoredPlan, now: number, fee: number): Promise<Assessment> => {
  const userSave = user.save!;
  const reaching = await ownYardsInReach(user, camp.cell);
  const yards = await repeatYardsFor(user, reaching, now);
  const needs = planNeeds(stored.plan);
  const housed = Object.fromEntries(yards.filter((yard) => yard.reaches).map((yard) => [yard.baseid, { ...yard.housed }]));
  const others = planShortfall(needs, {
    housed,
    champions: userSave.champion as OwnedChampion[] | null,
    catapultLevel: catapultLevelOf(userSave),
    resources: userSave.resources as Record<string, number> | null,
    fee,
  }).filter((item) => item.kind !== "monster");
  const move = planMoves(needs.monsters, yards, sizeOfFor(userSave));
  const monsters: PlanShortfall[] =
    move.kind === "short" ? move.short.map((item) => ({ kind: "monster", id: item.id, need: item.need, have: item.have })) : [];
  return { missing: [...monsters, ...others], move, reaching, yards: labelsOf(yards, move) };
};

/** No room in range for the monsters that would have to move in. */
export interface NoRoom {
  /** Housing space the monsters that must move in take. */
  readonly need: number;
  /** Free housing in each yard in range that could take them. */
  readonly free: readonly { readonly baseid: string; readonly free: number }[];
}

/** The moves, their key, and the housing verdict, as the answers carry them. */
const movesPart = (assessed: Assessment) => {
  // Nothing moves for an attack refused anyway (a champion not ready, say).
  const moves = assessed.move.kind === "moves" && assessed.missing.length === 0 ? assessed.move.moves : [];
  return {
    moves,
    movesKey: moves.length > 0 ? movesKey(moves) : null,
    noRoom:
      assessed.move.kind === "housing" && assessed.missing.length === 0
        ? ({ need: assessed.move.need, free: assessed.move.free } satisfies NoRoom)
        : null,
    yards: assessed.yards,
  };
};

/** A plan as the panels describe it. */
export interface PlanSummary {
  readonly tribe: string;
  readonly level: number;
  /** The camp the plan was played on, and when. */
  readonly recordedOn: { readonly baseid: string; readonly x: number; readonly y: number };
  readonly recordedAt: number;
  readonly monsters: Readonly<Record<string, number>>;
  /** Each champion flung, at the level and power level it would fight at now. */
  readonly champions: readonly { readonly t: number; readonly l: number; readonly pl?: number }[];
  readonly bombs: readonly string[];
  /** The attack used siege weapons, which are not repeated. */
  readonly siege: boolean;
}

const summaryOf = (key: CampKey, stored: StoredPlan, champions: readonly OwnedChampion[] | null | undefined): PlanSummary => {
  const needs = planNeeds(stored.plan);
  const at = cellCoordsFromBaseId(stored.baseid) ?? { x: 0, y: 0 };
  return {
    tribe: TRIBE_NAMES[key.wmid] ?? "Wild monster",
    level: key.level,
    recordedOn: { baseid: stored.baseid, x: at.x, y: at.y },
    recordedAt: stored.recordedAt,
    monsters: needs.monsters,
    champions: needs.champions.map((t) => {
      const owned = (champions ?? []).find((champion) => champion?.t === t);
      const pl = Number(owned?.pl);
      return { t, l: owned?.l ?? 0, ...(Number.isInteger(pl) && pl > 0 && { pl }) };
    }),
    bombs: needs.bombs,
    siege: needs.siege,
  };
};

/** `GET /worldmapv2/autoattack/plan`'s answer. */
export interface PlanAnswer {
  readonly baseid: string;
  /** The plan the camp would repeat, or null when the player has none for it. */
  readonly plan: PlanSummary | null;
  /** What the attacker lacks for it: empty when they have everything. */
  readonly missing: readonly PlanShortfall[];
  /**
   * Monsters to move into the yards in range first (Smart Repeat attack):
   * empty when those yards already hold the army, or when it is refused.
   */
  readonly moves: readonly YardMove[];
  /** The moves' key, sent back with "Move and attack"; null without moves. */
  readonly movesKey: string | null;
  /** The army could be gathered but the yards in range cannot house it; null otherwise. */
  readonly noRoom: NoRoom | null;
  /** Where each yard `moves` and `noRoom` name sits. */
  readonly yards: Readonly<Record<string, YardLabel>>;
  /** The camp is out of the reach of every Flinger the player has. */
  readonly outOfRange: boolean;
  /** Someone is attacking the camp right now. */
  readonly underAttack: boolean;
  /** The camp's damage now; 0 once it has regenerated. */
  readonly damage: number;
  /**
   * No building of the camp is damaged, so a hand attack with monsters on it
   * would save a Repeat plan (`recordAttackPlan`'s own test, patch 8.3). A
   * camp scratched below 1% reads `damage` 0 but is not fresh; one that has
   * regenerated is.
   */
  readonly fresh: boolean;
  /** Repeat attack's putty fee for this camp (`repeatFee.ts`), burned before it starts. */
  readonly fee: number;
}

/**
 * The plan a camp would repeat and whether the player can run it now. Reads
 * only: nothing is caught up, written or reserved. The auto-attack itself
 * checks everything again.
 *
 * @param user - The player, with their main save populated.
 * @param baseid - The camp.
 */
export const autoAttackPlanFor = async (user: User, baseid: string): Promise<PlanAnswer> => {
  const userSave = user.save!;
  if (playerMapVersion(userSave) !== MapRoomVersion.V2) throw autoAttackRefusedErr("notMapRoom2");
  const now = getCurrentDateTime();
  const camp = await campOf(userSave, baseid, now);
  const stored = await findAttackPlan(user.userid, camp.key);
  const underAttack = camp.row !== null && !camp.expired && isAttackActive(camp.row);
  const damage = camp.row && !camp.expired ? (camp.row.damage ?? 0) : 0;
  const fresh = !camp.row || camp.expired || isUntouchedCamp(camp.row.buildinghealthdata);
  const fee = feeOf(camp);
  const none = { moves: [], movesKey: null, noRoom: null, yards: {} };
  if (!stored) return { baseid, plan: null, missing: [], ...none, outOfRange: false, underAttack, damage, fresh, fee };

  const { verdict } = await rangeCheckV2(user, { baseid, cell: camp.cell });
  const assessed = await assess(user, camp, stored, now, fee);
  return {
    baseid,
    plan: summaryOf(camp.key, stored, userSave.champion as OwnedChampion[] | null),
    // Out of range nothing can move in, so only what no yard has is named.
    ...(verdict.ok ? { missing: assessed.missing, ...movesPart(assessed) } : { missing: assessed.missing, ...none }),
    outOfRange: !verdict.ok,
    underAttack,
    damage,
    fresh,
    fee,
  };
};

/** What an auto-attack did, for the result screen. */
export interface AutoAttackResult {
  readonly baseid: string;
  readonly tribe: string;
  readonly level: number;
  /** The camp's damage before and after, whole, and what this attack added. */
  readonly damageBefore: number;
  readonly damageAfter: number;
  readonly damageAdded: number;
  /** At or past the takeover threshold: open to be taken over. */
  readonly conquered: boolean;
  readonly destroyed: 0 | 1;
  /** What landed in the attacker's pool, and what their storage left behind. */
  readonly loot: ResourceAmounts;
  readonly lootLeft: ResourceAmounts;
  /** Monsters spent, per id. */
  readonly flung: Readonly<Record<string, number>>;
  /** Each flung champion's health after the battle, 0 for a death. */
  readonly champions: readonly { readonly t: number; readonly hp: number }[];
  readonly bombs: readonly string[];
  readonly report: string;
  /** The plan this repeated, for Repeat again. */
  readonly plan: PlanSummary;
  /** Monsters moved into the yards in range before the attack (Smart Repeat attack). */
  readonly moved: readonly YardMove[];
  /** Where each yard `moved` names sits. */
  readonly yards: Readonly<Record<string, YardLabel>>;
  /** The putty fee burned before the attack started. */
  readonly fee: number;
}

/**
 * How long the plan check's battle may take, queue time included. With the
 * line's {@link REPEAT_QUEUE_WAIT_MS} and the landing's 20 s it stays inside
 * the {@link AUTO_ATTACK_LOCK_SECONDS} lock.
 */
export const PLAN_CHECK_DEADLINE_MS = 10_000;

/** A 32-bit seed for the new battle; a plan's is never reused. */
const mintSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

/**
 * Runs one auto-attack (see the file comment). The caller has rate-limited
 * the request and checked the Discord age rule.
 *
 * Smart Repeat attack (owner, 16 Nov 2026): when the yards in range lack
 * monsters the player's other yards hold, the moves are made first, in one
 * transaction, but only when `acceptedMoves` is the key of exactly the moves
 * the server works out now (the prompt the player agreed to). Every check that
 * writes nothing runs before them; should the attack load still refuse after
 * the moves were written, they are put back ({@link undoRepeatMoves}), so a
 * refused attack leaves no move behind.
 *
 * @param user - The player, as the request authenticated them.
 * @param baseid - The camp.
 * @param acceptedMoves - The `movesKey` of the moves the player agreed to, if any.
 * @param signal - Aborted when the player has gone (the request closed): a
 *   place in the battle line is given up.
 * @throws {ClientSafeError} `autoAttackRefusedErr` for every refusal, before
 *   anything is written (`movesChanged` when the moves needed are not the
 *   ones agreed to); `baseUnderAttackErr` when someone else is attacking
 *   the camp; `attackResultPendingErr` when the replay ran past its deadline
 *   (the attack then lands from its checkpoint).
 */
export const runAutoAttack = async (
  user: User,
  baseid: string,
  acceptedMoves?: string,
  signal?: AbortSignal
): Promise<AutoAttackResult> => {
  const userid = user.userid;
  const locked = await redis.set(autoAttackLockKey(userid), "1", "EX", String(AUTO_ATTACK_LOCK_SECONDS), "NX");
  if (locked !== "OK") throw autoAttackRefusedErr("inFlight");
  let release: (() => void) | null = null;
  try {
    // As an attack load does: an attack the player left lands first, so its
    // monsters are spent before this one counts what they have, and the
    // camp's own expired attack lands before this one begins (`baseLoad.ts`).
    await finaliseAttacksFor(userid, "auto-attack");
    await finaliseExpiredOnBase(baseid);
    await postgres.em.populate(user, ["save"]);
    const userSave = user.save!;
    if (playerMapVersion(userSave) !== MapRoomVersion.V2) throw autoAttackRefusedErr("notMapRoom2");

    const now = getCurrentDateTime();
    const camp = await campOf(userSave, baseid, now);
    if (camp.row && !camp.expired && isAttackActive(camp.row)) throw baseUnderAttackErr();
    // An expired camp is regrown below, but never under someone's attack (`campInPlay.ts`).
    if (camp.row && camp.expired && (await isCampInPlay(camp.row.basesaveid))) throw baseUnderAttackErr();

    const stored = await findAttackPlan(userid, camp.key);
    if (!stored) throw autoAttackRefusedErr("noPlan");
    const fee = feeOf(camp);

    // The range rule a hand-played attack meets (`validateRange`), refused in
    // words the confirm sheet shows rather than the hand path's bare error.
    const { verdict } = await rangeCheckV2(user, { baseid, cell: camp.cell });
    if (!verdict.ok) throw autoAttackRefusedErr("outOfRange");

    const assessed = await assess(user, camp, stored, now, fee);
    if (assessed.missing.length > 0) throw autoAttackRefusedErr("missing", { missing: assessed.missing });
    const part = movesPart(assessed);
    if (part.noRoom) throw autoAttackRefusedErr("noRoom", { noRoom: part.noRoom, yards: part.yards });
    // Moves the player has not agreed to are never made: the web asks again.
    if (part.movesKey !== null && part.movesKey !== acceptedMoves) throw autoAttackRefusedErr("movesChanged");

    // The line for the battle workers (patch 9.1, `replayGate.ts`): a Repeat
    // waits its turn, its place shown on the working bar
    // (`autoAttackQueuePlace`), and is turned away "busy" only past the
    // line's limits. Inside, it holds no worker: only its battles do.
    release = await reserveReplaySlot(REPEAT_QUEUE_WAIT_MS, { kind: "repeat", who: userid, ...(signal && { signal }) });
    if (!release) throw autoAttackRefusedErr("busy");

    // The plan against the camp's fresh layout (beta 9, `planCheck.ts`): a
    // fling a hand-played attack could not have dropped there is refused
    // before anything moves or is charged. The check fights under the seed
    // the attack will, so a fling into a building its own monsters flattened
    // passes here as it did by hand.
    const seed = mintSeed();
    let clash: Awaited<ReturnType<typeof planFlingOnBuilding>>;
    try {
      clash = await planFlingOnBuilding(
        stored.plan,
        camp.key,
        { academy: userSave.academy, champion: userSave.champion as OwnedChampion[] | null, storedata: userSave.storedata },
        seed,
        now,
        (input) => replayAbandonedInWorker(input, PLAN_CHECK_DEADLINE_MS)
      );
    } catch (err) {
      // Nothing is spent yet: a check the workers could not fight in time is "busy".
      if (isReplayDeferred(err)) {
        noteReplayBusy("repeat");
        throw autoAttackRefusedErr("busy");
      }
      throw err;
    }
    if (clash) {
      logger.info("Repeat attack by {username} refused: plan for {wmid}/{level} flings on a building", {
        event: "auto-attack-plan-on-building",
        userid,
        username: user.username,
        baseid,
        ...camp.key,
        plan: { from: stored.baseid, recordedAt: stored.recordedAt },
        fling: clash,
      });
      throw autoAttackRefusedErr("planOnBuilding", { fling: { t: clash.t, x: clash.x, y: clash.y } });
    }

    const moved =
      part.movesKey === null
        ? []
        : await makeRepeatMoves(user, planNeeds(stored.plan).monsters, assessed.reaching, part.movesKey, now);

    // The fee, burned in the attack load's own commit (`beforeCommit`), on
    // the main save as its catch-up left it: refused there, with nothing of
    // the attack written, when that pool cannot pay the fee and the putty
    // shots together (it may have changed since `assess` read it).
    const planBombs = planNeeds(stored.plan).bombs;
    let charged = false;
    const chargeFee = (attackerSave: Save) => {
      const pool = (attackerSave.resources ?? {}) as Record<string, unknown>;
      const putty = Number(pool["r3"] ?? 0);
      const have = Number.isFinite(putty) ? putty : 0;
      const need = fee + puttyShotCost(planBombs, catapultLevelOf(attackerSave));
      if (have < need) throw autoAttackRefusedErr("missing", { missing: [{ kind: "fee", need, have }] });
      attackerSave.resources = { ...pool, r3: have - fee } as Save["resources"];
      charged = true;
    };
    // An attack that started but can never land gives the fee back, before
    // anything else on this request flushes the save.
    const refundFee = async () => {
      if (!charged) return;
      charged = false;
      const pool = (userSave.resources ?? {}) as Record<string, unknown>;
      userSave.resources = { ...pool, r3: Number(pool["r3"] ?? 0) + fee } as Save["resources"];
      postgres.em.persist(userSave);
      await postgres.em.flush();
    };

    let save: Save;
    let defenderForces: Awaited<ReturnType<typeof baseModeAttack>>["defenderForces"];
    let session: Awaited<ReturnType<typeof readAttackSession>>;
    let log: ReturnType<typeof planLog>;
    try {
      // A regenerated camp is a fresh one, as opening it renews it
      // (`baseModeView.ts`): the old row goes, and the attack load below gives
      // the camp a new one, as it does a camp attacked for the first time.
      if (camp.row && camp.expired) {
        postgres.em.remove(camp.row);
        await postgres.em.flush();
      }

      // Past this point the attack is committed, as a hand-played one is once
      // its load returns: the camp is under attack and the session is minted.
      ({ save, defenderForces } = await baseModeAttack({
        user,
        baseid,
        mapversion: MapRoomVersion.V2,
        attackerLevel: playerLevelOf(userSave),
        beforeCommit: chargeFee,
      }));
      session = await readAttackSession(save.basesaveid);
      if (!session?.entryHoused) throw autoAttackRefusedErr("failed");

      log = planLog(stored.plan, seed, userSave.champion as OwnedChampion[] | null);
      // Once this is written the attack lands, now or by the sweep, and the fee stays spent.
      await storeCheckpoint(
        save.basesaveid,
        newCheckpoint(
          session,
          save.saveuserid,
          { tick: stored.plan.tick, flinglog: log, sources: Object.keys(session.entryHoused) },
          now
        )
      );
    } catch (err) {
      // No attack to land: the fee comes back, and the moves go back where they came from.
      await refundFee();
      if (moved.length > 0) await undoRepeatMoves(user, moved, now);
      throw err;
    }

    // What Watch replays: the camp as this battle found it (`mapSaveData`, as
    // the attack load serves it, over the pool the session recorded).
    const before = {
      ...(await mapSaveData(save, user)),
      resources: session.defenderResources ?? save.resources,
      attackerlevel: session.attackerlevel,
      defenderforces: defenderForces,
    };

    let landed;
    try {
      landed = await landCheckpointedAttack(save.basesaveid, "auto-attack", { left: false, recordPlan: false, repeat: true });
    } catch (err) {
      // Past its deadline the replay wrote nothing; the checkpoint stays and
      // the attack lands on the player's next load or the sweep (issue #138).
      if (err instanceof ReplayTimeoutError) throw attackResultPendingErr();
      throw err;
    }
    // Another landing holds it, or has landed it already: it lands, fee and all.
    if (landed.status === "busy" || landed.status === "none") throw attackResultPendingErr();
    if (landed.status !== "finalised" || !landed.landed) {
      // The row moved on and the checkpoint was dropped: nothing landed, so nothing is spent.
      await refundFee();
      throw autoAttackRefusedErr("failed");
    }
    const { outcome, damageBefore, damageAfter, credited, overflow, bombs, fought } = landed.landed;

    await keepReplay(userid, {
      baseid,
      name: TRIBE_NAMES[camp.key.wmid] ?? "Wild monsters",
      load: before,
      seed: fought.seed,
      events: fought.events,
      tick: landed.landed.tick,
      levels: academyLevels(userSave.academy),
      ranks: academyRanks(userSave.academy),
    });

    const result: AutoAttackResult = {
      baseid,
      tribe: TRIBE_NAMES[camp.key.wmid] ?? "Wild monster",
      level: camp.key.level,
      damageBefore,
      damageAfter,
      damageAdded: Math.max(0, damageAfter - damageBefore),
      conquered: damageAfter >= TAKEOVER_DAMAGE,
      destroyed: outcome.destroyed ?? 0,
      loot: credited,
      lootLeft: overflow,
      flung: outcome.flung,
      champions: outcome.championsFlung.map((t) => ({
        t,
        hp: outcome.attackerchampion?.find((champion) => champion.t === t)?.hp ?? 0,
      })),
      bombs,
      report: outcome.attackreport,
      plan: summaryOf(camp.key, stored, userSave.champion as OwnedChampion[] | null),
      moved,
      yards: assessed.yards,
      fee,
    };

    logger.info("Auto-attack by {username} on camp {baseid}: {damageBefore}% to {damageAfter}%", {
      event: "auto-attack",
      userid,
      username: user.username,
      baseid,
      basesaveid: save.basesaveid,
      plan: { ...camp.key, from: stored.baseid, recordedAt: stored.recordedAt },
      seed: fought.seed,
      damageBefore,
      damageAfter,
      loot: credited,
      fee,
      flung: outcome.flung,
      bombs,
      ...(moved.length > 0 && { moved }),
    });

    return result;
  } finally {
    release?.();
    await redis.del(autoAttackLockKey(userid));
  }
};

/** The last auto-attack's battle, as Watch plays it. */
export interface AutoAttackReplay {
  readonly baseid: string;
  readonly name: string;
  /** The camp as the battle found it, shaped as an attack load. */
  readonly load: Record<string, unknown>;
  readonly seed: number;
  readonly events: readonly unknown[];
  /** The tick the battle was fought to. */
  readonly tick: number;
  /** The attacker's academy levels, which their monsters fought at. */
  readonly levels: Readonly<Record<string, number>>;
  /** The attacker's Monster Lab ranks (issue #352); absent on a replay kept before them. */
  readonly ranks?: Readonly<Record<string, number>>;
  /**
   * Whether Declare War ran (its longer countdown); only on a replay kept
   * before the alliance power-ups were removed. Nothing writes it now.
   */
  readonly declareWar?: boolean;
}

/** Keeps the battle for Watch; never fails the attack that has landed. */
const keepReplay = async (userid: number, replay: AutoAttackReplay): Promise<void> => {
  try {
    await redis.setex(autoAttackReplayKey(userid), AUTO_ATTACK_REPLAY_TTL, JSON.stringify(replay));
  } catch (err) {
    logger.error("Could not keep the auto-attack replay for userid {userid}: {error}", { userid, error: err });
  }
};

/**
 * The player's last auto-attack's battle, or null once it has gone (an hour,
 * or the next auto-attack).
 *
 * @param userid - The player.
 */
export const lastAutoAttackReplay = async (userid: number): Promise<AutoAttackReplay | null> => {
  const raw = await redis.get(autoAttackReplayKey(userid));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AutoAttackReplay;
  } catch {
    return null;
  }
};
