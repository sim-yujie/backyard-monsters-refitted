import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  canProduce,
  harvesterRates,
  isHarvester,
} from "../base/economy/production.js";
import {
  RESOURCE_KEYS,
  noAmounts,
  storageCap,
  type ResourceKey,
  type StorageCapSave,
} from "../base/economy/resourceBudget.js";
import { levelOf, type ResourceAmounts } from "../yardplanner/costs.js";
import { bufferOf, counting, harvesterHealth, withBuffer } from "./catchUpHarvesters.js";
import { yardBadRequestErr } from "./yardErrors.js";

/**
 * `POST /bm/yard/bank`: moving what harvesters hold into the resource pool
 * (`docs/design/yard-buildings.md` §5.1, decision D12).
 *
 * Tapping a harvester banks that one; the HUD's **Collect all** banks every
 * eligible harvester in one request. The catch-up has already filled every
 * buffer up to `now`, so the buffers read here are current.
 *
 * Per harvester, in id order, as the original's `Bank()`
 * (`client/scripts/BRESOURCE.as:441-467`):
 *
 * - it offers `min(st, capacity)` of its resource;
 * - what fits under the storage cap moves into the pool. What does not fit
 *   **stays in the buffer** (owner decision, §10 Q3): the original lost it
 *   (`BASE.Fund`, `client/scripts/BASE.as:4494-4536`), and since a full buffer
 *   stops production nothing is gained by losing it;
 * - points: the amount banked, halved (rounded up) from tutorial stage 200 on
 *   (`BRESOURCE.as:449-454`);
 * - a buffer left below its capacity that was not producing starts a fresh
 *   cycle now, as the original's next tick did (`StartProduction`, `:363-372`).
 *
 * Which harvesters: **all** takes every harvester that is built, has no build,
 * upgrade or fortify running, is at full health and holds something — the
 * original's Bank all (`client/scripts/BUILDINGINFO.as:458-466`). **ids**
 * names harvesters one by one; each must be a harvester in the yard (else 400),
 * and one that cannot bank right now (a countdown running, nothing held) is
 * skipped and named in the report rather than refusing the rest, the way the
 * batch routes answer (§2.1). The original offered no Bank button while a
 * countdown ran (`BUILDINGINFO.as:129-141` sits after the countdown branches);
 * a damaged harvester could still be banked by hand.
 */

/** The slice of a save banking reads. */
export interface BankSave extends StorageCapSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
}

/** What the route was asked to bank. */
export type BankRequest = { all: true } | { ids: readonly number[] };

/** Why a named harvester banked nothing. */
export type BankSkip = "busy" | "empty";

/** `report` of `POST /bm/yard/bank`. */
export interface BankReport {
  /** Credited to the pool, per resource. */
  banked: ResourceAmounts;
  /** Per harvester that banked something: its resource and the amount. */
  byBuilding: Record<string, { resource: ResourceKey; amount: number }>;
  /** What stayed in the banked harvesters' buffers because the pool was full, per resource. */
  leftInBuffers: ResourceAmounts;
  /** Named harvesters that banked nothing, and why. `all` never lists any. */
  skipped: { id: number; reason: BankSkip }[];
  /** Empire points awarded. */
  points: number;
}

/** From this tutorial stage on, banking pays half its amount in points (`BRESOURCE.as:449-454`). */
export const HALF_POINTS_STAGE = 200;

/** One resource as the save holds it; anything unreadable is zero, as the wrapper reads it. */
const heldOf = (save: BankSave, key: ResourceKey): number => {
  const value = Number(save.resources?.[key]);
  return Number.isFinite(value) ? value : 0;
};

/** Points for one harvester's bank. */
export const bankPoints = (amount: number, tutorialStage: number): number =>
  tutorialStage < HALF_POINTS_STAGE ? amount : Math.ceil(amount * 0.5);

/** Every harvester in the yard as `[key, building, id]`, in id order. */
const harvestersOf = (save: BankSave): [string, BuildingData, number][] =>
  Object.entries(save.buildingdata ?? {})
    .filter(([, building]) => building && isHarvester(Number(building.t)))
    .map(([key, building]): [string, BuildingData, number] => [key, building, Number(building.id ?? key)])
    .sort((a, b) => a[2] - b[2]);

/** Full health: no reading, or one at or above the level's maximum. */
const atFullHealth = (save: BankSave, key: string, building: BuildingData): boolean => {
  const health = harvesterHealth(save, key, building);
  if (health === undefined) return true;
  const max = maxHp(Number(building.t), levelOf(building));
  return max > 0 && health >= max;
};

/** A harvester that can bank at all right now: built and with no countdown running. */
const canBank = (building: BuildingData): boolean => levelOf(building) > 0 && !counting(building);

/** What a harvester offers: `min(st, capacity)` (`BRESOURCE.as:443-446`). */
const offerOf = (building: BuildingData): number => {
  const rates = harvesterRates(Number(building.t), levelOf(building));
  if (!rates) return 0;
  return Math.floor(Math.min(bufferOf(building).stored, rates.capacity));
};

/**
 * Picks the harvesters to bank.
 *
 * @throws 400 `badRequest` when a named id is not a harvester in the yard.
 */
const choose = (
  save: BankSave,
  request: BankRequest
): { chosen: [string, BuildingData, number][]; skipped: BankReport["skipped"] } => {
  const harvesters = harvestersOf(save);

  if ("all" in request) {
    return {
      chosen: harvesters.filter(
        ([key, building]) =>
          canBank(building) && atFullHealth(save, key, building) && offerOf(building) > 0
      ),
      skipped: [],
    };
  }

  const byId = new Map(harvesters.map((entry) => [entry[2], entry]));
  const chosen: [string, BuildingData, number][] = [];
  const skipped: BankReport["skipped"] = [];
  for (const id of new Set(request.ids)) {
    const entry = byId.get(id);
    if (!entry) throw yardBadRequestErr("That is not a harvester in your yard.", { id });
    if (!canBank(entry[1])) skipped.push({ id, reason: "busy" });
    else if (offerOf(entry[1]) <= 0) skipped.push({ id, reason: "empty" });
    else chosen.push(entry);
  }
  chosen.sort((a, b) => a[2] - b[2]);
  return { chosen, skipped };
};

/**
 * Banks the chosen harvesters.
 *
 * @param save - The caught-up main yard (read only).
 * @param request - `{ all: true }` or `{ ids }`.
 * @param tutorialStage - The player's tutorial stage as the game treats it
 *   (the load's own override applies), for the points rule.
 * @returns The new `buildingdata`, the credit (already fitted under the cap,
 *   so the wrapper's clamp changes nothing), the points and the report.
 */
export const planBank = (save: BankSave, request: BankRequest, tutorialStage: number) => {
  const { chosen, skipped } = choose(save, request);

  const cap = storageCap(save);
  const room = noAmounts();
  for (const key of RESOURCE_KEYS) room[key] = Math.max(0, cap - heldOf(save, key));

  const banked = noAmounts();
  const leftInBuffers = noAmounts();
  const byBuilding: BankReport["byBuilding"] = {};
  const buildings: BuildingDataMap = { ...(save.buildingdata ?? {}) };
  let points = 0;
  let changed = false;

  for (const [key, building, id] of chosen) {
    const type = Number(building.t);
    const resource = `r${type}` as ResourceKey;
    const offer = offerOf(building);
    const amount = Math.min(offer, room[resource]);
    const buffer = bufferOf(building);
    const kept = buffer.stored - amount;

    room[resource] -= amount;
    banked[resource] += amount;
    leftInBuffers[resource] += kept;
    if (amount <= 0) continue;

    byBuilding[String(id)] = { resource, amount };
    points += bankPoints(amount, tutorialStage);

    const level = levelOf(building);
    const health = harvesterHealth(save, key, building);
    const max = maxHp(type, level) || undefined;
    const rates = harvesterRates(type, level, health, max);
    const restart =
      buffer.countdown === null && rates !== null && kept < rates.capacity && canProduce(health, max);
    buildings[key] = withBuffer(building, {
      stored: kept,
      countdown: restart ? rates!.cycle : buffer.countdown,
    });
    changed = true;
  }

  const report: BankReport = { banked, byBuilding, leftInBuffers, skipped, points };
  return {
    report,
    ...(changed && { slices: { buildingdata: buildings } }),
    credit: banked,
    points,
  };
};
