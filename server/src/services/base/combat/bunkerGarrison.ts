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
 * of a garrison's losses (issue #195): with the defence in the battle, each
 * bunker's garrison afterwards is the replay's (`withGarrisons`), survivors
 * back in, the dead gone, and a fallen bunker keeping only who was out.
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

/**
 * The buildingdata with each bunker the battle had a garrison for holding what
 * the battle left it (`BattleState.bunkerGarrisons`, issue #195): an empty
 * garrison drops `m`, as a fallen bunker's does. Every other entry is left as
 * it is.
 *
 * @param buildingdata - The defender's `buildingdata`.
 * @param garrisons - Engine id to monster id to count, from the replay.
 */
export const withGarrisons = (
  buildingdata: BuildingDataMap | null | undefined,
  garrisons: Readonly<Record<number, Readonly<Record<string, number>>>>
): BuildingDataMap => {
  const result: BuildingDataMap = { ...(buildingdata ?? {}) };
  for (const [key, entry] of Object.entries(result)) {
    if (!entry || typeof entry !== "object" || !isBunker(Number(entry.t))) continue;
    const garrison = garrisons[engineIdOf(key, entry)];
    if (!garrison) continue;
    const { m: _before, ...rest } = entry;
    result[key] = Object.keys(garrison).length > 0 ? { ...rest, m: { ...garrison } } : rest;
  }
  return result;
};

/**
 * What the bunkers hold once an attack lands: a fallen one loses its garrison
 * (#130), then each the battle fought with holds what the battle left it (#195).
 *
 * @param buildingdata - The defender's `buildingdata`.
 * @param outcome - The replay's health map and garrisons.
 */
export const garrisonsAfterBattle = (
  buildingdata: BuildingDataMap | null | undefined,
  outcome: {
    readonly buildinghealthdata: Readonly<Record<string, unknown>>;
    readonly bunkerGarrisons: Readonly<Record<number, Readonly<Record<string, number>>>>;
  }
): BuildingDataMap =>
  withGarrisons(
    withoutFallenGarrisons(buildingdata, fallenIn(outcome.buildinghealthdata)).buildingdata,
    outcome.bunkerGarrisons
  );
