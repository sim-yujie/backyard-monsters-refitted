import { isBunker } from "../../../game-rules/combat/index.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";

/**
 * A Monster Bunker's garrison is lost with it (issue #130).
 *
 * A bunker keeps what it holds on its own `buildingdata` entry, `m`
 * (`client/scripts/BUILDING22.as:674-679`), and Flash writes that back only
 * for a bunker still standing: `Export` skips `m` at zero health
 * (`BUILDING22.as:683-700`), so the attack's save leaves a fallen bunker
 * empty. Here the server decides which bunkers fell from its own replay of
 * the battle, never from the client's word, and empties them when the attack
 * lands: on the final save (`baseSave.ts`) and when the server finishes an
 * abandoned attack (`finaliseAttack.ts`).
 *
 * The defenders a bunker sends out, and which of them die, are the other half
 * of a garrison's losses; they wait on the engine's fight-back (issue #195),
 * without which no defender ever falls.
 *
 * Pure: the caller reads the rows and writes the result.
 */

/** The id the engine knows an entry by: its `id`, else its key (`buildEngineYard`). */
const engineIdOf = (key: string, entry: BuildingData): number => {
  const id = Number(entry.id ?? key);
  return Number.isFinite(id) ? Math.floor(id) : Number.NaN;
};

const holdsAGarrison = (entry: BuildingData): boolean => {
  const held = entry.m;
  return held !== null && typeof held === "object" && !Array.isArray(held) && Object.keys(held).length > 0;
};

/**
 * The ids a health map has at zero: the buildings a battle brought down.
 *
 * @param health - `buildinghealthdata`, id to health.
 */
export const fallenIn = (health: Readonly<Record<string, unknown>> | null | undefined): Set<number> => {
  const fallen = new Set<number>();
  for (const [id, value] of Object.entries(health ?? {})) {
    if (Number(value) <= 0) fallen.add(Number(id));
  }
  return fallen;
};

/**
 * The buildingdata with every fallen bunker's garrison gone, and which went.
 * An entry is copied only when it changes; everything else is left as it is.
 *
 * @param buildingdata - The defender's `buildingdata`.
 * @param fallen - Engine ids of the buildings the server's replay brought down.
 */
export const withoutFallenGarrisons = (
  buildingdata: BuildingDataMap | null | undefined,
  fallen: ReadonlySet<number>
): { buildingdata: BuildingDataMap; emptied: number[] } => {
  const result: BuildingDataMap = { ...(buildingdata ?? {}) };
  const emptied: number[] = [];
  for (const [key, entry] of Object.entries(result)) {
    if (!entry || typeof entry !== "object" || !isBunker(Number(entry.t)) || !holdsAGarrison(entry)) continue;
    const id = engineIdOf(key, entry);
    if (!fallen.has(id)) continue;
    const { m: _lost, ...rest } = entry;
    result[key] = rest;
    emptied.push(id);
  }
  return { buildingdata: result, emptied: emptied.sort((one, other) => one - other) };
};
