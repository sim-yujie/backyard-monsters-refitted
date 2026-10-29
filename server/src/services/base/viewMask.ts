import { BaseType } from "../../enums/Base.js";
import type { Save } from "../../database/models/save.model.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { artLevelOf } from "../../game-data/buildingArtLevels.js";
import { isTrap, maxHp, type CombatTargetKind } from "../../game-rules/combat/index.js";

/**
 * What a player who only looks at someone else's yard is sent (owner report
 * 2026-10-22): the yard as it can be drawn, and nothing the screen keeps
 * hidden. Anyone with the network tab open reads the whole answer, so hiding
 * it on screen is not enough.
 *
 * - **Traps** are left out altogether: no position, kind or count. The
 *   health entries of traps, and of traps that already fired (a zero under an
 *   id no longer in the yard), go too.
 * - **Levels** are replaced by the level the building's art needs
 *   (`artLevelOf`). Most buildings have one picture for all levels and so
 *   read 1; the few whose art changes (Town Hall, harvesters, walls, Flinger,
 *   and the 3D defensive towers' three tiers...) give
 *   away only what their picture already shows.
 * - **Health** keeps its share of the building's full health, re-measured
 *   against the art level's, so a damaged building still looks damaged and a
 *   wrecked one wrecked, but the number no longer tells the level.
 * - **Job length** (`cL`, which names the level being built) is dropped; the
 *   countdowns stay, because they set the workers going.
 *
 * Only a player's yard (main yard, outpost, Inferno yard) is masked: a wild
 * monster camp hides nothing. The owner, and an attacker once the attack is
 * committed (`baseModeAttack`), get the yard as it is: the battle needs it.
 */

/** The yards masked for anyone but their owner. */
const PLAYER_YARDS: ReadonlySet<string> = new Set([BaseType.MAIN, BaseType.OUTPOST, BaseType.INFERNO]);

/** Whether `save` is a player's yard looked at by someone else. */
export const masksFor = (save: Pick<Save, "type" | "userid">, viewer: number): boolean =>
  PLAYER_YARDS.has(save.type) && save.userid !== viewer;

/** The share of full health below which the client draws a building damaged (`yardModel.ts`). */
const DAMAGED_AT = 0.5;

/** The health table a yard of this type reads (`stats.ts` `hpLadder`): an Inferno yard its own. */
const kindOf = (type: string): CombatTargetKind =>
  type === BaseType.OUTPOST ? "outpost" : type === BaseType.INFERNO ? "inferno" : "main";

/** A building's stored level: absent means 1, as the client reads it. */
const levelOf = (building: BuildingData): number => (typeof building.l === "number" ? building.l : 1);

/**
 * `hp` re-measured from the building's real level to its art level, keeping
 * its share and its side of the client's "damaged" line (half health,
 * `yardModel.ts` `DAMAGED_AT`). Zero stays zero; a type with no health ladder
 * keeps its reading, which says nothing about a level.
 */
export const maskedHp = (hp: number, type: number, level: number, art: number, kind: CombatTargetKind): number => {
  if (!(hp > 0)) return hp;
  const real = maxHp(type, level, kind);
  const shown = maxHp(type, art, kind);
  if (!(real > 0) || !(shown > 0)) return hp;
  if (hp >= real) return shown;
  let scaled = Math.floor((hp / real) * shown);
  if (hp < real * DAMAGED_AT) scaled = Math.min(scaled, Math.ceil(shown * DAMAGED_AT) - 1);
  else scaled = Math.max(scaled, Math.ceil(shown * DAMAGED_AT));
  return Math.max(1, Math.min(scaled, shown - 1));
};

/** One building as a viewer gets it; see the file comment. */
export const maskBuilding = (building: BuildingData, kind: CombatTargetKind): BuildingData => {
  const level = levelOf(building);
  const art = artLevelOf(building.t, level);
  const masked: BuildingData = { ...building };
  delete masked.cL;
  if (typeof building.l === "number") masked.l = art;
  if (typeof building.hp === "number") masked.hp = maskedHp(building.hp, building.t, level, art, kind);
  return masked;
};

/** `buildingdata` without traps, every other building masked. */
export const maskBuildings = (buildings: BuildingDataMap, kind: CombatTargetKind): BuildingDataMap => {
  const out: BuildingDataMap = {};
  for (const [key, building] of Object.entries(buildings)) {
    if (!building || isTrap(Number(building.t))) continue;
    out[key] = maskBuilding(building, kind);
  }
  return out;
};

/**
 * `buildinghealthdata` for the masked yard: only the buildings it still
 * lists (so no trap, fired or not), each re-measured as `maskedHp` does.
 */
export const maskHealth = (
  health: BuildingHealthData,
  original: BuildingDataMap,
  kind: CombatTargetKind
): BuildingHealthData => {
  const byId = new Map<string, BuildingData>();
  for (const [key, building] of Object.entries(original)) {
    if (!building || isTrap(Number(building.t))) continue;
    byId.set(String(building.id ?? key), building);
  }
  const out: BuildingHealthData = {};
  for (const [id, hp] of Object.entries(health)) {
    const building = byId.get(id);
    if (!building) continue;
    const level = levelOf(building);
    out[id] = maskedHp(Number(hp), building.t, level, artLevelOf(building.t, level), kind);
  }
  return out;
};

/**
 * Masks the yard fields of a save already shaped for the wire (`buildSaveData`),
 * in place. `save` is the row it was shaped from, for its type.
 */
export const maskYardForViewer = (filtered: Partial<Save>, save: Pick<Save, "type">): void => {
  const kind = kindOf(save.type);
  const buildings = (filtered.buildingdata ?? {}) as BuildingDataMap;
  if (filtered.buildinghealthdata) {
    filtered.buildinghealthdata = maskHealth(
      filtered.buildinghealthdata as BuildingHealthData,
      buildings,
      kind
    ) as Save["buildinghealthdata"];
  }
  if (filtered.buildingdata) filtered.buildingdata = maskBuildings(buildings, kind) as Save["buildingdata"];
  if (filtered.buildingkeydata) filtered.buildingkeydata = {};
};
