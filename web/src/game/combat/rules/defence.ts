import { bunkerGarrisons, type BattleOptions, type DefenderChampion } from "./engine.js";
import { championByType, CHAMPION_MAX_POWER_LEVEL } from "./stats.js";
import type { CombatBuildingDataMap, MonsterLevels, Roster } from "./types.js";

/**
 * What a yard defends itself with (issue #195): each Monster Bunker's
 * garrison, the levels its monsters fight at, and the champion in its
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
  /** The champion at home in its cage, or null ({@link cagedChampion}). */
  readonly defenderChampion: DefenderChampion | null;
}

/** No defence at all: what a Map Room 1 tribe or a Map Room 2 camp has. */
export const NO_DEFENCE: DefenderForces = {
  bunkers: {},
  defenderLevels: {},
  defenderChampion: null,
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
 * The champion that defends (issue #195): the first in the save's order that
 * is at home (`status` 0) with health left, Krallen as much as any other.
 *
 * @param champions - The defender's save's `champion` list.
 */
export const cagedChampion = (champions: unknown): DefenderChampion | null => {
  if (!Array.isArray(champions)) return null;
  for (const entry of champions) {
    const champion = record(entry);
    if (!champion) continue;
    const t = Number(champion.t);
    const l = Number(champion.l);
    const hp = Number(champion.hp);
    if (!championByType(t) || !(Number(champion.status ?? 0) === 0)) continue;
    if (!Number.isFinite(l) || l < 1 || !Number.isFinite(hp) || hp <= 0) continue;
    const pl = Number(champion.pl);
    return {
      t,
      l: Math.floor(l),
      hp: Math.floor(hp),
      pl: Number.isFinite(pl) ? Math.min(Math.max(Math.floor(pl), 0), CHAMPION_MAX_POWER_LEVEL) : 0,
    };
  }
  return null;
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
}): DefenderForces => ({
  bunkers: bunkerGarrisons(record(save.buildingdata) as CombatBuildingDataMap | null),
  defenderLevels: academyLevels(save.academy),
  defenderChampion: cagedChampion(save.champion),
});

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
  const champion = record(value.defenderChampion);
  return {
    bunkers,
    defenderLevels: levels,
    defenderChampion: champion ? cagedChampion([{ ...champion, status: 0 }]) : null,
  };
};

/**
 * The battle options a defence gives, and none for no defence at all, so a
 * battle without one runs as it always did.
 */
export const battleDefence = (
  forces: DefenderForces | null | undefined,
): Pick<BattleOptions, "bunkers" | "defenderLevels" | "defenderChampion"> => {
  if (!forces) return {};
  const hasBunkers = Object.keys(forces.bunkers).length > 0;
  return {
    ...(hasBunkers ? { bunkers: forces.bunkers } : {}),
    ...(hasBunkers || forces.defenderChampion ? { defenderLevels: forces.defenderLevels } : {}),
    ...(forces.defenderChampion ? { defenderChampion: forces.defenderChampion } : {}),
  };
};
