import {
  CellType,
  isPlayerCell,
  isWaterCell,
  type AreaCellGrid,
  type BaseLoadResponse,
  type ChampionSaveEntry,
  type MapCell,
  type PlayerCell,
} from "@/api/types";
import type { OffsetCell } from "@/game/HexGrid";
import {
  hexDistance,
  mainYardRange,
  outpostRange,
  withDeclareWar,
} from "@/game/maproom/rules/range";
import { storageCapOf } from "./attackerStorage";
import type {
  AttackRoster,
  AttackTargetKind,
  RosterSource,
  SiegeInventory,
} from "./attackTarget";

/**
 * Whether a map cell can be attacked, and with what.
 *
 * The client-side half of the attack gate (`docs/design/attack-flow.md` §F1;
 * `docs/specs/maproom2.md:365-379` for the Flash client's own checks). Every
 * rule here is also enforced by the server (`baseModeAttack.ts:71-104`,
 * `docs/server-api.md:388-394`), so this is UX — a button that says why it is
 * off — and never the authority. A refusal the client misses still comes back
 * from the server and is shown the same way.
 *
 * Pure, and read only from what the map already holds: the cell payloads in
 * the loaded zones and the player's own save from the map's opening
 * `loadOwnYard`. Nothing here fetches.
 */

/**
 * How far one of the player's own cells can fling: its flinger's reach, plus
 * Declare War's two cells only while that powerup is running (issue #190;
 * `game/maproom/rules/range.ts`, the rule the server measures with too).
 */
export const cellReach = (cell: PlayerCell, declareWar: boolean): number =>
  withDeclareWar(
    cell.b === CellType.OUTPOST ? outpostRange(cell.f) : mainYardRange(cell.f),
    declareWar,
  );

/**
 * Hex steps between two cells on the wrapping world: the distance the
 * server's range check measures (`rangeCheck.ts`), and the one the map is
 * drawn with.
 */
export const cellDistance = (a: OffsetCell, b: OffsetCell): number =>
  hexDistance({ x: a.col, y: a.row }, { x: b.col, y: b.row });

/**
 * Whether the player's alliance has Declare War running.
 *
 * `powerups` is `runningPowerups()`'s list, `{ id, endtime }` per active
 * powerup (`server/src/services/alliance/powerups.ts:170-179`): the own-yard
 * load's `powerups`, or an attack load's `attpowerups`. Declare War's id is
 * `ap_declarewar` (`server/src/enums/Alliance.ts`).
 */
export const hasDeclareWar = (powerups: readonly unknown[] | undefined): boolean =>
  (powerups ?? []).some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { id?: unknown }).id === "ap_declarewar",
  );

/** One of the player's own cells, with where it is. */
export interface OwnCell {
  readonly col: number;
  readonly row: number;
  readonly cell: PlayerCell;
}

/** Every cell marked `mine` across the loaded zones. */
export const ownCellsIn = (zones: Iterable<{ data: AreaCellGrid }>): OwnCell[] => {
  const own: OwnCell[] = [];
  for (const zone of zones) {
    for (const [x, column] of Object.entries(zone.data)) {
      for (const [y, cell] of Object.entries(column)) {
        if (isPlayerCell(cell) && cell.mine === 1) {
          own.push({ col: Number(x), row: Number(y), cell });
        }
      }
    }
  }
  return own;
};

/** Which load mode family a cell payload takes. */
export const targetKind = (payload: MapCell): AttackTargetKind | null => {
  if (isWaterCell(payload)) return null;
  if (payload.b === CellType.WILD_MONSTER) return "wild";
  return payload.b === CellType.OUTPOST ? "outpost" : "main";
};

/** Owner username, or a wild monster camp's tribe name. */
export const targetName = (payload: MapCell): string =>
  isWaterCell(payload) ? "Water" : payload.n;

/** Building type 51, the Catapult (`YARD_PROPS.as:3849`, `BUILDING51.as`). */
const CATAPULT_TYPE = 51;

/**
 * The attacker's catapult level, which decides which bombs exist: twig at 1,
 * pebble at 2, putty at 3 (`ResourceBombs.as:48-226`).
 *
 * The Flash client read it off the Catapult *building* in the player's yard
 * (`GLOBAL.as:833-835`, `_attackersCatapult = GLOBAL._bCatapult._lvl.Get()`)
 * and wrote the same figure into the save's `catapult` field on every save
 * (`BASE.as:3179`), so in the Flash game the two never disagreed. The web
 * client does not write that field, so on a yard whose Catapult was upgraded
 * since — or on the sandbox fixture, which starts at `catapult: 1` with a
 * level-4 building — the copy goes stale and the pebble and putty tiers
 * vanish (issue #70). The building is the truth; the save field only stands
 * in for a load that carries no `buildingdata`. The higher of the two is
 * taken so a save whose building rows are missing cannot lose a level the
 * field still records.
 *
 * A Catapult still on its initial build (`cB` present) is level 0, as the
 * `BuildingData` type documents; a row without `l` is level 1.
 */
export const ownCatapultLevel = (
  ownSave: Pick<BaseLoadResponse, "catapult" | "buildingdata"> | null,
): number => {
  if (!ownSave) return 0;
  const saved = typeof ownSave.catapult === "number" && ownSave.catapult > 0 ? ownSave.catapult : 0;
  let built = 0;
  for (const row of Object.values(ownSave.buildingdata ?? {})) {
    if (!row || row.t !== CATAPULT_TYPE) continue;
    if (row.cB !== undefined) continue;
    const level = typeof row.l === "number" ? row.l : 1;
    built = Math.max(built, level);
  }
  return Math.max(saved, built);
};

/**
 * What the player can fling at `target`: the housed monsters of every own cell
 * whose flinger reaches it, summed per type
 * (`PopupAttackA.as:214-239`; `docs/specs/combat.md:278-286`).
 *
 * `ownSave` is the map's own-yard load, which carries the champions, the
 * academy levels, the Catapult building (see {@link ownCatapultLevel}), the
 * siege inventory and the running alliance powerups (Declare War's extra
 * reach); all belong to the player, not to any one cell.
 *
 * `sources` keeps each contributing cell's whole `m` blob, keyed by its base
 * id, because the attack save has to write the cell's housing back in full
 * (see `RosterSource`). Ordered by base id so two builds from the same zones
 * agree regardless of which zone arrived first.
 */
export const rosterInRange = (
  target: OffsetCell,
  ownCells: readonly OwnCell[],
  ownSave: RosterSave | null,
): AttackRoster => {
  const sources: RosterSource[] = [];
  let flingerLevel = 0;
  const declareWar = hasDeclareWar(ownSave?.powerups);

  for (const own of ownCells) {
    const reach = cellReach(own.cell, declareWar);
    if (reach === 0 || cellDistance(own, target) > reach) continue;
    flingerLevel = Math.max(flingerLevel, own.cell.f);

    const m = own.cell.m;
    if (typeof m !== "object" || m === null) continue;
    sources.push({ baseid: own.cell.bid, m });
  }
  sources.sort((a, b) => (a.baseid < b.baseid ? -1 : a.baseid > b.baseid ? 1 : 0));

  return rosterOf(sources, flingerLevel, ownSave);
};

/** What of the own-yard load a roster reads. */
export type RosterSave = Pick<
  BaseLoadResponse,
  | "champion"
  | "academy"
  | "catapult"
  | "buildingdata"
  | "storedata"
  | "resources"
  | "credits"
  | "powerups"
> & { siege?: unknown; outposts?: unknown };

/**
 * What a Map Room 1 player can fling (issue #132): the main yard's housing
 * and nothing else, since Map Room 1 has no outposts, and the Flinger's
 * level. The one source is the main yard itself, keyed by its base id, which
 * is the only `monsterupdate` entry the server reads on a Map Room 1 save
 * (`scaledMR1Tribes.ts`; a player target settles the same way,
 * `monsterUpdateHandler.ts`).
 */
export const mainYardRoster = (
  ownSave: RosterSave & Pick<BaseLoadResponse, "baseid" | "monsters">,
  flingerLevel: number,
): AttackRoster => {
  const m = ownSave.monsters;
  const sources: RosterSource[] =
    typeof m === "object" && m !== null
      ? [{ baseid: String(ownSave.baseid), m: m as RosterSource["m"] }]
      : [];
  return rosterOf(sources, flingerLevel, ownSave);
};

/** The monsters summed over `sources`, and what belongs to the player. */
const rosterOf = (
  sources: RosterSource[],
  flingerLevel: number,
  ownSave: RosterSave | null,
): AttackRoster => {
  const monsters: Record<string, number> = {};
  for (const { m } of sources) {
    const housed = m["housed"];
    if (typeof housed !== "object" || housed === null) continue;
    for (const [id, count] of Object.entries(housed as Record<string, unknown>)) {
      if (typeof count !== "number" || count <= 0) continue;
      monsters[id] = (monsters[id] ?? 0) + count;
    }
  }

  const levels: Record<string, number> = {};
  for (const [id, entry] of Object.entries(ownSave?.academy ?? {})) {
    if (typeof entry?.level === "number") levels[id] = entry.level;
  }

  const siege = ownSave?.siege;

  return {
    monsters,
    levels,
    champions: ownSave?.champion ?? [],
    flingerLevel,
    catapultLevel: ownCatapultLevel(ownSave),
    sources,
    siege: typeof siege === "object" && siege !== null ? (siege as SiegeInventory) : null,
    resources: ownSave?.resources ?? null,
    storageCap: ownSave ? storageCapOf(ownSave) : null,
    ...(typeof ownSave?.credits === "number" ? { credits: ownSave.credits } : {}),
  };
};

/** A champion that may be flung (`combat.md:750-751`). */
export const isHealthyChampion = (champion: ChampionSaveEntry): boolean =>
  champion.hp > 0 && champion.status === 0;

/** True when the roster holds at least one monster or a healthy champion. */
export const hasAnythingToSend = (roster: AttackRoster): boolean =>
  Object.values(roster.monsters).some((count) => count > 0) ||
  roster.champions.some(isHealthyChampion);

/**
 * Why Attack is not offered on this cell, or null when it is.
 *
 * The order is the Flash client's (`maproom2.md:365-379`), minus the feature
 * flag (the server no longer reads one) and the two confirmation prompts,
 * which do not block. The wording is what the button shows.
 */
export const attackRefusal = (
  payload: MapCell | undefined,
  roster: AttackRoster,
  nowSeconds: number,
): string | null => {
  if (!payload) return "Waiting for this zone to load.";
  if (isWaterCell(payload)) return "Water cannot be attacked.";
  if (isPlayerCell(payload)) {
    if (payload.mine === 1) return "This is your own yard.";
    if (payload.p === 1) return "This yard is under damage protection.";
    if (payload.t !== undefined && payload.t > nowSeconds) return "You have a truce with this player.";
  }
  if (roster.flingerLevel === 0) return "None of your flingers can reach this cell.";
  if (!hasAnythingToSend(roster)) return "You have no monsters or healthy champion in range.";
  return null;
};
