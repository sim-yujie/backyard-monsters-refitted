import { costOf, fortifyStepsOf, OUTPOST_CORE_TYPE, type CostStep } from "../../../game-data/buildingCosts.js";
import { STARTER_KITS, type KitBuilding } from "../../../game-data/starterKits.js";
import { BaseType } from "../../../enums/Base.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";
import { inferStarterKit } from "../../yard/inferStarterKit.js";
import { isPoolView } from "../../yard/poolView.js";
import { pointsForBuild, pointsForUpgrade } from "../../yardplanner/costs.js";
import { countsOnBoard } from "./outpostPoints.js";

/**
 * An outpost's `mainpointsearned` (patch 8.1, owner's fix C, 20 Nov 2026:
 * "Outposts should be counted once").
 *
 * Every yard rule acts on an outpost through `poolView`, so the points a
 * finished build, upgrade or fortification pays land on the owner's main row
 * (`save.points`), and the empire board also counts the same level in the
 * outpost's own points (`outpostPoints.ts`). The outpost row therefore keeps
 * the main points it paid for the steps the board counts, and the board takes
 * them off that outpost's points, never below 0 (`netOutpostPoints`). Main
 * points, the player level, raid strength and attack ranges never change.
 *
 * Booked, at every place that adds those points to `points` on an outpost:
 * the catch-up's finished builds, upgrades and fortifications (a resource or
 * free Starter Kit's prefab finishing included), and the yard actions that
 * finish a step at once (an instant build or upgrade, a speed-up that
 * finishes, a wall or a wall upgrade). Not booked: a trap's points (traps do
 * not count on the board), resource packs, outpost income and loot, which the
 * outpost formula never counts either.
 *
 * Reset: a takeover starts the new owner's row at 0 (the old owner keeps the
 * main points; the outpost leaves their board). Buildings cannot be recycled
 * on an outpost (`recycle.ts`), so the only other way a counted level leaves
 * is a Starter Kit, see {@link earnedAfterKit}.
 */

/** The part of `points` paid for a building of `type` that an outpost books: all of it, or none for a trap. */
export const boardPointsOf = (type: number, points: number): number => (countsOnBoard(type) ? points : 0);

/** A whole, positive amount, or 0. */
const whole = (value: unknown): number => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/** What {@link bookOutpostPoints} reads and writes. */
export interface EarnedSave {
  type?: string;
  mainpointsearned?: number | string | null;
}

/**
 * Adds `points`, main points just paid for steps the board counts, to the
 * yard's `mainpointsearned` when the yard is an outpost seen through
 * `poolView` (so those points did land on the main row); a no-op on any other
 * yard, and on a bare outpost row or a copy. Through the view the column is
 * the outpost row's own.
 */
export const bookOutpostPoints = (save: EarnedSave, points: number): void => {
  if (save.type !== BaseType.OUTPOST || !isPoolView(save)) return;
  const add = whole(points);
  if (add > 0) save.mainpointsearned = whole(save.mainpointsearned) + add;
};

/**
 * `mainpointsearned` once a Starter Kit replaces an outpost's buildings.
 *
 * Every building but the core goes (the main points they paid stay in main,
 * and their levels leave the board's formula), and the core keeps its own
 * fortification (`kitBuildings`: the higher of its own and the kit's). So
 * the most the counter can still need to cover is what the old core's
 * fortification paid: the counter becomes the smaller of what it held and
 * that. It never grows, so no point counts twice; it may come out a little
 * low when that fortification came free (from an earlier kit), which only
 * makes the board count a few points the owner did pay for.
 *
 * @param earned - The counter before the kit.
 * @param before - The outpost's buildings before the kit.
 */
export const earnedAfterKit = (earned: unknown, before: BuildingDataMap | null | undefined): number => {
  const core = Object.values(before ?? {}).find((building) => Number(building?.t) === OUTPOST_CORE_TYPE);
  const steps = fortifyStepsOf(OUTPOST_CORE_TYPE, "outpost");
  const fort = whole(core?.fort);
  let paid = 0;
  for (let i = 0; i < fort && i < steps.length; i++) paid += pointsForUpgrade(steps[i]!);
  return Math.min(whole(earned), paid);
};

/** The level a stored building loads at, as `outpostPoints.ts` reads it. */
const levelOf = (type: number, building: BuildingData): number => {
  if (Number(building.t) === 18) return 2;
  const stored = type === OUTPOST_CORE_TYPE ? 1 : Math.trunc(Number(building.l));
  let level = Number.isFinite(stored) && stored !== 0 ? stored : 1;
  const prefab = Math.trunc(Number(building.prefab));
  if (Number.isFinite(prefab) && prefab !== 0) level = prefab;
  return level <= 0 ? 1 : level;
};

/** Upgrade points of `steps[from..to)`. */
const upgradePoints = (steps: readonly CostStep[], from: number, to: number): number => {
  let points = 0;
  for (let i = from; i < to && i < steps.length; i++) points += pointsForUpgrade(steps[i]!);
  return points;
};

/**
 * The one-off seed's estimate of the main points an outpost's buildings have
 * paid so far (`server/scripts/seed-outpost-mainpoints.ts`), from its stored
 * buildings alone, the same estimate as the read-only diagnosis
 * (`archive/empire-once/tally.ts`, 20 Nov 2026):
 *
 * - a building on its Starter Kit's spot (same type, same X and Y; the kit
 *   from `starterkit`, else read back from the layout) got the kit's
 *   `prefab` levels and `fort` free, and paid a level-1 build's points when
 *   it stood (a resource or free kit's prefab finishing; a Shiny kit paid
 *   none, which this cannot tell apart, so it may come out a little high);
 * - the core was placed free and its kit fortification came free;
 * - every other level, fortification and finished build was the owner's;
 * - a building still being built (`cB`) has paid nothing for its build yet;
 * - buildings the board does not count (traps, decorations) add nothing.
 *
 * Takeovers are not knowable from the row and count as the owner's work.
 */
export const estimateMainPointsEarned = (
  buildingdata: BuildingDataMap | null | undefined,
  starterkit?: number | string | null,
): number => {
  const buildings = buildingdata ?? {};
  const kitId = Number(starterkit) || inferStarterKit(buildings as Parameters<typeof inferStarterKit>[0]);
  const kit = STARTER_KITS.find((row) => row.id === kitId);
  const kitAt = new Map<string, KitBuilding>();
  for (const row of kit?.buildings ?? []) kitAt.set(`${row.t}:${row.X}:${row.Y}`, row);

  let paid = 0;
  for (const building of Object.values(buildings)) {
    if (!building || typeof building !== "object") continue;
    const stored = Math.trunc(Number(building.t));
    if (!countsOnBoard(stored)) continue;
    const type = stored === 18 ? 17 : stored;
    const props = costOf(type, "outpost");
    if (!props) continue;
    const costs = props.costs;
    const forts = fortifyStepsOf(type, "outpost");
    const level = levelOf(type, building);
    const fort = whole(building.fort);
    const kitRow = kitAt.get(`${type}:${Number(building.X)}:${Number(building.Y)}`);
    const kitFort = kitRow?.fort ?? 0;

    if (type === OUTPOST_CORE_TYPE) {
      paid += upgradePoints(forts, kitFort, fort);
      continue;
    }
    const standing = !(Number(building.cB) > 0);
    if (standing && costs[0]) paid += pointsForBuild(costs[0]);
    paid += upgradePoints(costs, kitRow ? Math.max(1, kitRow.prefab ?? 1) : 1, level);
    paid += upgradePoints(forts, kitRow ? kitFort : 0, fort);
  }
  return paid;
};
