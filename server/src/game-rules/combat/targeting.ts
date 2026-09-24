import { TARGET_GROUP, flyerMode, isLootable } from "./stats.js";
import { distanceSquared, isMainTarget } from "./yard.js";
import type { EngineBuilding, EngineYard } from "./yard.js";

/**
 * Who may shoot whom, and what a creep walks towards.
 *
 * Two separate mechanisms share this file because the client keeps them in one
 * class. The first is the **flag bitmask**: every attacker carries the flags it
 * can hit and every defender the flags it can be hit by, and `canHitCreep`
 * intersects them (`client/scripts/Targeting.as:11-23`, `:322-325`). It is what
 * decides whether an Aerial Defense Tower may fire at a ground creep, or a
 * Booby Trap at a Teratorn. The second is **target selection**: the six
 * `targetGroup` values, each with its own pool of buildings and its own reason
 * to fall through to "everything"
 * (`client/scripts/com/monsters/monsters/MonsterBase.as:991-1090`).
 *
 * The creep index at the bottom is the client's 100-unit spatial bucketing
 * (`Targeting.as:29`, `:41-52`, `:192-256`), which is what keeps a tower's
 * range scan from touching every creep on the field.
 *
 * ## Fidelity notes
 *
 * 1. **Ties are broken by id.** The client sorts its candidate lists with
 *    `Array.NUMERIC` on `dist` alone (`Targeting.as:332`, `BTOWER.as:399-409`),
 *    and iterates the buckets with `for…in`, so two creeps at the same distance
 *    are ordered by whatever the runtime feels like. The engine sorts by
 *    distance and then by creep id, because a digest cannot survive an
 *    arbitrary order (`docs/design/server-combat.md` §3.4 rule 4).
 * 2. **A creep is a point.** The client tests a creep's `_tmpPoint` against a
 *    circle and a building's anchor against the same circle
 *    (`Targeting.as:151-173`), taking no account of either footprint. That is
 *    reproduced: range is measured anchor to anchor, and only `findTarget`
 *    subtracts the target's `_middle` (`MonsterBase.as:999`).
 * 3. **Invisibility and the Vacuum hose are not modelled.** `Invisibility` is
 *    one of the abilities `docs/specs/combat.md:1362-1375` never traced, and
 *    the hose is a siege weapon target rather than a creep
 *    (`BTOWER.as:163-169`). The flag exists so the table is complete; nothing
 *    in the engine sets it yet.
 */

/* ── The flag bitmask (`Targeting.as:11-23`) ──────────────────────────────── */

export const TARGETS_DEFENDERS = 1 << 0;
export const TARGETS_ATTACKERS = 1 << 1;
export const TARGETS_GROUND = 1 << 2;
export const TARGETS_FLYING = 1 << 3;
export const TARGETS_INVISIBLE = 1 << 4;
export const TARGETS_BUILDINGS = 1 << 5;

/**
 * The flags a flyer mode grants, plus "attackers" (`Targeting.as:175-190`).
 *
 * -1 is the trap's mode: ground and invisible, which is why a Booby Trap fires
 * under a cloaked creep and never at a Teratorn (`client/scripts/BTRAP.as:26`).
 * 0 is ground only, 1 is both, 2 is air only.
 */
export const oldStyleTargets = (mode: number): number => {
  let flags = 0;
  if (mode === -1) flags |= TARGETS_GROUND | TARGETS_INVISIBLE;
  else if (mode === 0) flags |= TARGETS_GROUND;
  else if (mode === 1) flags |= TARGETS_GROUND | TARGETS_FLYING;
  else if (mode === 2) flags |= TARGETS_FLYING;
  return flags | TARGETS_ATTACKERS;
};

/** The flags a defending building fires with, from its `_targetFlyerMode` row. */
export const towerTargets = (type: number): number => oldStyleTargets(flyerMode(type));

/** The trap's fixed mode, which no props entry carries (`BTRAP.as:26`). */
export const TRAP_TARGETS = oldStyleTargets(-1);

/**
 * `Targeting.canHitCreep` (`:322-325`): every flag the defender carries must be
 * one the attacker can reach.
 */
export const canHit = (attackerFlags: number, defenderFlags: number): boolean =>
  (~attackerFlags & defenderFlags) === 0;

/** The flags a creep is hit by: which side it is on, and how it travels. */
export const defenseFlags = (friendly: boolean, flying: boolean, invisible: boolean): number => {
  let flags = friendly ? TARGETS_DEFENDERS : TARGETS_ATTACKERS;
  flags |= flying ? TARGETS_FLYING : TARGETS_GROUND;
  if (invisible) flags |= TARGETS_INVISIBLE;
  return flags;
};

/**
 * Whether a monster's `movement` string puts it in the air.
 *
 * `fly` and `fly_low` are the two airborne modes `findTarget` branches on
 * (`MonsterBase.as:1121`); `burrow` and `jump` are on the ground for targeting
 * even though they move differently.
 */
export const isFlyingMovement = (movement: string | undefined): boolean =>
  movement === "fly" || movement === "fly_low";

/* ── The creep index (`Targeting.as:29`, `:192-256`) ──────────────────────── */

/** The side of a 100-unit bucket, which is the client's `_CELLSIZE`. */
export const CREEP_CELL_SIZE = 100;

/** What the index needs to know about a creep; the engine's creep satisfies it. */
export interface CreepView {
  readonly id: number;
  /** Cartesian position, which is the space every range test works in. */
  x: number;
  y: number;
  hp: number;
  /** The flags this creep is hit by, {@link defenseFlags}. */
  flags: number;
  /** A creep in a cage or under a Jar is not a valid target. */
  targetable: boolean;
}

/** One hit from a range scan. */
export interface CreepHit<T extends CreepView> {
  readonly creep: T;
  readonly dist: number;
}

/** Buckets of live creeps, rebuilt once a tick. */
export interface CreepIndex<T extends CreepView> {
  /** Re-bucket every creep; cheap enough to run on the ticks that scan. */
  rebuild(creeps: readonly T[]): void;
  /** Everything inside `radius` of a cartesian point that `flags` may hit. */
  inRange(radius: number, x: number, y: number, flags: number, exclude?: number): CreepHit<T>[];
  /** The single closest, or null. */
  closest(radius: number, x: number, y: number, flags: number, exclude?: number): T | null;
}

const bucketAxis = (value: number): number => Math.trunc(value / CREEP_CELL_SIZE);

/** Buckets are keyed by a packed pair; the offset keeps both halves positive. */
const BUCKET_OFFSET = 512;
const bucketKey = (bucketX: number, bucketY: number): number =>
  (bucketX + BUCKET_OFFSET) * 1024 + (bucketY + BUCKET_OFFSET);

/** Distance then id, so the order is the same on every runtime (note 1). */
const byDistanceThenId = <T extends CreepView>(one: CreepHit<T>, other: CreepHit<T>): number =>
  one.dist === other.dist ? one.creep.id - other.creep.id : one.dist - other.dist;

export const createCreepIndex = <T extends CreepView>(): CreepIndex<T> => {
  const buckets = new Map<number, T[]>();

  const rebuild = (creeps: readonly T[]): void => {
    for (const bucket of buckets.values()) bucket.length = 0;
    for (const creep of creeps) {
      if (creep.hp <= 0) continue;
      const key = bucketKey(bucketAxis(creep.x), bucketAxis(creep.y));
      const bucket = buckets.get(key);
      if (bucket) bucket.push(creep);
      else buckets.set(key, [creep]);
    }
  };

  const inRange = (
    radius: number,
    x: number,
    y: number,
    flags: number,
    exclude?: number,
  ): CreepHit<T>[] => {
    const hits: CreepHit<T>[] = [];
    if (radius <= 0) return hits;
    const centreX = bucketAxis(x);
    const centreY = bucketAxis(y);
    const reach = Math.trunc(radius / CREEP_CELL_SIZE) + 1;
    const limit = radius * radius;
    for (let bucketX = centreX - reach; bucketX <= centreX + reach; bucketX += 1) {
      for (let bucketY = centreY - reach; bucketY <= centreY + reach; bucketY += 1) {
        const bucket = buckets.get(bucketKey(bucketX, bucketY));
        if (!bucket) continue;
        for (const creep of bucket) {
          if (creep.hp <= 0 || !creep.targetable || creep.id === exclude) continue;
          if (!canHit(flags, creep.flags)) continue;
          // `int(QuickDistanceSquared(...)) < radius * radius` (`Targeting.as:241`).
          const squared = Math.trunc(distanceSquared(x, y, creep.x, creep.y));
          if (squared < limit) hits.push({ creep, dist: Math.sqrt(squared) });
        }
      }
    }
    hits.sort(byDistanceThenId);
    return hits;
  };

  return {
    rebuild,
    inRange,
    closest: (radius, x, y, flags, exclude) =>
      inRange(radius, x, y, flags, exclude)[0]?.creep ?? null,
  };
};

/* ── Choosing a building (`MonsterBase.findTarget`, `:991-1090`) ──────────── */

/** The types a `targetGroup` 3 creep is after: harvesters and storage. */
export const isLootableTarget = (building: EngineBuilding): boolean =>
  isLootable(building.type) && !building.looted;

/** Bunker types, which group 4 and group 6 only take when they are in use. */
export const BUNKER_TYPES: readonly number[] = [22, 128];

/** `MONSTERBUNKER.isBunkerBuilding` (`client/scripts/MONSTERBUNKER.as`). */
export const isBunker = (type: number): boolean => BUNKER_TYPES.includes(type);

/** What a caller must tell the rules about state the yard does not carry. */
export interface TargetContext {
  /** Whether a bunker still holds or has already sent out defenders. */
  bunkerInUse(building: EngineBuilding): boolean;
}

/** The closest two buildings, which is what a creep asks a route for. */
export interface BuildingTarget {
  readonly closest: EngineBuilding | null;
  readonly second: EngineBuilding | null;
  /**
   * The group found nothing and fell through to "everything".
   *
   * The client rewrites `_targetGroup` to 1 when it does, unless the creep is a
   * tower specialist, which keeps hunting towers (`MonsterBase.as:1072-1077`).
   */
  readonly fellThrough: boolean;
}

/**
 * The two closest buildings of a creep's preferred class.
 *
 * `checkTarget` measures anchor to anchor and subtracts the candidate's
 * `_middle`, so a big building is "closer" than its corner suggests
 * (`MonsterBase.as:997-1009`). It keeps a running closest and second closest
 * rather than sorting, and the engine keeps the same two because `findTarget`
 * asks the grid for a route to both (`:1163-1169`).
 */
export const findBuildingTarget = (
  yard: EngineYard,
  fromX: number,
  fromY: number,
  targetGroup: number,
  context: TargetContext,
): BuildingTarget => {
  const buildings = yard.buildings;
  // Indices rather than references, because the running pair is mutated from a
  // helper and a nullable reference would make every later read a narrowing
  // question TypeScript cannot answer across a call.
  let closestIndex = -1;
  let closestAway = 0;
  let secondIndex = -1;
  let secondAway = 0;

  const consider = (index: number): void => {
    const building = buildings[index] as EngineBuilding;
    // `GRID.FromISO(b._mc.x, b._mc.y + b._middle)` (`MonsterBase.as:998`). The
    // projection is linear in the isometric y, so adding `_middle` there adds
    // it to both cartesian axes: `fromIso(x, y + m) = (cx + m, cy + m)`.
    const away =
      Math.sqrt(
        distanceSquared(fromX, fromY, building.cx + building.middle, building.cy + building.middle),
      ) - building.middle;
    if (closestIndex < 0 || away < closestAway) {
      if (closestIndex >= 0) {
        secondIndex = closestIndex;
        secondAway = closestAway;
      }
      closestIndex = index;
      closestAway = away;
      return;
    }
    if (secondIndex < 0 || away < secondAway) {
      secondIndex = index;
      secondAway = away;
    }
  };

  const usableTower = (building: EngineBuilding): boolean =>
    isBunker(building.type) ? context.bunkerInUse(building) : !building.jarred;

  for (let index = 0; index < buildings.length; index += 1) {
    const building = buildings[index] as EngineBuilding;
    if (building.hp <= 0) continue;
    if (targetGroup === TARGET_GROUP.WALLS) {
      if (building.kind === "wall") consider(index);
    } else if (targetGroup === TARGET_GROUP.RESOURCES) {
      if (isMainTarget(building.kind) && isLootableTarget(building)) consider(index);
    } else if (targetGroup === TARGET_GROUP.TOWERS) {
      if (building.kind === "tower" && usableTower(building)) consider(index);
    } else if (targetGroup === TARGET_GROUP.CHAMPIONS) {
      if (isBunker(building.type) && context.bunkerInUse(building)) consider(index);
    }
  }

  // `if (!closestBuilding || targetGroup == 1)`: the group found nothing, or the
  // creep never had a preference (`MonsterBase.as:1072-1085`).
  const fellThrough = closestIndex < 0;
  if (fellThrough || targetGroup === TARGET_GROUP.ALL) {
    for (let index = 0; index < buildings.length; index += 1) {
      const building = buildings[index] as EngineBuilding;
      if (building.hp <= 0 || !isMainTarget(building.kind)) continue;
      if (building.kind === "tower" && !isBunker(building.type) && building.jarred) continue;
      consider(index);
    }
  }

  return {
    closest: closestIndex < 0 ? null : (buildings[closestIndex] as EngineBuilding),
    second: secondIndex < 0 ? null : (buildings[secondIndex] as EngineBuilding),
    fellThrough,
  };
};
