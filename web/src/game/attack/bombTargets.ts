import type { BaseLoadResponse } from "@/api/types";
import {
  bombParticleDamage,
  bombReaches,
  buildEngineYard,
  fortifiedDamage,
  propsSizeOf,
  screenOf,
  type BombStats,
  type BuildingClass,
  type EngineBuilding,
} from "@/game/combat/rules";
import type { Point } from "@/game/yard/YardGrid";

/**
 * Which buildings a resource bomb will hit, asked before it lands (issues
 * #87, #88).
 *
 * The engine decides what a bomb reached once, on the tick it lands
 * (`engine.ts` `bomb`), and keeps its yard to itself. The attack screen needs
 * the same answer earlier — to light up the buildings an armed bomb would hit
 * while the pointer moves (#88) — and again afterwards, to hold each hit
 * building's damage until the particles rain down on it (#87). So this reads
 * the yard the engine was built from, through the rules' own
 * `buildEngineYard`, and asks the rules' own `bombReaches` about each building
 * exactly as the engine does: the drop and the building's middle through
 * `screenOf`, the props size, the same skipped classes, and nothing hit that
 * would take no damage. Nothing here decides anything the engine does not; a
 * test replays bombs through a real battle and compares.
 */

/** The classes `ResourceBomb` passes over (`engine.ts` `bomb`). */
const SPARED: ReadonlySet<BuildingClass> = new Set<BuildingClass>([
  "trap",
  "decoration",
  "enemy",
  "immovable",
]);

/** A building a bomb could reach, as the engine's hit test reads it. */
export type BombCandidate = Pick<
  EngineBuilding,
  "id" | "type" | "level" | "kind" | "sx" | "sy" | "middle" | "fortification" | "hp" | "maxHp"
>;

/**
 * The buildings of an attack load a bomb could ever hit: the engine's own
 * yard, less the classes it skips. `hp` is the health each opened with.
 */
export const bombCandidatesOf = (load: BaseLoadResponse | null): BombCandidate[] => {
  if (!load) return [];
  const yard = buildEngineYard({
    buildingdata: load.buildingdata ?? {},
    buildinghealthdata: load.buildinghealthdata ?? null,
    // An outpost's buildings have the outpost table's health.
    ...(load.type === "outpost" ? { kind: "outpost" as const } : {}),
  });
  return yard.buildings.filter((building) => !SPARED.has(building.kind));
};

/** One building a bomb hits, and the health it takes off before any cap. */
export interface BombHit {
  readonly id: number;
  /** Every particle's share together, after fortification (`damageBuilding`). */
  readonly damage: number;
  /** Its full health: what the battle's health map means by leaving it out. */
  readonly maxHp: number;
}

/**
 * Every building a damage bomb landing at `point` (yard units) hits, in id
 * order. `destroyed` is the battle's `destroyedIds`: a building flattened
 * since the attack opened is passed over, as one that opened flat is.
 * A putty bomb hits no building.
 */
export const bombHits = (
  bomb: BombStats,
  point: Point,
  candidates: readonly BombCandidate[],
  destroyed: Iterable<number> = [],
): BombHit[] => {
  if (bomb.damage <= 0) return [];
  const down = new Set(destroyed);
  const centre = screenOf(point.x, point.y);
  const hits: BombHit[] = [];
  for (const building of candidates) {
    if (building.hp <= 0 || down.has(building.id)) continue;
    const dx = building.sx - centre.x;
    const dy = building.sy + building.middle - centre.y;
    if (!bombReaches(bomb, dx, dy, propsSizeOf(building.type))) continue;
    const share = bombParticleDamage(bomb, building);
    if (share <= 0) continue;
    hits.push({
      id: building.id,
      damage: fortifiedDamage(share * bomb.particles, building.fortification, 0),
      maxHp: building.maxHp,
    });
  }
  return hits;
};
