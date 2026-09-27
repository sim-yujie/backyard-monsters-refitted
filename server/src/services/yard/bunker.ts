import { hatchCost, housingSpace } from "../../game-data/monsterCatalogue.js";
import { capacity } from "../../game-rules/combat/stats.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { fitCredit } from "./credit.js";
import { academyLevels, isMapRoom3Monsters } from "./hatchery.js";
import { juiceGoo, workingJuicer, type JuiceSave } from "./juice.js";
import { levelOf, monsterIdOf, readHoused } from "./production.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The Monster Bunker: `POST /bm/yard/bunker/fill` and `/bunker/remove`
 * (`docs/design/yard-buildings.md` §7.1, decision D11; issue #120;
 * `docs/specs/monsters-and-hatchery.md` §6.3).
 *
 * **Storage.** Each bunker keeps its own contents on its building entry,
 * `buildingdata[id].m = { monsterId: count }`, as the original read and wrote
 * them (`client/scripts/BUILDING22.as:665-676` on load, `:683-700` on save).
 * Its room is the Map Room 2 table, 380 / 450 / 540 / 660 / 800 by level
 * (`GLOBAL.as:683`, `capacity(22, level)`), measured in the same `cStorage`
 * the housing uses, at each monster's academy level (`BUILDING22.as:313-320`).
 * A bunker part-way through an upgrade holds at its old level, since `l`
 * moves only when the upgrade finishes; one still being built holds nothing
 * (`BUILDING22.Setup` sets a capacity only from level 1, `:677-680`).
 *
 * **Fill** (`MONSTERBUNKERPOPUP.as:503-558`), for the whole selection at once:
 *
 * - `housing`: the monsters leave housing, for `cResource × 0.5 × count` putty
 *   per type (`GetCost`, `:464-476`, an `int`, so each type's figure is
 *   rounded down; `cResource` at the academy level).
 * - `buy`: Shiny at the original's per-monster prices (`BUYABLE_MONSTERS`,
 *   `:30-46`), the monster unlocked in the locker (`CheckID`, `:627-629`); it
 *   was charged as the store item `BUNK`.
 *
 * Only `BUNKERABLE_MONSTERS` go in (`:48-69`): C1-C13 and C17. The Inferno
 * ids on that list are left out with Inferno itself (D19). Room is checked
 * against everything already in the bunker plus the whole selection
 * (`CheckID`, `:595-615`).
 *
 * **Remove** (D11, the Map Room 2 rule): nothing goes back to housing. A
 * monster taken out is juiced for goo when a Juicer works (the Juicer's own
 * rule, `juice.ts`), else simply deleted (`BunkerJuiceById`, `:698-745`).
 * The putty or Shiny it cost is never refunded.
 *
 * Pure: the wrapper hands in the caught-up save, charges the putty or the
 * Shiny, clamps the goo and writes.
 */

/** Monster Bunker type id (`client/scripts/YARD_PROPS.as:2410`). */
export const BUNKER_TYPE = 22;

/** Monsters a Map Room 2 bunker takes (`MONSTERBUNKERPOPUP.as:48-69`, Inferno ids left out). */
export const BUNKERABLE_MONSTERS: readonly string[] = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C17",
];

/** Shiny per monster bought straight into a bunker (`MONSTERBUNKERPOPUP.as:30-46`, Inferno ids left out). */
export const BUNKER_BUY_PRICES: Readonly<Record<string, number>> = {
  C2: 2,
  C5: 16,
  C6: 5,
  C7: 8,
  C8: 12,
  C10: 14,
  C11: 24,
  C12: 65,
  C13: 24,
  C17: 17,
};

/** Putty per unit of hatch cost when a monster moves from housing into a bunker (`:467`). */
export const BUNKER_PUTTY_RATE = 0.5;

/** Where a fill takes its monsters from. */
export type BunkerSource = "housing" | "buy";

/** The slice of a save the bunker routes read. */
export interface BunkerSave extends JuiceSave {
  buildingdata?: BuildingDataMap | null;
  monsters?: JsonObject | null;
  lockerdata?: JsonObject | null;
  academy?: JsonObject | null;
}

/** A whole number ≥ 0 off a jsonb field, 0 otherwise. */
const whole = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

/** A bunker's level: 0 while it is being built. */
const levelOfBunker = (building: BuildingData): number =>
  Number(building.cB) > 0 ? 0 : Math.max(1, Math.floor(Number(building.l)) || 1);

/** What a bunker at `level` holds (Map Room 2 table); 0 while it is being built. */
export const bunkerCapacity = (level: number): number => (level >= 1 ? capacity(BUNKER_TYPE, level) : 0);

/**
 * A bunker's contents, `m`, as whole positive counts of known monsters, legacy
 * ids merged. A Map Room 3 bunker's per-creep arrays count by their length, as
 * the original exported them (`BUILDING22.as:688-692`).
 */
export const readBunker = (building: BuildingData | undefined): Record<string, number> => {
  const raw = building?.m;
  const contents: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return contents;
  for (const [key, value] of Object.entries(raw as JsonObject)) {
    const id = monsterIdOf(key);
    const count = Array.isArray(value) ? value.length : whole(value);
    if (!id || count === 0) continue;
    contents[id] = (contents[id] ?? 0) + count;
  }
  return contents;
};

/** Space a set of monsters takes at the given academy levels. */
export const bunkerSpace = (
  contents: Readonly<Record<string, number>>,
  levels: Readonly<Record<string, number>>
): number =>
  Object.entries(contents).reduce(
    (total, [id, count]) => total + (housingSpace(id, levelOf(levels, id)) ?? 0) * count,
    0
  );

/** Putty to move `count` of `monster` from housing into a bunker (`GetCost`, rounded down per type). */
export const bunkerPutty = (
  monster: string,
  count: number,
  levels: Readonly<Record<string, number>>
): number => Math.floor((hatchCost(monster, levelOf(levels, monster)) ?? 0) * BUNKER_PUTTY_RATE * count);

/** The bunker a request names: `409 noBunker { id }` when the yard has no bunker by that id. */
const bunkerOrThrow = (save: BunkerSave, id: number): { key: string; building: BuildingData } => {
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    if (Number(building?.t) === BUNKER_TYPE && Number(building.id ?? key) === id) {
      return { key, building };
    }
  }
  throw yardRefusedErr("noBunker", "There is no Monster Bunker there.", { id });
};

/** `save.buildingdata` with one bunker's contents replaced. */
const withContents = (
  save: BunkerSave,
  key: string,
  building: BuildingData,
  contents: Readonly<Record<string, number>>
): BuildingDataMap => ({
  ...(save.buildingdata ?? {}),
  [key]: { ...building, m: { ...contents } },
});

/** `409 mapRoom3`: the Map Room 3 bunker keeps creeps, not counts, and gives them back. */
const mapRoom3Err = () =>
  yardRefusedErr("mapRoom3", "Monster Bunkers on a Map Room 3 yard are not supported yet.");

/** `report` of `bunker/fill`. */
export interface BunkerFillReport {
  bunker: number;
  source: BunkerSource;
  /** Monsters that went in, by id. */
  added: Record<string, number>;
  /** Putty charged (`housing`), 0 for `buy`. */
  cost: { r3: number };
  /** Shiny charged (`buy`), 0 for `housing`. */
  credits: number;
  /** Space the bunker now uses, and its room. */
  used: number;
  capacity: number;
}

/**
 * `POST /bm/yard/bunker/fill`: puts monsters in a bunker from housing or
 * bought with Shiny.
 *
 * Refusals, in order: `409 mapRoom3`; `409 noBunker { id }`; `409 busy`
 * (still being built); per id `400 badRequest` (not a monster) or
 * `409 notBunkerable { monster }`; for `buy`, `409 notBuyable { monster }`
 * and `409 locked { monster }`; for `housing`, `409 notEnough { monster,
 * have, need }`; `409 bunkerFull { capacity, used, need }`. The wrapper then
 * refuses `409 shortfall` (putty) or `409 shinyLocked` / `409 credits`.
 *
 * @param save - The caught-up yard.
 * @param bunkerId - The bunker's building id.
 * @param monsters - How many of each (whole, at least 1 each).
 * @param source - `housing` or `buy`.
 */
export const planBunkerFill = (
  save: BunkerSave,
  bunkerId: number,
  monsters: Readonly<Record<string, number>>,
  source: BunkerSource
) => {
  if (isMapRoom3Monsters(save.monsters)) throw mapRoom3Err();
  const { key, building } = bunkerOrThrow(save, bunkerId);
  if (building.m && Object.values(building.m as JsonObject).some(Array.isArray)) throw mapRoom3Err();

  const level = levelOfBunker(building);
  if (level === 0) {
    throw yardRefusedErr("busy", "This Monster Bunker is still being built.", { id: bunkerId });
  }

  const wanted: Record<string, number> = {};
  for (const [raw, count] of Object.entries(monsters)) {
    const id = /^C\d+$/.test(raw) ? monsterIdOf(raw) : null;
    if (!id) throw yardBadRequestErr("That is not a monster.", { monster: raw });
    if (!BUNKERABLE_MONSTERS.includes(id)) {
      throw yardRefusedErr("notBunkerable", "That monster cannot go in a Monster Bunker.", {
        monster: id,
      });
    }
    wanted[id] = (wanted[id] ?? 0) + Math.floor(count);
  }
  if (Object.keys(wanted).length === 0) {
    throw yardBadRequestErr("Pick at least one monster to put in the bunker.");
  }

  const housed = readHoused(save.monsters);
  for (const [id, need] of Object.entries(wanted)) {
    if (source === "buy") {
      if (BUNKER_BUY_PRICES[id] === undefined) {
        throw yardRefusedErr("notBuyable", "That monster cannot be bought for a bunker.", {
          monster: id,
        });
      }
      if (Number((save.lockerdata?.[id] as JsonObject | undefined)?.t) !== 2) {
        throw yardRefusedErr("locked", "Unlock that monster in the Monster Locker first.", {
          monster: id,
        });
      }
    } else {
      const have = housed[id] ?? 0;
      if (need > have) {
        throw yardRefusedErr("notEnough", "You do not have that many of that monster housed.", {
          monster: id,
          have,
          need,
        });
      }
    }
  }

  const levels = academyLevels(save.academy);
  const contents = readBunker(building);
  const room = bunkerCapacity(level);
  const used = bunkerSpace(contents, levels);
  const need = bunkerSpace(wanted, levels);
  if (used + need > room) {
    throw yardRefusedErr("bunkerFull", "That is more than the bunker has room for.", {
      capacity: room,
      used,
      need,
    });
  }

  let putty = 0;
  let credits = 0;
  for (const [id, count] of Object.entries(wanted)) {
    contents[id] = (contents[id] ?? 0) + count;
    if (source === "buy") {
      credits += BUNKER_BUY_PRICES[id]! * count;
    } else {
      putty += bunkerPutty(id, count, levels);
      housed[id] = housed[id]! - count;
      if (housed[id] === 0) delete housed[id];
    }
  }

  const report: BunkerFillReport = {
    bunker: bunkerId,
    source,
    added: wanted,
    cost: { r3: putty },
    credits,
    used: used + need,
    capacity: room,
  };
  return {
    report,
    slices: {
      buildingdata: withContents(save, key, building, contents),
      ...(source === "housing" ? { monsters: { ...(save.monsters ?? {}), housed } } : {}),
    },
    ...(putty > 0 ? { debit: { r3: putty } } : {}),
    ...(credits > 0 ? { shiny: credits } : {}),
  };
};

/** `report` of `bunker/remove`. */
export interface BunkerRemoveReport {
  bunker: number;
  monster: string;
  removed: number;
  /** True when a working Juicer turned them into goo; false when they were simply deleted. */
  juiced: boolean;
  /** Goo that landed after the cap; 0 when not juiced. */
  goo: number;
  /** Goo the cap swallowed. */
  lost: number;
}

/**
 * `POST /bm/yard/bunker/remove`: takes monsters out of a bunker for good —
 * juiced when a Juicer works, else deleted; never back to housing (D11).
 *
 * Refusals: `409 noBunker { id }`; `409 mapRoom3`; `400 badRequest` for an id
 * that is not a monster; `409 notInBunker { monster }` when the bunker holds
 * none.
 *
 * @param count - How many, capped at what the bunker holds, or `all`.
 */
export const planBunkerRemove = (
  save: BunkerSave,
  bunkerId: number,
  monster: string,
  count: number | "all"
) => {
  const { key, building } = bunkerOrThrow(save, bunkerId);
  if (building.m && Object.values(building.m as JsonObject).some(Array.isArray)) throw mapRoom3Err();

  const id = /^C\d+$/.test(monster) ? monsterIdOf(monster) : null;
  if (!id) throw yardBadRequestErr("That is not a monster.", { monster });

  const contents = readBunker(building);
  const have = contents[id] ?? 0;
  if (have === 0) {
    throw yardRefusedErr("notInBunker", "That monster is not in this bunker.", { monster: id });
  }
  const removed = count === "all" ? have : Math.min(Math.floor(count), have);
  contents[id] = have - removed;
  if (contents[id] === 0) delete contents[id];

  const juicer = workingJuicer(save);
  const goo = juicer ? juiceGoo(id, removed, academyLevels(save.academy), juicer.rate) : 0;
  const fit = fitCredit(save, { r4: goo });

  const report: BunkerRemoveReport = {
    bunker: bunkerId,
    monster: id,
    removed,
    juiced: juicer !== null,
    goo: fit.credited.r4,
    lost: fit.overflow.r4,
  };
  return {
    report,
    slices: { buildingdata: withContents(save, key, building, contents) },
    ...(goo > 0 ? { credit: { r4: goo } } : {}),
  };
};
