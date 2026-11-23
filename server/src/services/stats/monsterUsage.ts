import { championByType, type AttackerReport, type FlingEvent } from "../../game-rules/combat/index.js";
import { logger } from "../../utils/logger.js";
import { insertUsageRow } from "./monsterUsageStore.js";
import { parseFlingLog } from "../base/attackCheckpoint.js";
import type { AbandonedOutcome } from "../base/combat/abandonedAttack.js";
import type { AttackSession } from "../base/attackSession.js";
import { campKeyOf, TRIBE_NAMES } from "../base/autoAttack/attackPlan.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";

/**
 * Which monsters players fling (owner, 23 Nov 2026: the dashboard's Monsters
 * tab, for rebalancing). One compact row per landed attack in
 * `bym.monster_usage`, written by every landing once its own transaction has
 * committed, outside it:
 *
 * - Map Room 1 and 2 player yards and Map Room 2 camps: the save that ends the
 *   attack (`controllers/base/save/baseSave.ts`) and the finaliser
 *   (`services/base/finaliseAttack.ts`), Repeat attacks included;
 * - Map Room 1 tribes (`scaledMR1Tribes.ts`), Moloch tribes
 *   (`infernoTribeLanding.ts`), the Descent (`descentLanding.ts`) and other
 *   players' Inferno yards (`infernoPlayerLanding.ts`), each from the save or
 *   from the checkpoint.
 *
 * Everything in a row is the server's own: the replay the landing already ran
 * (its `attackers`: each type's level, flung and lost), or, where a landing
 * had no battle, what it spent from the log at the levels the attack froze at
 * its start (`session.attackerAcademy`). Never the client's figures.
 *
 * A stats write must never fail, slow or undo a landing: it runs after the
 * commit, on a connection of its own, and any error is logged and dropped.
 * The unique key (attacker, start, attack id) makes a second write of the
 * same attack a no-op.
 */

/** Where the attack was fought. */
export type UsageArena = "mr1" | "mr2" | "inferno" | "descent";

/** Whose yard: another player's (main or outpost) or a wild monster camp (tribes, the Descent). */
export type UsageMode = "player" | "camp";

/** One monster type in a row: its level, how many were flung and, from a battle, lost. */
export interface UsageMonster {
  readonly l: number;
  readonly f: number;
  /** Died in the battle; absent when there was no battle to say. */
  readonly x?: number;
}

/** One champion flung: its id (`G1`..`G5`) and level. */
export interface UsageChampion {
  readonly c: string;
  readonly l: number;
}

/** What a landing knows about the attack it landed. */
export interface UsageAttack {
  /** The attack as its start froze it: who, which attack, and the academy levels. */
  readonly session: Pick<AttackSession, "attackerid" | "attackid" | "startedat" | "attackerAcademy">;
  readonly arena: UsageArena;
  readonly mode: UsageMode;
  /** The defender's base type as stored (`main`, `outpost`, `tribe`, `inferno`, `iwm`...). */
  readonly baseType?: string | null;
  /** A Repeat attack (`autoAttack.ts`), which nobody played by hand. */
  readonly repeat?: boolean;
  /** The yard's owner, for an attack on a player. */
  readonly defenderUserid?: number | null;
  /** The camp's tribe (`legionnaire`, `kozu`, `abunakki`, `dreadnaut`, `moloch`, `descent`). */
  readonly tribe?: string | null;
  /** The camp's level as the map showed it; the Descent's yard 1 to 13. */
  readonly campLevel?: number | null;
  /** The server's battle, when the landing ran one. */
  readonly battle: Pick<AbandonedOutcome, "flung" | "attackers" | "destroyed"> | null;
  /**
   * With no battle: what the landing spent, by monster id (the fightable
   * log's flings, or the whole army for an assumed Inferno attack).
   */
  readonly flung?: Readonly<Record<string, number>> | null;
  /** With no battle: the log it spent from, for the champions flung. */
  readonly log?: unknown;
  /** The defender's stored damage before and after, 0 to 100. */
  readonly damageBefore?: number | null;
  readonly damageAfter?: number | null;
  /**
   * An Inferno player attack landed with no battle record, as having used its
   * whole army (`spendsWholeArmy`): its monsters are a worst case, not a count.
   */
  readonly assumed?: boolean;
  /** When it landed, unix seconds. */
  readonly now: number;
}

/** The row as written. */
export interface UsageRow {
  readonly landedAt: Date;
  readonly day: string;
  readonly attackerUserid: number;
  readonly attackStarted: number;
  readonly attackId: number;
  readonly mode: UsageMode;
  readonly arena: UsageArena;
  readonly baseType: string | null;
  readonly repeat: boolean;
  readonly defenderUserid: number | null;
  readonly tribe: string | null;
  readonly campLevel: number | null;
  readonly monsters: Record<string, UsageMonster>;
  readonly champions: UsageChampion[];
  readonly damageBefore: number | null;
  readonly damageAfter: number | null;
  readonly flattened: boolean;
  readonly replayed: boolean;
  readonly assumed: boolean;
}

const wholeOrNull = (value: unknown): number | null => {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) ? n : null;
};

const levelOf = (academy: Readonly<Record<string, number>> | undefined, id: string): number => {
  const level = Number(academy?.[id]);
  return Number.isSafeInteger(level) && level > 0 ? level : 1;
};

/** The champions a log flung, each once, at the level its fling carried. */
const championsInLog = (log: unknown): UsageChampion[] => {
  const parsed = parseFlingLog(log);
  if (!parsed) return [];
  const seen = new Map<string, number>();
  for (const event of parsed.events as readonly FlingEvent[]) {
    if (event.kind !== "fling" || !event.champion) continue;
    const id = championByType(event.champion.t);
    if (id && !seen.has(id)) seen.set(id, Math.max(1, Math.floor(event.champion.l || 1)));
  }
  return [...seen].map(([c, l]) => ({ c, l }));
};

/**
 * The row for one landed attack (pure). Monsters are every id the server
 * spent, at its level; the dashboard picks the ones it shows.
 */
export const usageRow = (attack: UsageAttack): UsageRow => {
  const { session, battle } = attack;
  const monsters: Record<string, UsageMonster> = {};
  const champions: UsageChampion[] = [];
  if (battle) {
    const rows = new Map<string, AttackerReport>();
    for (const row of battle.attackers ?? []) {
      if (row.champion) {
        if (row.sent > 0) champions.push({ c: row.monsterId, l: row.level });
      } else rows.set(row.monsterId, row);
    }
    for (const [id, count] of Object.entries(battle.flung)) {
      if (!(count > 0)) continue;
      const row = rows.get(id);
      monsters[id] = row
        ? { l: row.level, f: count, x: row.lost }
        : { l: levelOf(session.attackerAcademy, id), f: count };
    }
  } else {
    for (const [id, count] of Object.entries(attack.flung ?? {})) {
      if (count > 0) monsters[id] = { l: levelOf(session.attackerAcademy, id), f: count };
    }
    champions.push(...championsInLog(attack.log));
  }
  const damageAfter = wholeOrNull(attack.damageAfter);
  const landedAt = new Date(attack.now * 1000);
  return {
    landedAt,
    day: landedAt.toISOString().slice(0, 10),
    attackerUserid: session.attackerid,
    attackStarted: Math.floor(session.startedat),
    attackId: session.attackid,
    mode: attack.mode,
    arena: attack.arena,
    baseType: attack.baseType ?? null,
    repeat: attack.repeat ?? false,
    defenderUserid: attack.mode === "player" ? (attack.defenderUserid ?? null) : null,
    tribe: attack.tribe ?? null,
    campLevel: wholeOrNull(attack.campLevel),
    monsters,
    champions,
    damageBefore: wholeOrNull(attack.damageBefore),
    damageAfter,
    flattened: battle?.destroyed === 1 || (damageAfter !== null && damageAfter >= 100),
    replayed: battle !== null,
    assumed: attack.assumed ?? false,
  };
};

/** The part of a row a defender's own `bym.save` row decides. */
export type RowFacts = Pick<UsageAttack, "arena" | "mode" | "baseType" | "defenderUserid" | "tribe" | "campLevel">;

/**
 * What an attack on a yard with a row of its own (a player's main yard or
 * outpost, a Map Room 2 camp) records about where it was: the Map Room from
 * the attacker's map, a camp's tribe and level from the row. Null for a Map
 * Room 3 attack (switched off; no replay) or a player with no Map Room.
 */
export const rowFacts = (
  defender: { type?: string | null; wmid?: number | null; level?: number | null; saveuserid?: number | null },
  mapversion: number | null | undefined
): RowFacts | null => {
  // A row with no version is on the model's default, Map Room 1.
  const version = mapversion ?? MapRoomVersion.V1;
  const arena = version === MapRoomVersion.V1 ? "mr1" : version === MapRoomVersion.V2 ? "mr2" : null;
  if (!arena) return null;
  const camp = defender.type === BaseType.TRIBE;
  const key = camp ? campKeyOf(defender) : null;
  return {
    arena,
    mode: camp ? "camp" : "player",
    baseType: defender.type ?? null,
    defenderUserid: camp ? null : (defender.saveuserid ?? null),
    tribe: key ? (TRIBE_NAMES[key.wmid]?.toLowerCase() ?? null) : null,
    campLevel: camp ? (defender.level ?? null) : null,
  };
};

/**
 * Records one landed attack for the dashboard. Call it after the landing has
 * committed. It never throws: a failure is logged and the attack stays landed.
 */
export const recordMonsterUsage = async (attack: UsageAttack): Promise<void> => {
  try {
    await insertUsageRow(usageRow(attack));
  } catch (err) {
    logger.warn(`Monster usage not recorded for attack ${attack?.session?.attackid} by ${attack?.session?.attackerid}: ${err}`, {
      event: "monster-usage-failed",
    });
  }
};
