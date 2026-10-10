import { KRALLEN_ID } from "./champions.js";
import { bunkerGarrisons, type BattleOptions, type DefenderChampion } from "./engine.js";
import { championByType, CHAMPION_MAX_POWER_LEVEL } from "./stats.js";
import { MAX_RANK } from "./specialMoves.js";
import type { CombatBuildingDataMap, MonsterLevels, MonsterRanks, Roster } from "./types.js";

/**
 * What a yard defends itself with (issue #195): each Monster Bunker's
 * garrison, the levels its monsters fight at, and the champions in its
 * Champion Cage.
 *
 * One picker for every caller, so the server's replay, the web client's battle
 * and the Wild Monster Baiter fight the same defence off the same save. The
 * attack load works it out once, serves it to the client and keeps it in the
 * attack session, so the save's replay fights exactly what the client did.
 */
export interface DefenderForces {
  /** Each bunker's garrison, by building id ({@link bunkerGarrisons}). */
  readonly bunkers: Readonly<Record<number, Roster>>;
  /** The defender's academy levels, by monster id; an absent one fights at level 1. */
  readonly defenderLevels: MonsterLevels;
  /**
   * The defender's Monster Lab ranks, by monster id: what its bunkers'
   * monsters fight with (issue #352). Absent, or an absent id, is rank 0.
   */
  readonly defenderRanks?: MonsterRanks;
  /** The champions at home in the cage, none to two ({@link cagedChampions}). */
  readonly defenderChampions: readonly DefenderChampion[];
}

/** No defence at all: what a Map Room 1 tribe or a Map Room 2 camp has. */
export const NO_DEFENCE: DefenderForces = {
  bunkers: {},
  defenderLevels: {},
  defenderChampions: [],
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A save's `academy`, `{ monsterId: { level } }`, as levels: whole, at least 1. */
export const academyLevels = (academy: unknown): MonsterLevels => {
  const levels: Record<string, number> = {};
  for (const [id, entry] of Object.entries(record(academy) ?? {})) {
    const level = Number(record(entry)?.level);
    if (Number.isFinite(level) && level >= 1) levels[id] = Math.floor(level);
  }
  return levels;
};

/**
 * A save's `academy`, `{ monsterId: { powerup } }`, as Monster Lab ranks: whole,
 * 1 to 3. A monster with no rank is left out (issue #352).
 */
export const academyRanks = (academy: unknown): MonsterRanks => {
  const ranks: Record<string, number> = {};
  for (const [id, entry] of Object.entries(record(academy) ?? {})) {
    const rank = Number(record(entry)?.powerup);
    if (Number.isFinite(rank) && rank >= 1) ranks[id] = Math.min(Math.floor(rank), MAX_RANK);
  }
  return ranks;
};

/** One save entry as a caged champion, or null when it is not at home with health left. */
const atHome = (entry: unknown): DefenderChampion | null => {
  const champion = record(entry);
  if (!champion) return null;
  const t = Number(champion.t);
  const l = Number(champion.l);
  const hp = Number(champion.hp);
  if (!championByType(t) || !(Number(champion.status ?? 0) === 0)) return null;
  if (!Number.isFinite(l) || l < 1 || !Number.isFinite(hp) || hp <= 0) return null;
  const pl = Number(champion.pl);
  return {
    t,
    l: Math.floor(l),
    hp: Math.floor(hp),
    pl: Number.isFinite(pl) ? Math.min(Math.max(Math.floor(pl), 0), CHAMPION_MAX_POWER_LEVEL) : 0,
  };
};

/**
 * The champions that defend (issues #195, #310): those at home (`status` 0)
 * with health left, at most one basic champion and one Krallen, in the save's
 * order. Flash's cage pens both: the basic one in `CREATURES._guardian`, its
 * single slot, and Krallen, a special champion, beside it through
 * `addGuardian` (`CHAMPIONCAGE.as:628-655`, `CREATURES.as:219-257`).
 *
 * @param champions - The defender's save's `champion` list.
 */
export const cagedChampions = (champions: unknown): DefenderChampion[] => {
  if (!Array.isArray(champions)) return [];
  const picked: DefenderChampion[] = [];
  let basic = false;
  let krallen = false;
  for (const entry of champions) {
    const champion = atHome(entry);
    if (!champion) continue;
    const isKrallen = championByType(champion.t) === KRALLEN_ID;
    if (isKrallen ? krallen : basic) continue;
    if (isKrallen) krallen = true;
    else basic = true;
    picked.push(champion);
  }
  return picked;
};

/**
 * A yard's defence, read off the save that defends it.
 *
 * @param save - The defending row's `buildingdata` and `champion`, and the
 *   academy its monsters fight at: its own, or its owner's main yard's for an
 *   outpost.
 */
export const defenderForcesOf = (save: {
  readonly buildingdata: unknown;
  readonly academy: unknown;
  readonly champion: unknown;
}): DefenderForces => {
  const defenderRanks = academyRanks(save.academy);
  return {
    bunkers: bunkerGarrisons(record(save.buildingdata) as CombatBuildingDataMap | null),
    defenderLevels: academyLevels(save.academy),
    // Kept only when the Lab has researched something, so a yard without ranks serves what it did.
    ...(Object.keys(defenderRanks).length > 0 ? { defenderRanks } : {}),
    defenderChampions: cagedChampions(save.champion),
  };
};

/**
 * A defence as stored or served (the attack session, the attack load's
 * `defenderforces`), each part kept only as far as it reads cleanly.
 */
export const parseDefenderForces = (raw: unknown): DefenderForces | undefined => {
  const value = record(raw);
  if (!value) return undefined;
  const bunkers: Record<number, Roster> = {};
  for (const [key, garrison] of Object.entries(record(value.bunkers) ?? {})) {
    const id = Number(key);
    if (!Number.isSafeInteger(id)) continue;
    const counts: Record<string, number> = {};
    for (const [monsterId, count] of Object.entries(record(garrison) ?? {})) {
      if (Number.isSafeInteger(count) && (count as number) > 0) counts[monsterId] = count as number;
    }
    bunkers[id] = counts;
  }
  const levels: Record<string, number> = {};
  for (const [id, level] of Object.entries(record(value.defenderLevels) ?? {})) {
    if (Number.isSafeInteger(level) && (level as number) >= 1) levels[id] = level as number;
  }
  const ranks: Record<string, number> = {};
  for (const [id, rank] of Object.entries(record(value.defenderRanks) ?? {})) {
    if (Number.isSafeInteger(rank) && (rank as number) >= 1 && (rank as number) <= MAX_RANK) {
      ranks[id] = rank as number;
    }
  }
  // A session stored before issue #310 holds one `defenderChampion`.
  const champions = Array.isArray(value.defenderChampions)
    ? value.defenderChampions
    : value.defenderChampion === undefined
      ? []
      : [value.defenderChampion];
  return {
    bunkers,
    defenderLevels: levels,
    ...(Object.keys(ranks).length > 0 ? { defenderRanks: ranks } : {}),
    defenderChampions: cagedChampions(
      champions.map((entry) => {
        const champion = record(entry);
        return champion ? { ...champion, status: 0 } : null;
      }),
    ),
  };
};

/**
 * The battle options a defence gives, and none for no defence at all, so a
 * battle without one runs as it always did. The levels go in whenever there
 * are any: a Spurtz Cannon's Spurtz fight at the defender's level with no
 * bunker or caged champion on the yard too (issue #313).
 */
export const battleDefence = (
  forces: DefenderForces | null | undefined,
): Pick<BattleOptions, "bunkers" | "defenderLevels" | "defenderRanks" | "defenderChampions"> => {
  if (!forces) return {};
  const hasBunkers = Object.keys(forces.bunkers).length > 0;
  const hasChampions = forces.defenderChampions.length > 0;
  const hasLevels = Object.keys(forces.defenderLevels).length > 0;
  const hasRanks = Object.keys(forces.defenderRanks ?? {}).length > 0;
  return {
    ...(hasBunkers ? { bunkers: forces.bunkers } : {}),
    ...(hasBunkers || hasChampions || hasLevels ? { defenderLevels: forces.defenderLevels } : {}),
    // Only a bunker's monsters fight at the defender's rank (issue #352).
    ...(hasBunkers && hasRanks ? { defenderRanks: forces.defenderRanks as MonsterRanks } : {}),
    ...(hasChampions ? { defenderChampions: forces.defenderChampions } : {}),
  };
};
