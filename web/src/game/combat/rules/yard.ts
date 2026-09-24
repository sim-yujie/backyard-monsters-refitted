import { GRID_COST, TRAP_STATS } from "./combatStatsData.js";
import { hpLadder, isTower, maxHp, trapStats } from "./stats.js";
import { numberOf } from "./types.js";
import type {
  BuildingHealthMap,
  CombatBuildingData,
  CombatBuildingDataMap,
  CombatTargetKind,
  ResourceAmounts,
} from "./types.js";

/**
 * The yard a battle is fought over, and the geometry every other file reads.
 *
 * `types.ts` already turns a save's two building maps into the shape the Phase
 * A audit reads: id, type, level, position, health, and nothing else, because
 * an audit never asks where a building's edges are. A simulation does. This
 * file is the second projection of the same `buildingdata`: an id-sorted array
 * of {@link EngineBuilding}, each carrying its class, its footprint, its
 * cartesian position and the mutable state a battle changes.
 *
 * The two live side by side rather than one wrapping the other because they
 * answer to different masters. `CombatYard` must reproduce what the *client*
 * saved, absences and all; `EngineYard` must reproduce what the client
 * *simulated*. The engine's result is fed back through `damagePercent()` over a
 * `CombatYard`, so the percentage rule still has exactly one implementation
 * (`docs/design/server-combat.md` §3.1).
 *
 * ## The two coordinate spaces
 *
 * A save stores isometric yard units — `X` and `Y` are the `_mc` position of
 * the building in the Flash display list. Distances, footprints and the pathing
 * grid all work in the cartesian space `PATHING.FromISO` projects into
 * (`client/scripts/com/monsters/pathing/PATHING.as:677-681`). Every building
 * therefore carries both: `x`/`y` isometric, `cx`/`cy` cartesian.
 *
 * ## Fidelity notes
 *
 * 1. **One projection, not two.** The client has two `FromISO` implementations
 *    that disagree by rounding: `PATHING.FromISO` truncates towards zero
 *    (`PATHING.as:677-681`) and `GRID.FromISO` rounds up
 *    (`client/scripts/GRID.as:141-145`), and the client calls one or the other
 *    depending on which class is asking — `Targeting.CreepCellAdd` uses
 *    `GRID`'s (`client/scripts/Targeting.as:44`) while
 *    `Targeting.getCreepsInRange` uses `PATHING`'s (`:208`). The engine uses
 *    `PATHING`'s everywhere. The difference is at most one yard unit, a
 *    twentieth of the narrowest footprint, but it means a creep exactly on a
 *    range boundary can be picked here and not in Flash.
 * 2. **Countdowns are not read.** A building under construction, upgrade or
 *    fortification cannot fire (`client/scripts/BTOWER.as:159-161`), but the
 *    countdown fields are advanced to the reference point by `referenceYard()`
 *    before the audit or the replay sees them (§2.1), so a yard handed to the
 *    engine is already current. Nothing here re-derives them.
 * 3. **Armour is not modelled.** `modifyHealth` scales a hit by `1 - armor`
 *    after fortification (`BFOUNDATION.as:511`), but no props entry in the
 *    Map Room 2 table sets one and the generator extracts none, so the engine
 *    passes 0 and `fortifiedDamage()` reduces to the fortification term.
 */

/** The `_class` string a props entry carries, which decides targeting. */
export type BuildingClass =
  | "resource"
  | "special"
  | "mushroom"
  | "wall"
  | "tower"
  | "trap"
  | "enemy"
  | "taunt"
  | "immovable"
  | "cage"
  | "decoration"
  | "placeholder";

/** `[from, from + 1, …, to]`, so the class table below reads as a range. */
const span = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let value = from; value <= to; value += 1) out.push(value);
  return out;
};

/**
 * Every building type, grouped by the `_class` its props entry declares.
 *
 * Transcribed from the per-type comments the combat stats generator writes into
 * `combatStatsData.ts` — each `GRID_COST` and `BUILDING_HP` row names its class
 * — which read it out of `client/scripts/YARD_PROPS.as`. `yard.test.ts`
 * re-parses those comments and fails if this table stops agreeing with them, so
 * the transcription cannot drift away from the generated file.
 *
 * The class matters four times over: `findTarget` skips `decoration`,
 * `immovable` and `enemy` outright (`MonsterBase.as:1072-1085`), a `targetGroup`
 * 2 creep deals double to a `wall` and a `targetGroup` 4 creep double to a
 * `tower` (`CreepBase.as:884-894`), the damage percentage excludes `wall` and
 * `mushroom` from both of its sums (`BFOUNDATION.as:444-451`), and only a
 * `wall` registers as a pathing blocker (`client/scripts/BWALL.as:11-13`).
 */
const CLASS_MEMBERS: Readonly<Record<BuildingClass, readonly number[]>> = {
  resource: [1, 2, 3, 4],
  special: [5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 26, 51, 112, 113, 116, 119, 133, 134, 140],
  mushroom: [7],
  wall: [17, 18],
  tower: [20, 21, 22, 23, 25, 115, 118, 128, 129, 130, 132, 136, 137, 138],
  trap: [24, 117],
  enemy: [27, 127],
  taunt: [52],
  immovable: [53, 54],
  cage: [114, 139],
  decoration: [...span(28, 50), ...span(55, 111), 120, 121, 131, 135],
  placeholder: span(122, 126),
};

const CLASS_OF: Readonly<Record<number, BuildingClass>> = (() => {
  const table: Record<number, BuildingClass> = {};
  for (const name of Object.keys(CLASS_MEMBERS) as BuildingClass[]) {
    for (const type of CLASS_MEMBERS[name]) table[type] = name;
  }
  return table;
})();

/** The props `_class` of a building type; an unknown type reads as scenery. */
export const buildingClass = (type: number): BuildingClass => CLASS_OF[type] ?? "decoration";

/**
 * Whether this type registers on the pathing grid as something to walk into.
 *
 * `BWALL` is the only class that calls `PATHING.RegisterBuilding`
 * (`client/scripts/BWALL.as:11-13`, `:30`), so a wall is the only building a
 * path is cut short by; everything else is walked around or through, priced by
 * its cost rectangles alone.
 */
export const blocksPathing = (type: number): boolean => buildingClass(type) === "wall";

/**
 * Whether a building belongs to `BASE._buildingsMain`, the pool group 1 uses.
 *
 * `BFOUNDATION.Place` files a building by class (`BFOUNDATION.as:1926-1946`):
 * a wall goes to `_buildingsWalls` alone, a trap to `_buildingsTowers` alone, a
 * tower to both `_buildingsTowers` and `_buildingsMain`, a gift or taunt to
 * `_buildingsGifts`, a cage nowhere, and everything else to `_buildingsMain`.
 * `findTarget`'s fall-through then filters that pool down again, dropping
 * `decoration`, `immovable` and `enemy` (`MonsterBase.as:1073-1085`).
 *
 * The consequence is worth spelling out, because it drives the whole shape of a
 * battle: **a creep never chooses a wall**. It walks at something behind the
 * wall and the pathing grid hands it the wall that is in the way
 * (`grid.ts`, `PATHING.as:445-452`). Only a `targetGroup` 2 specialist picks
 * one on purpose.
 */
export const isMainTarget = (kind: BuildingClass): boolean =>
  kind === "resource" || kind === "special" || kind === "tower" || kind === "placeholder";

/** A footprint in yard units. */
export interface Footprint {
  readonly w: number;
  readonly h: number;
}

/**
 * The `_footprint[0]` rectangle of every type a battle can touch.
 *
 * Transcribed from `server/src/game-data/buildingFootprints.ts`, itself derived
 * from `docs/specs/base-building.md` §2 and the generated art extract;
 * `yard.test.ts` asserts every row against it. Only the 51 non-decoration types
 * are carried, because a decoration is never a target and never blocks: an
 * absent type falls back to its pathing rectangle and then to the 40 x 40
 * default `buildingFootprints.ts` uses.
 */
const FOOTPRINTS: Readonly<Record<number, Footprint>> = {
  1: { w: 70, h: 70 },
  2: { w: 70, h: 70 },
  3: { w: 70, h: 70 },
  4: { w: 70, h: 70 },
  5: { w: 90, h: 90 },
  6: { w: 80, h: 80 },
  7: { w: 30, h: 30 },
  8: { w: 100, h: 100 },
  9: { w: 80, h: 80 },
  10: { w: 100, h: 100 },
  11: { w: 90, h: 90 },
  12: { w: 70, h: 70 },
  13: { w: 100, h: 100 },
  14: { w: 130, h: 130 },
  15: { w: 160, h: 160 },
  16: { w: 100, h: 100 },
  17: { w: 20, h: 20 },
  18: { w: 20, h: 20 },
  19: { w: 80, h: 80 },
  20: { w: 70, h: 70 },
  21: { w: 70, h: 70 },
  22: { w: 90, h: 90 },
  23: { w: 70, h: 70 },
  24: { w: 20, h: 20 },
  25: { w: 70, h: 70 },
  26: { w: 100, h: 100 },
  27: { w: 140, h: 140 },
  51: { w: 90, h: 90 },
  52: { w: 40, h: 40 },
  53: { w: 10, h: 10 },
  54: { w: 10, h: 10 },
  112: { w: 130, h: 130 },
  113: { w: 80, h: 80 },
  114: { w: 160, h: 160 },
  115: { w: 70, h: 70 },
  116: { w: 100, h: 100 },
  117: { w: 20, h: 20 },
  118: { w: 70, h: 70 },
  119: { w: 100, h: 100 },
  127: { w: 190, h: 160 },
  128: { w: 160, h: 160 },
  129: { w: 70, h: 70 },
  130: { w: 70, h: 70 },
  132: { w: 70, h: 70 },
  133: { w: 100, h: 100 },
  134: { w: 100, h: 100 },
  136: { w: 70, h: 70 },
  137: { w: 70, h: 70 },
  138: { w: 130, h: 130 },
  139: { w: 130, h: 130 },
  140: { w: 130, h: 130 },
};

/** The 40 x 40 `DEFAULT_FOOTPRINT` of `server/src/game-data/buildingFootprints.ts`. */
export const DEFAULT_FOOTPRINT: Footprint = { w: 40, h: 40 };

/** A type's footprint, falling back to its pathing rectangle then the default. */
export const footprintOf = (type: number): Footprint => {
  const known = FOOTPRINTS[type];
  if (known) return known;
  const rect = GRID_COST[type]?.[0];
  if (rect) return { w: rect[2], h: rect[3] };
  return DEFAULT_FOOTPRINT;
};

/* ── Coordinates ──────────────────────────────────────────────────────────── */

/** A point in the cartesian space the grid and every distance work in. */
export interface Cart {
  readonly x: number;
  readonly y: number;
}

/**
 * Isometric yard units to cartesian.
 *
 * `PATHING.FromISO` (`PATHING.as:677-681`), whose two locals are declared `int`,
 * so each component truncates towards zero.
 */
export const fromIso = (x: number, y: number): Cart => ({
  x: Math.trunc(x * 0.5 + y),
  y: Math.trunc(y - x * 0.5),
});

/** Cartesian back to isometric, `PATHING.ToISO` with a zero offset (`:671-675`). */
export const toIso = (x: number, y: number): Cart => ({
  x: Math.trunc(x - y),
  y: Math.trunc((x + y) * 0.5),
});

/** `GLOBAL.QuickDistance`: the plain euclidean distance (`GLOBAL.as:2022-2026`). */
export const distance = (ax: number, ay: number, bx: number, by: number): number =>
  Math.sqrt(distanceSquared(ax, ay, bx, by));

/** The same without the square root, which is what every range test uses. */
export const distanceSquared = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

/* ── Buildings ────────────────────────────────────────────────────────────── */

/** A building as the engine holds it: geometry, class and mutable state. */
export interface EngineBuilding {
  readonly id: number;
  readonly type: number;
  readonly level: number;
  readonly kind: BuildingClass;
  /** Isometric yard units, exactly as `buildingdata` spells them. */
  readonly x: number;
  readonly y: number;
  /** The cartesian projection of the building's anchor point. */
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  /** `_middle`, half the footprint height (`BFOUNDATION.as:678`). */
  readonly middle: number;
  readonly maxHp: number;
  readonly fortification: number;
  /** Whether this type carries a `stats` block and shoots back. */
  readonly tower: boolean;
  /** Whether this type is a one-shot trap. */
  readonly trap: boolean;
  /** Mutable: current health, 0 once destroyed. */
  hp: number;
  /** Mutable: a trap that has already gone off. */
  fired: boolean;
  /** Mutable: a harvester whose buffer is empty, which `targetGroup` 3 skips. */
  looted: boolean;
  /** Mutable: the unbanked buffer still in a harvester. */
  stored: number;
  /** Mutable: a tower under a siege Jar is not a valid target (`BTOWER.as:251-253`). */
  jarred: boolean;
}

/** The yard a battle mutates. */
export interface EngineYard {
  /** Id-sorted, which is the iteration order every rule uses (§3.4 rule 4). */
  readonly buildings: readonly EngineBuilding[];
  /** Id to index into {@link buildings}. */
  readonly byId: ReadonlyMap<number, number>;
  /** The defender's resource pool, which storage buildings hand out of. */
  readonly resources: ResourceAmounts;
  /** What the yard is, which scales what storage gives up. */
  readonly kind: CombatTargetKind;
}

/** What {@link buildEngineYard} is handed. */
export interface EngineYardInput {
  /** `buildingdata`, either the stored id-keyed map or a plain array. */
  readonly buildingdata: CombatBuildingDataMap | readonly CombatBuildingData[];
  /** `buildinghealthdata`: id to current health, an absent id meaning full. */
  readonly buildinghealthdata?: BuildingHealthMap | null;
  readonly resources?: Partial<ResourceAmounts> | null;
  readonly kind?: CombatTargetKind;
}

/**
 * The maximum health of one building, with the trap's single-level ladder.
 *
 * A trap's `hp` is on its props entry like any other building's and `TRAP_STATS`
 * carries it too; the two agree, so this prefers the ladder and falls back to
 * the trap table for a type whose ladder the generator did not find.
 */
export const buildingMaxHp = (type: number, level: number): number => {
  const fromLadder = maxHp(type, level);
  if (fromLadder > 0) return fromLadder;
  return trapStats(type)?.hp ?? 0;
};

/** Whether a type has any health at all, which three of 140 props entries lack. */
export const hasHealth = (type: number): boolean =>
  hpLadder(type).length > 0 || TRAP_STATS[type] !== undefined;

/**
 * Turn stored `buildingdata` into the yard the engine simulates.
 *
 * Entries are sorted by id, because the engine's iteration order is the
 * digest's iteration order and a `for…in` over the stored map would be at the
 * mercy of how each runtime orders integer-like keys (§3.4 rule 4). An entry
 * with no `id` takes its map key, which is what the stored shape means. Levels
 * and health use the same two defaults `toCombatYard()` applies: an absent `l`
 * is level 1 and an absent health entry is full health.
 */
export const buildEngineYard = (input: EngineYardInput): EngineYard => {
  const raw = input.buildingdata;
  const list: Array<{ id: number; data: CombatBuildingData }> = Array.isArray(raw)
    ? (raw as readonly CombatBuildingData[]).map((data, index) => ({
        id: Math.floor(numberOf(data.id ?? index)),
        data,
      }))
    : Object.entries(raw as CombatBuildingDataMap)
        .filter(([, data]) => Boolean(data) && typeof data === "object")
        .map(([key, data]) => ({ id: Math.floor(numberOf(data.id ?? key)), data }));

  list.sort((one, other) => one.id - other.id);

  const health = input.buildinghealthdata ?? {};
  const buildings: EngineBuilding[] = [];

  for (const { id, data } of list) {
    const type = Math.floor(numberOf(data.t));
    const rawLevel = Math.floor(numberOf(data.l));
    const level = rawLevel > 0 ? rawLevel : 1;
    const footprint = footprintOf(type);
    const anchor = fromIso(numberOf(data.X), numberOf(data.Y));
    const ceiling = buildingMaxHp(type, level);
    const reported = health[String(id)];
    const kind = buildingClass(type);
    const trap = kind === "trap";
    const banked = Math.max(0, numberOf(data.st));
    buildings.push({
      id,
      type,
      level,
      kind,
      x: numberOf(data.X),
      y: numberOf(data.Y),
      cx: anchor.x,
      cy: anchor.y,
      w: footprint.w,
      h: footprint.h,
      middle: footprint.h * 0.5,
      maxHp: ceiling,
      fortification: Math.max(0, Math.floor(numberOf(data.fort))),
      tower: isTower(type),
      trap,
      hp: reported === undefined ? ceiling : Math.max(0, Math.min(ceiling, numberOf(reported))),
      fired: trap && reported === 0,
      looted: banked <= 0,
      stored: banked,
      jarred: false,
    });
  }

  const byId = new Map<number, number>();
  buildings.forEach((building, index) => byId.set(building.id, index));

  const pool = input.resources ?? {};
  return {
    buildings,
    byId,
    resources: {
      r1: Math.max(0, numberOf(pool.r1)),
      r2: Math.max(0, numberOf(pool.r2)),
      r3: Math.max(0, numberOf(pool.r3)),
      r4: Math.max(0, numberOf(pool.r4)),
    },
    kind: input.kind ?? "main",
  };
};

/** Whether a building is still standing and able to be hit. */
export const isAlive = (building: EngineBuilding): boolean =>
  building.hp > 0 && !building.fired;
