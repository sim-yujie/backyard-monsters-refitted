import { costOf, TRAP_TYPES } from "../../game-data/buildingCosts.js";
import type { BuildingDataMap, FiredTrap } from "../../types/BuildingData.js";
import { countOfType, townHallLevel, yardKindOf } from "./costs.js";
import { overlaps, rectOf, type FootprintRect } from "./layoutGeometry.js";

/** The parts of a save {@link liveFiredTraps} reads. */
export interface FiredTrapsSave {
  type?: string | null;
  buildingdata?: BuildingDataMap | null;
  firedtraps?: FiredTrap[] | null;
}

/**
 * The fired traps that can still be put back, oldest first as stored.
 *
 * `save.firedtraps` only ever grows from the attack save; the re-arm route is
 * the one thing that strikes entries off. A player who builds the traps again
 * by hand from the build menu (or moves something onto the spot) leaves every
 * entry behind, so the planner kept offering traps the yard already has
 * (player report 2026-11-12: 24 traps, rebuilt by hand, re-arm then showed 41
 * and refused every one as "something is standing there"). This drops what
 * no longer answers to a missing trap, newest entries winning:
 *
 * - anything that is not a Booby or Heavy Trap at a usable position;
 * - an entry whose spot a building now covers (the rebuilt trap, or anything
 *   else the player put there): that trap is back, or its spot is taken;
 * - an older entry under a newer one (the same trap fired twice, or a trap of
 *   the other type that went in its place and fired too);
 * - entries past the room the Town Hall leaves for that type: a yard at its
 *   cap has nothing to put back, whatever the list says.
 *
 * Pure: hands back a new list and changes nothing.
 */
export const liveFiredTraps = (save: FiredTrapsSave): FiredTrap[] => {
  const fired = Array.isArray(save.firedtraps) ? save.firedtraps : [];
  if (fired.length === 0) return [];

  const kind = yardKindOf(save);
  const buildings = save.buildingdata ?? {};
  const hall = townHallLevel(buildings, kind);

  const standing: FootprintRect[] = [];
  for (const building of Object.values(buildings)) {
    const x = Number(building?.X);
    const y = Number(building?.Y);
    const type = Number(building?.t);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(type)) {
      standing.push(rectOf(type, x, y, kind));
    }
  }

  // Room left per type. A yard with no hall is left uncapped: nothing can be
  // built there anyway, and that is not this list's argument to have.
  const room = new Map<number, number>();
  if (hall > 0) {
    for (const type of TRAP_TYPES) {
      // The last entry stands in for any hall past the end (`BASE.as:3717`);
      // a type with no table at all is left uncapped rather than emptied.
      const quantity = costOf(type, kind)?.quantity ?? [];
      if (quantity.length === 0) continue;
      const max = quantity[Math.min(hall, quantity.length - 1)] ?? 0;
      room.set(type, Math.max(0, max - countOfType(buildings, type)));
    }
  }

  const kept: { entry: FiredTrap; rect: FootprintRect; index: number }[] = [];
  for (let index = fired.length - 1; index >= 0; index--) {
    const entry = fired[index];
    const type = Number(entry?.t);
    const x = Number(entry?.X);
    const y = Number(entry?.Y);
    if (!TRAP_TYPES.includes(type) || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    const left = room.get(type);
    if (left !== undefined && left <= 0) continue;

    const rect = rectOf(type, x, y, kind);
    if (standing.some((other) => overlaps(rect, other))) continue;
    if (kept.some((other) => overlaps(rect, other.rect))) continue;

    kept.push({ entry: entry!, rect, index });
    if (left !== undefined) room.set(type, left - 1);
  }

  return kept.sort((a, b) => a.index - b.index).map(({ entry }) => entry);
};

/**
 * Writes {@link liveFiredTraps} back onto the save, and only when it drops
 * something: an untouched list (or a column never written) stays exactly as
 * it was, so a yard action that changes nothing here changes nothing here.
 */
export const pruneFiredTraps = (save: FiredTrapsSave): void => {
  const current = Array.isArray(save.firedtraps) ? save.firedtraps : [];
  const live = liveFiredTraps(save);
  if (live.length !== current.length) save.firedtraps = live;
};
