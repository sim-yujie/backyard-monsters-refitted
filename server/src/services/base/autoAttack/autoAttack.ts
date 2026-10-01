import { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { Tribes, type Tribe } from "../../../enums/Tribes.js";
import { autoAttackRefusedErr, attackResultPendingErr, baseUnderAttackErr } from "../../../errors/errors.js";
import { MR1_TRIBE_IDS } from "../../../game-data/tribes/v1/index.js";
import type { ResourceAmounts } from "../../../game-rules/combat/index.js";
import { postgres, redis } from "../../../server.js";
import { generateBaseId } from "../../../utils/generateBaseId.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { logger } from "../../../utils/logger.js";
import { baseModeAttack } from "../../../controllers/base/load/modes/baseModeAttack.js";
import { isDeclareWarRunning, runningPowerups } from "../../alliance/powerups.js";
import { playerMapVersion } from "../../maproom/playerMapVersion.js";
import { calculateTribeLevel } from "../../maproom/v2/calculateTribeLevel.js";
import { cellCoordsFromBaseId, outpostsNearCell, type CellCoords } from "../../maproom/v2/rangeCheck.js";
import { TAKEOVER_DAMAGE } from "../../maproom/v2/takeoverRules.js";
import { rangeCheckV2, validateRange } from "../../maproom/v2/validateRange.js";
import { isWildMonsterExpired } from "../../maproom/wildMonsterExpiry.js";
import { catchUpArmyRow } from "../../yard/armies.js";
import { countsOf, type EntryHoused } from "../../yard/attackRoster.js";
import { newCheckpoint } from "../attackCheckpoint.js";
import { storeCheckpoint } from "../attackCheckpointStore.js";
import { readAttackSession } from "../attackSessionStore.js";
import { playerLevelOf } from "../calculateBaseLevel.js";
import { finaliseAttacksFor, finaliseExpiredOnBase, landCheckpointedAttack } from "../finaliseAttack.js";
import { isAttackActive } from "../isAttackActive.js";
import { mapSaveData } from "../mapSaveData.js";
import { academyLevels } from "../combat/abandonedAttack.js";
import { catapultLevelOf } from "../combat/bombSpend.js";
import { ReplayTimeoutError, reserveReplaySlot } from "../combat/replayRunner.js";
import {
  TRIBE_NAMES,
  campKeyOf,
  planLog,
  planNeeds,
  planShortfall,
  type CampKey,
  type OwnedChampion,
  type PlanShortfall,
} from "./attackPlan.js";
import { findAttackPlan, type StoredPlan } from "./attackPlanStore.js";

/**
 * Auto-attack (issue #221): the player's last hand-played attack on a Map
 * Room 2 wild monster camp of the same tribe and level, repeated on a camp and
 * resolved by the server at once.
 *
 * The owner's rules (`docs/design/auto-attack.md`, decisions of 2026-10-01):
 * Map Room 2 wild camps only; one attack per press; no partial attacks, so a
 * single missing monster, the champion or a bomb refuses it; free beyond the
 * monsters spent; one in progress per player and ten a minute.
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
/** Longer than an auto-attack can take: the slot wait plus the finaliser's deadline. */
export const AUTO_ATTACK_LOCK_SECONDS = 60;

/** Where the last auto-attack's battle is kept for Watch. */
export const autoAttackReplayKey = (userid: number) => `auto-attack-replay:${userid}`;
export const AUTO_ATTACK_REPLAY_TTL = 60 * 60;

/** A camp to repeat a plan on. */
interface Camp {
  readonly baseid: string;
  readonly cell: CellCoords;
  readonly key: CampKey;
  /** Its row, or null for a camp nobody has attacked yet. */
  readonly row: Save | null;
  /** Its row is past its 12 hours: the camp has regenerated. */
  readonly expired: boolean;
}

/**
 * The Map Room 2 camp a base id names on the player's own world, or a
 * `notACamp` refusal: a Map Room 1 tribe, a player's yard or outpost, a Map
 * Room 3 structure, the Inferno, another world.
 */
const campOf = async (userSave: Save, baseid: string, now: number): Promise<Camp> => {
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

/**
 * What each of the player's yards that can fling at the cell houses now: the
 * main yard and the outposts near it, each caught up to now without writing,
 * as the attack load's `catchUpArmiesForAttack` will then write it.
 */
const housedFor = async (user: User, cell: CellCoords, now: number): Promise<EntryHoused> => {
  const userSave = user.save!;
  const housed: EntryHoused = {
    [userSave.baseid]: countsOf(catchUpArmyRow(userSave, userSave, now).monsters?.housed),
  };
  const near = outpostsNearCell(cell, userSave.outposts ?? []);
  if (near.length === 0) return housed;
  const outposts = await postgres.em.find(Save, {
    baseid: { $in: near.map((outpost) => outpost.baseid) },
    saveuserid: user.userid,
  });
  for (const outpost of outposts) {
    housed[outpost.baseid] = countsOf(catchUpArmyRow(outpost, userSave, now).monsters?.housed);
  }
  return housed;
};

/** What the attacker lacks for a plan right now. */
const shortfallOf = async (user: User, camp: Camp, stored: StoredPlan, now: number): Promise<PlanShortfall[]> => {
  const userSave = user.save!;
  return planShortfall(planNeeds(stored.plan), {
    housed: await housedFor(user, camp.cell, now),
    champions: userSave.champion as OwnedChampion[] | null,
    catapultLevel: catapultLevelOf(userSave),
    resources: userSave.resources as Record<string, number> | null,
  });
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
  /** The camp is out of the reach of every Flinger the player has. */
  readonly outOfRange: boolean;
  /** Someone is attacking the camp right now. */
  readonly underAttack: boolean;
  /** The camp's damage now; 0 once it has regenerated. */
  readonly damage: number;
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
  if (!stored) return { baseid, plan: null, missing: [], outOfRange: false, underAttack, damage };

  const { verdict } = await rangeCheckV2(user, { baseid, cell: camp.cell });
  return {
    baseid,
    plan: summaryOf(camp.key, stored, userSave.champion as OwnedChampion[] | null),
    missing: await shortfallOf(user, camp, stored, now),
    outOfRange: !verdict.ok,
    underAttack,
    damage,
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
}

/** A 32-bit seed for the new battle; a plan's is never reused. */
const mintSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

/**
 * Runs one auto-attack (see the file comment). The caller has rate-limited
 * the request and checked the Discord age rule.
 *
 * @param user - The player, as the request authenticated them.
 * @param baseid - The camp.
 * @throws {ClientSafeError} `autoAttackRefusedErr` for every refusal, before
 *   anything is written; `baseUnderAttackErr` when someone else is attacking
 *   the camp; `attackResultPendingErr` when the replay ran past its deadline
 *   (the attack then lands from its checkpoint).
 */
export const runAutoAttack = async (user: User, baseid: string): Promise<AutoAttackResult> => {
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

    const stored = await findAttackPlan(userid, camp.key);
    if (!stored) throw autoAttackRefusedErr("noPlan");

    await validateRange(user, MapRoomVersion.V2, { baseid, cell: camp.cell });

    const missing = await shortfallOf(user, camp, stored, now);
    if (missing.length > 0) throw autoAttackRefusedErr("missing", { missing });

    release = await reserveReplaySlot();
    if (!release) throw autoAttackRefusedErr("busy");

    // A regenerated camp is a fresh one, as opening it renews it
    // (`baseModeView.ts`): the old row goes, and the attack load below gives
    // the camp a new one, as it does a camp attacked for the first time.
    if (camp.row && camp.expired) {
      postgres.em.remove(camp.row);
      await postgres.em.flush();
    }

    // Past this point the attack is committed, as a hand-played one is once
    // its load returns: the camp is under attack and the session is minted.
    const { save, defenderForces } = await baseModeAttack({
      user,
      baseid,
      mapversion: MapRoomVersion.V2,
      attackerLevel: playerLevelOf(userSave),
    });
    const session = await readAttackSession(save.basesaveid);
    if (!session?.entryHoused) throw autoAttackRefusedErr("failed");

    const log = planLog(stored.plan, mintSeed(), userSave.champion as OwnedChampion[] | null);
    await storeCheckpoint(
      save.basesaveid,
      newCheckpoint(
        session,
        save.saveuserid,
        { tick: stored.plan.tick, flinglog: log, sources: Object.keys(session.entryHoused) },
        now
      )
    );

    // What Watch replays: the camp as this battle found it (`mapSaveData`, as
    // the attack load serves it, over the pool the session recorded).
    const before = {
      ...(await mapSaveData(save, user)),
      resources: session.defenderResources ?? save.resources,
      attackerlevel: session.attackerlevel,
      defenderforces: defenderForces,
      attpowerups: await runningPowerups(user.alliance_id),
    };
    const declareWar = await isDeclareWarRunning(user.alliance_id);

    let landed;
    try {
      landed = await landCheckpointedAttack(save.basesaveid, "auto-attack", { left: false, recordPlan: false });
    } catch (err) {
      // Past its deadline the replay wrote nothing; the checkpoint stays and
      // the attack lands on the player's next load or the sweep (issue #138).
      if (err instanceof ReplayTimeoutError) throw attackResultPendingErr();
      throw err;
    }
    if (landed.status !== "finalised" || !landed.landed) throw autoAttackRefusedErr("failed");
    const { outcome, damageBefore, damageAfter, credited, overflow, bombs, fought } = landed.landed;

    await keepReplay(userid, {
      baseid,
      name: TRIBE_NAMES[camp.key.wmid] ?? "Wild monsters",
      load: before,
      seed: fought.seed,
      events: fought.events,
      tick: landed.landed.tick,
      levels: academyLevels(userSave.academy),
      declareWar,
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
      flung: outcome.flung,
      bombs,
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
  readonly declareWar: boolean;
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
