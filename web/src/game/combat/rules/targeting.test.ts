import { describe, expect, it } from "vitest";

import {
  CREEP_CELL_SIZE,
  TARGETS_ATTACKERS,
  TARGETS_DEFENDERS,
  TARGETS_FLYING,
  TARGETS_GROUND,
  TARGETS_INVISIBLE,
  TRAP_TARGETS,
  canHit,
  createCreepIndex,
  defenseFlags,
  findBuildingTarget,
  isBunker,
  isFlyingMovement,
  oldStyleTargets,
  towerTargets,
} from "./targeting.js";
import { TARGET_GROUP } from "./stats.js";
import { buildEngineYard } from "./yard.js";
import type { CreepView } from "./targeting.js";
import type { CombatBuildingDataMap, CombatBuildingData } from "./types.js";

/**
 * Who may shoot whom, and what a creep walks towards.
 *
 * The flag table is the part that is easy to get subtly wrong — an Aerial
 * Defense Tower that can hit the ground, or a Booby Trap that fires at a flyer,
 * would each change every battle — so it is asserted mode by mode against
 * `Targeting.getOldStyleTargets` and the `_targetFlyerMode` rows.
 */

/** A yard with one of everything a target group cares about. */
const sampleYard = () => {
  const buildings: Record<string, CombatBuildingData> = {
    "1": { id: 1, t: 14, X: 0, Y: 0 },
    "2": { id: 2, t: 17, X: 100, Y: 0 },
    "3": { id: 3, t: 20, X: 200, Y: 0 },
    "4": { id: 4, t: 1, X: 300, Y: 0, st: 500 },
    "5": { id: 5, t: 1, X: 40, Y: 0, st: 0 },
    "6": { id: 6, t: 22, X: 400, Y: 0 },
    "7": { id: 7, t: 24, X: 20, Y: 0 },
  };
  return buildEngineYard({ buildingdata: buildings as CombatBuildingDataMap });
};

const noBunkers = { bunkerInUse: () => false };
const allBunkers = { bunkerInUse: () => true };

const creep = (id: number, x: number, y: number, flags: number): CreepView => ({
  id,
  x,
  y,
  hp: 100,
  flags,
  targetable: true,
});

describe("the flag table", () => {
  it("is `Targeting.getOldStyleTargets` mode for mode", () => {
    expect(oldStyleTargets(-1)).toBe(TARGETS_GROUND | TARGETS_INVISIBLE | TARGETS_ATTACKERS);
    expect(oldStyleTargets(0)).toBe(TARGETS_GROUND | TARGETS_ATTACKERS);
    expect(oldStyleTargets(1)).toBe(TARGETS_GROUND | TARGETS_FLYING | TARGETS_ATTACKERS);
    expect(oldStyleTargets(2)).toBe(TARGETS_FLYING | TARGETS_ATTACKERS);
  });

  it("reads each tower's `_targetFlyerMode` row", () => {
    // Cannon ground only, Sniper both, Aerial Defense air only (`BTOWER.as:25-35`).
    expect(canHit(towerTargets(20), defenseFlags(false, false, false))).toBe(true);
    expect(canHit(towerTargets(20), defenseFlags(false, true, false))).toBe(false);
    expect(canHit(towerTargets(21), defenseFlags(false, true, false))).toBe(true);
    expect(canHit(towerTargets(115), defenseFlags(false, false, false))).toBe(false);
    expect(canHit(towerTargets(115), defenseFlags(false, true, false))).toBe(true);
  });

  it("lets a trap fire under a cloaked creep and never at a flyer", () => {
    expect(TRAP_TARGETS).toBe(oldStyleTargets(-1));
    expect(canHit(TRAP_TARGETS, defenseFlags(false, false, true))).toBe(true);
    expect(canHit(TRAP_TARGETS, defenseFlags(false, true, false))).toBe(false);
  });

  it("keeps a tower off the defender's own monsters", () => {
    expect(canHit(towerTargets(20), defenseFlags(true, false, false))).toBe(false);
    expect(defenseFlags(true, false, false) & TARGETS_DEFENDERS).toBeTruthy();
  });

  it("reads `fly` and `fly_low` as airborne and nothing else", () => {
    expect(isFlyingMovement("fly")).toBe(true);
    expect(isFlyingMovement("fly_low")).toBe(true);
    expect(isFlyingMovement("burrow")).toBe(false);
    expect(isFlyingMovement(undefined)).toBe(false);
  });
});

describe("the creep index", () => {
  it("buckets at 100 units, as `Targeting._CELLSIZE` does", () => {
    expect(CREEP_CELL_SIZE).toBe(100);
  });

  it("finds everything inside the radius and nothing outside it", () => {
    const index = createCreepIndex<CreepView>();
    const flags = oldStyleTargets(1);
    const near = creep(1, 10, 10, defenseFlags(false, false, false));
    const far = creep(2, 900, 900, defenseFlags(false, false, false));
    index.rebuild([near, far]);
    const hits = index.inRange(200, 0, 0, flags);
    expect(hits.map((hit) => hit.creep.id)).toEqual([1]);
    expect(index.closest(200, 0, 0, flags)?.id).toBe(1);
    expect(index.closest(50, 900, 900, flags)?.id).toBe(2);
  });

  it("orders by distance and breaks a tie by id", () => {
    const index = createCreepIndex<CreepView>();
    const flags = oldStyleTargets(1);
    const attackers = defenseFlags(false, false, false);
    index.rebuild([creep(9, 30, 0, attackers), creep(3, 0, 30, attackers), creep(5, 10, 0, attackers)]);
    expect(index.inRange(400, 0, 0, flags).map((hit) => hit.creep.id)).toEqual([5, 3, 9]);
  });

  it("skips the dead, the untargetable and the excluded", () => {
    const index = createCreepIndex<CreepView>();
    const flags = oldStyleTargets(1);
    const attackers = defenseFlags(false, false, false);
    const dead = { ...creep(1, 10, 0, attackers), hp: 0 };
    const jarred = { ...creep(2, 10, 0, attackers), targetable: false };
    index.rebuild([dead, jarred, creep(3, 10, 0, attackers)]);
    expect(index.inRange(100, 0, 0, flags).map((hit) => hit.creep.id)).toEqual([3]);
    expect(index.inRange(100, 0, 0, flags, 3)).toEqual([]);
  });
});

describe("findBuildingTarget", () => {
  const yard = sampleYard();

  it("group 2 takes the wall and nothing else", () => {
    const found = findBuildingTarget(yard, 0, 0, TARGET_GROUP.WALLS, noBunkers);
    expect(found.closest?.id).toBe(2);
    expect(found.fellThrough).toBe(false);
  });

  it("group 3 skips a harvester that has already been looted", () => {
    const found = findBuildingTarget(yard, 0, 0, TARGET_GROUP.RESOURCES, noBunkers);
    // Id 5 is the nearer harvester but its buffer is empty (`MonsterBase.as:1021`).
    expect(found.closest?.id).toBe(4);
  });

  it("group 4 skips an empty bunker and takes it once it is in use", () => {
    const idle = findBuildingTarget(yard, 400, 0, TARGET_GROUP.TOWERS, noBunkers);
    expect(idle.closest?.id).toBe(3);
    const busy = findBuildingTarget(yard, 400, 0, TARGET_GROUP.TOWERS, allBunkers);
    expect(busy.closest?.id).toBe(6);
  });

  it("group 4 keeps hunting towers when it finds none, rather than falling back", () => {
    const empty = buildEngineYard({
      buildingdata: { "1": { id: 1, t: 14, X: 0, Y: 0 } } as CombatBuildingDataMap,
    });
    const found = findBuildingTarget(empty, 0, 0, TARGET_GROUP.TOWERS, noBunkers);
    // It still reports the fall-through; the caller is what refuses to rewrite
    // a tower specialist's group (`MonsterBase.as:1075-1077`).
    expect(found.fellThrough).toBe(true);
    expect(found.closest?.id).toBe(1);
  });

  it("group 1 never picks a wall or a trap", () => {
    const found = findBuildingTarget(yard, 90, 0, TARGET_GROUP.ALL, noBunkers);
    expect(found.closest?.kind).not.toBe("wall");
    expect(found.closest?.kind).not.toBe("trap");
    expect(found.second?.kind).not.toBe("wall");
  });

  it("hands back the two closest, which is what the client routes to", () => {
    const found = findBuildingTarget(yard, 0, 0, TARGET_GROUP.ALL, noBunkers);
    expect(found.closest).not.toBeNull();
    expect(found.second).not.toBeNull();
    expect(found.closest?.id).not.toBe(found.second?.id);
  });

  it("returns nothing at all for a yard with nothing left standing", () => {
    const razed = buildEngineYard({
      buildingdata: { "1": { id: 1, t: 14, X: 0, Y: 0 } } as CombatBuildingDataMap,
      buildinghealthdata: { "1": 0 },
    });
    const found = findBuildingTarget(razed, 0, 0, TARGET_GROUP.ALL, noBunkers);
    expect(found.closest).toBeNull();
  });

  it("knows which types are bunkers", () => {
    expect(isBunker(22)).toBe(true);
    expect(isBunker(128)).toBe(true);
    expect(isBunker(20)).toBe(false);
  });
});
