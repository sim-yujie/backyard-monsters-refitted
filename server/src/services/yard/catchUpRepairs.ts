import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { damageOf, healed, type RepairSave } from "./repair.js";

/**
 * Catch-up step 3: repairs heal (`docs/design/yard-buildings.md` §2.3, §5.5).
 *
 * Every building with `rE` set heals `rate` health a second from `from`
 * (`client/scripts/BFOUNDATION.as:1367-1370`, `repair.ts`). One that reaches
 * full health inside the window is repaired at that moment: `hp`, `rE` and its
 * `buildinghealthdata` entry go (`Repaired()`, `:2024-2032`), and a job is
 * reported. One still short of full has its health raised to where it stands
 * at `now`, in both places. A repair flag on a building already at full health
 * is simply cleared, as the original's next tick did.
 *
 * **Runs before the buildings step.** A damaged or repairing building's build,
 * upgrade or fortify countdown is paused (`:1364-1394`); once repaired it runs
 * again, from the moment the repair finished. Step 1 advances every running
 * countdown by the whole window, so this step adds the paused part — the
 * seconds from `from` to the repair's end — to the countdown step 1 will
 * advance (the first of `cU`, `cB`, `cF`, the order `advanceBuildingTimers`
 * reads them in). Step 1 then takes it forward by exactly the time since the
 * repair, and its completion time, points and job record come out as the
 * original's would. Nothing else in the repair depends on step 1: a repairing
 * building's level cannot change during the window.
 *
 * The later steps read the health this step leaves: a hatchery or Housing
 * building repaired in the window counts as whole from the start of it
 * (at most an hour early, the longest any repair takes). The harvester step
 * splits its window at the repair's end instead, producing at the health the
 * building had before it (`catchUpHarvesters.ts`).
 *
 * Elapsed time is clamped to 30 days like the rest of the catch-up. Pure apart
 * from mutating the save it is handed; idempotent at the same `now`.
 */

/** A repair the catch-up finished. */
export interface RepairJob {
  kind: "repair";
  /** Building id. */
  id: number;
  /** Building type. */
  t: number;
  /** Unix seconds at which it reached full health. */
  at: number;
  detail: {
    /** Health at the start of the window (before this catch-up healed it). */
    from: number;
    /** Full health. */
    max: number;
  };
}

/** The longest replay, as `advanceBuildingTimers` clamps it. */
const MAX_ELAPSED_SECONDS = 60 * 60 * 24 * 30;

/** The countdown `advanceBuildingTimers` would advance on this building, if any. */
const runningCountdown = (building: BuildingData): "cU" | "cB" | "cF" | null => {
  if (building.cU) return "cU";
  if (building.cB) return "cB";
  if (building.cF) return "cF";
  return null;
};

/**
 * Heals every repairing building from `from` to `now` and returns the repairs
 * that finished, oldest first.
 *
 * @param save - The yard, mutated in place: `buildingdata` and
 *   `buildinghealthdata` are replaced when a repair moved.
 * @param from - The moment the stored health is measured from (`savetime`).
 * @param now - The moment to advance to.
 */
export const catchUpRepairs = (save: RepairSave, from: number, now: number): RepairJob[] => {
  const buildings = save.buildingdata;
  if (!buildings) return [];

  const elapsed = Math.min(Math.max(Math.floor(now - from), 0), MAX_ELAPSED_SECONDS);
  const jobs: RepairJob[] = [];
  let out: BuildingDataMap | null = null;
  let health: BuildingHealthData | null = null;

  for (const [key, building] of Object.entries(buildings)) {
    if (!building?.rE) continue;
    out ??= { ...buildings };
    health ??= { ...(save.buildinghealthdata ?? {}) };

    const damage = damageOf(save, key, building);
    const id = Number(building.id ?? key);

    if (!damage) {
      // Repairing at full health: the flag goes and nothing else changes.
      out[key] = healed(building);
      delete health[String(id)];
      continue;
    }

    const needed = Math.ceil((damage.max - damage.health) / damage.rate);
    if (needed > elapsed) {
      const reached = damage.health + damage.rate * elapsed;
      out[key] = { ...building, hp: reached };
      health[String(id)] = reached;
      continue;
    }

    const repaired = healed(building);
    const countdown = runningCountdown(repaired);
    if (countdown) repaired[countdown] = Number(repaired[countdown]) + needed;
    out[key] = repaired;
    delete health[String(id)];
    jobs.push({
      kind: "repair",
      id,
      t: damage.type,
      at: from + needed,
      detail: { from: damage.health, max: damage.max },
    });
  }

  if (out) save.buildingdata = out;
  if (health) save.buildinghealthdata = health;
  return jobs.sort((a, b) => a.at - b.at);
};
