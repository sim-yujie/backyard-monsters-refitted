import {
  costOf,
  productionOf,
  siloCapacity,
  type CostStep,
} from "../../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import {
  levelOf,
  sumCosts,
  upgradeSteps,
  type ResourceAmounts,
} from "../../yardplanner/costs.js";

/**
 * The arithmetic behind the economy audit's resource rules: what a yard can
 * have produced, what a removed building hands back, what a pool can hold, what
 * a yard is worth, and what a shiny shortcut costs
 * (`docs/design/economy-save-validation.md` §2.6, §2.7, §2.9, §2.4).
 *
 * Every function here is pure and reads only the generated cost table and a
 * slice of a save, so the audit can be tested without a database, the same
 * bargain `services/yardplanner/costs.ts` makes.
 *
 * The numbers are upper bounds, not simulations. The server does not model the
 * player's clicking, so each allowance answers "could this much have appeared
 * honestly?" and leaves the rest to the rule that reads it.
 */

/** The four resource keys, in wire order. */
export const RESOURCE_KEYS = ["r1", "r2", "r3", "r4"] as const;

/** One of `r1`..`r4`. */
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

/** Zero of each resource. */
export const noAmounts = (): ResourceAmounts => ({ r1: 0, r2: 0, r3: 0, r4: 0 });

/** Adds `add` into `total` in place, for accumulating over a yard. */
export const addAmounts = (total: ResourceAmounts, add: Readonly<ResourceAmounts>): void => {
  total.r1 += add.r1;
  total.r2 += add.r2;
  total.r3 += add.r3;
  total.r4 += add.r4;
};

/** The four resource amounts of one cost step, without its time. */
export const stepAmounts = (step: CostStep): ResourceAmounts => ({
  r1: step[0],
  r2: step[1],
  r3: step[2],
  r4: step[3],
});

/** Anything that is not a finite number reads as zero. */
const numberOf = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

/** The Wooden Block. */
export const WALL_TYPE = 17;

/**
 * The Stone Block: a legacy row the Flash client rewrites to `t: 17, l: 2` on
 * load (`client/scripts/BASE.as:1523-1526`), so it is priced on type 17's
 * ladder and never on its own single step.
 */
export const LEGACY_WALL_TYPE = 18;

/** The Storage Silo, the only type that adds to the resource caps. */
export const SILO_TYPE = 6;

/** Twig Snapper, Pebble Shiner, Putty Squisher, Goo Factory: type id = resource index. */
export const HARVESTER_TYPES = [1, 2, 3, 4] as const;

/** The type whose cost ladder prices this one. */
export const pricingType = (type: number): number =>
  type === LEGACY_WALL_TYPE ? WALL_TYPE : type;

/**
 * A building's level for pricing: a legacy Stone Block counts as at least level
 * 2, which is what the Flash conversion makes it, so recycling one refunds two
 * steps of the Block ladder and not one (`services/yardplanner/wallUpgrade.ts:87-90`).
 */
export const pricingLevel = (building: BuildingData): number => {
  const level = levelOf(building);
  if (level <= 0) return 0;
  return Number(building.t) === LEGACY_WALL_TYPE ? Math.max(level, 2) : level;
};

/* -------------------------------------------------------------------------- */
/* Shiny prices                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The shiny price of skipping `seconds` of countdown.
 *
 * `STORE.GetTimeCost` (`client/scripts/STORE.as:162-171`, duplicated verbatim
 * in `BFOUNDATION.FinishNowCost`): free under five minutes, then the lower of a
 * linear term of 20 shiny an hour and a square-root term that caps the growth.
 */
export const timeCost = (seconds: number): number => {
  const time = Math.trunc(numberOf(seconds));
  if (time <= 300) return 0;
  return Math.min(Math.ceil((time * 20) / 60 / 60), Math.trunc(Math.sqrt(time * 0.8)));
};

/**
 * The shiny price of buying a pile of resources outright.
 *
 * `STORE.GetShinyCostFromTotalResources` (`:183-185`), the curve behind both
 * the instant-build resource term and the `BRTOPUP` shortfall price.
 */
export const shinyCostOfResources = (total: number): number =>
  Math.ceil(Math.pow(Math.sqrt(Math.max(0, numberOf(total)) / 2), 0.75));

/**
 * The shiny price of finishing a whole step on the spot: `IB` over `costs[0]`
 * and `IU` over `costs[from]`.
 *
 * `BFOUNDATION.InstantBuildCost` (`:2085-2096`) and `InstantUpgradeCost`
 * (`:2114-2128`). `r4` is deliberately not counted; the omission is in the
 * client's three copies of this function and copying it is the point.
 */
export const instantCost = (step: CostStep | undefined): number => {
  if (!step) return 0;
  const [r1, r2, r3, , time] = step;
  const resources = shinyCostOfResources(r1 + r2 + r3);
  return Math.trunc((resources + timeCost(time)) * 0.95);
};

/**
 * The shiny price of a `BRTOPUP`: the shortfall, summed over all four
 * resources, run through the same curve
 * (`client/scripts/BUILDINGOPTIONSPOPUP.as:650-690`, which sums `r1`..`r4` and
 * funds exactly the difference before starting the job).
 */
export const topupCost = (shortfall: Readonly<ResourceAmounts>): number =>
  shinyCostOfResources(shortfall.r1 + shortfall.r2 + shortfall.r3 + shortfall.r4);

/* -------------------------------------------------------------------------- */
/* Production                                                                  */
/* -------------------------------------------------------------------------- */

/** A production ladder entry at a level, clamped to the ends of the array. */
const atLevel = (ladder: readonly number[] | undefined, level: number): number => {
  if (!ladder || ladder.length === 0) return 0;
  const index = Math.min(Math.max(Math.trunc(level), 1), ladder.length) - 1;
  return numberOf(ladder[index]);
};

/**
 * The most a harvester's buffer could hold now.
 *
 * `min(capacity, stored + (floor(elapsed / cycle) + 1) * produce)`: the buffer
 * it was saved with, plus every whole cycle since and one more for the cycle
 * that was already part-way through, capped at the level's buffer
 * (`client/scripts/BRESOURCE.as:384-386`, `:424-439`, `:497`).
 *
 * A harvester is halted while a countdown runs and stops below half health
 * (`:301-302`), both of which only ever make it produce less, so ignoring them
 * keeps this an upper bound.
 */
export const bufferCeiling = (
  type: number,
  level: number,
  storedBuffer: number,
  elapsed: number
): number => {
  const production = productionOf(type);
  if (!production) return 0;

  const cycle = Math.max(1, atLevel(production.cycleTime, level));
  const produce = atLevel(production.produce, level);
  const capacity = atLevel(production.capacity, level);
  const cycles = Math.floor(Math.max(0, elapsed) / cycle) + 1;

  return Math.min(capacity, Math.max(0, storedBuffer) + cycles * produce);
};

/** One harvester whose submitted buffer is above what it could have produced. */
export interface OverfullHarvester {
  id: number;
  sent: number;
  max: number;
}

/** What the yard's own harvesters could have added to the pool since the last save. */
export interface HarvestReport {
  allowance: ResourceAmounts;
  overfull: OverfullHarvester[];
}

/** A harvester's saved buffer, `st` (`client/scripts/BRESOURCE.as:481-493`). */
const bufferOf = (building: BuildingData | undefined): number =>
  building ? Math.max(0, numberOf(building.st)) : 0;

/**
 * How much of each resource the yard's harvesters could have banked since the
 * stored save (`docs/design/economy-save-validation.md` §2.6).
 *
 * Per harvester: its buffer could have climbed to {@link bufferCeiling}, and
 * whatever is not still sitting in the submitted buffer must have been banked.
 * A harvester that is gone from the submitted yard counts as having banked its
 * whole ceiling, because recycling one does not destroy what it held.
 *
 * The level used is `max(level in S, level in T)`, the most generous reading,
 * so an upgrade that landed this save cannot turn an honest bank into a
 * violation.
 */
export const harvestAllowance = (
  stored: BuildingDataMap | null | undefined,
  submitted: BuildingDataMap | null | undefined,
  elapsed: number
): HarvestReport => {
  const allowance = noAmounts();
  const overfull: OverfullHarvester[] = [];
  const submittedYard = submitted ?? {};

  for (const [key, before] of Object.entries(stored ?? {})) {
    const type = Number(before.t);
    if (!(HARVESTER_TYPES as readonly number[]).includes(type)) continue;

    const after = submittedYard[key];
    const level = Math.max(levelOf(before), after ? levelOf(after) : 0, 1);
    const ceiling = bufferCeiling(type, level, bufferOf(before), elapsed);
    const remaining = after ? bufferOf(after) : 0;

    if (after && remaining > ceiling) {
      overfull.push({ id: Number(after.id ?? before.id ?? key), sent: remaining, max: ceiling });
    }

    const banked = Math.max(0, ceiling - remaining);
    const resource = `r${type}` as ResourceKey;
    allowance[resource] += banked;
  }

  return { allowance, overfull };
};

/* -------------------------------------------------------------------------- */
/* Outpost income                                                              */
/* -------------------------------------------------------------------------- */

/** The client credits at most two days of offline outpost income (`AutoBankManager.as:79-82`). */
export const OUTPOST_INCOME_WINDOW = 60 * 60 * 24 * 2;

/** `buildingresources` keys are `b<baseid>`; `t` is the last auto-bank timestamp. */
const OUTPOST_KEY = /^b\d+$/;

/**
 * How much of each resource the player's outposts could have auto-banked.
 *
 * `AutoBankManager.autobank` funds `gip.rN * overdrive * seconds / 10`
 * (`:266-268`), where `gip` is the per-outpost figure in `buildingresources`
 * and `overdrive` is 1 or the Production Overdrive power. The figure is
 * client-written, so the bound is taken over the **stored** copy and multiplied
 * by `overdriveMax` (§6, item 2): a save cannot raise its own allowance.
 */
export const outpostAllowance = (
  buildingresources: JsonObject | null | undefined,
  elapsed: number,
  overdriveMax: number
): ResourceAmounts => {
  const total = noAmounts();
  if (!buildingresources) return total;

  const seconds = Math.min(Math.max(0, elapsed), OUTPOST_INCOME_WINDOW);
  if (seconds === 0) return total;

  for (const [key, entry] of Object.entries(buildingresources)) {
    if (!OUTPOST_KEY.test(key)) continue;
    if (!entry || typeof entry !== "object") continue;

    const income = entry as Record<string, unknown>;
    for (const resource of RESOURCE_KEYS) {
      const perTick = Math.max(0, numberOf(income[resource]));
      total[resource] += (perTick * seconds * overdriveMax) / 10;
    }
  }

  for (const resource of RESOURCE_KEYS) total[resource] = Math.floor(total[resource]);
  return total;
};

/* -------------------------------------------------------------------------- */
/* Refunds                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What removing a building hands back
 * (`docs/design/economy-save-validation.md` §2.2).
 *
 * An unfinished building is level 0 and refunds all of `costs[0]`; a finished
 * one refunds half of every step paid so far, floored per resource; a
 * decoration refunds nothing because it returns to `researchdata` instead
 * (`client/scripts/BFOUNDATION.as:2526-2530`, `:2639-2664`).
 *
 * Recycling is the player's right and never a violation, so this only ever
 * feeds the delta budget.
 */
export const refundOf = (building: BuildingData): ResourceAmounts => {
  const type = pricingType(Number(building.t));
  const row = costOf(type);
  if (!row) return noAmounts();
  if (row.kind === "decoration") return noAmounts();

  const level = pricingLevel(building);

  if (level <= 0) {
    const first = row.costs[0];
    return first ? stepAmounts(first) : noAmounts();
  }

  const paid = sumCosts(upgradeSteps(type, 0, level));
  return {
    r1: Math.floor(paid.r1 * 0.5),
    r2: Math.floor(paid.r2 * 0.5),
    r3: Math.floor(paid.r3 * 0.5),
    r4: Math.floor(paid.r4 * 0.5),
  };
};

/**
 * What cancelling an in-flight upgrade hands back: the whole step, because the
 * client charges on start and refunds in full on cancel
 * (`client/scripts/BFOUNDATION.as:2401-2432`).
 */
export const cancelRefund = (type: number, from: number): ResourceAmounts => {
  const step = costOf(pricingType(type))?.costs[from];
  return step ? stepAmounts(step) : noAmounts();
};

/* -------------------------------------------------------------------------- */
/* Storage caps and base value                                                 */
/* -------------------------------------------------------------------------- */

/** The pool every yard starts with, before silos (`client/scripts/BASE.as:4720-4723`). */
export const BASE_STORAGE = 10000;

/** Each owned outpost adds this much to every cap (`client/scripts/GLOBAL.as:806`). */
export const OUTPOST_STORAGE = 2000000;

/** The parts of a `Save` the storage cap is derived from. */
export interface StorageCapSave {
  buildingdata?: BuildingDataMap | null;
  storedata?: JsonObject | null;
  outposts?: readonly unknown[] | null;
}

/**
 * The packing multiplier from Improved Packing Skills, clamped to two decimals
 * exactly as the client clamps it (`client/scripts/STORE.as:2520-2524`).
 */
export const packingMultiplier = (storedata: JsonObject | null | undefined): number => {
  const bought = Math.max(0, numberOf(storedata?.BIP?.q));
  return Math.trunc((1 + 0.1 * bought) * 100) / 100;
};

/**
 * The derived cap for every resource
 * (`client/scripts/BASE.as:4705-4828`; spec `docs/specs/base-building.md:655-679`).
 *
 * A silo still counting its build down is level 0 and adds nothing, which
 * {@link levelOf} already says.
 */
export const storageCap = (save: StorageCapSave): number => {
  let capacity = BASE_STORAGE;

  for (const building of Object.values(save.buildingdata ?? {})) {
    if (Number(building.t) !== SILO_TYPE) continue;
    const level = levelOf(building);
    if (level <= 0) continue;
    capacity += siloCapacity(level);
  }

  const packed = Math.floor(capacity * packingMultiplier(save.storedata));
  const outposts = Array.isArray(save.outposts) ? save.outposts.length : 0;

  return packed + outposts * OUTPOST_STORAGE;
};

/**
 * The kinds that do not count towards base value
 * (`client/scripts/BASE.as:4830-4859`).
 */
const BASE_VALUE_EXCLUDED = new Set(["decoration", "enemy", "immovable", "trap"]);

/**
 * The yard's base value: a tenth of the time and resources of the last step
 * every finished building completed, rounded up
 * (`client/scripts/BASE.as:4830-4859`).
 *
 * `basevalue` drives the empire level alongside `points`
 * (`services/base/calculateBaseLevel.ts:11-20`), which is why the server
 * derives it rather than storing whatever arrives.
 */
export const baseValueOf = (buildingdata: BuildingDataMap | null | undefined): number => {
  let total = 0;

  for (const building of Object.values(buildingdata ?? {})) {
    const type = pricingType(Number(building.t));
    const row = costOf(type);
    if (!row || BASE_VALUE_EXCLUDED.has(row.kind)) continue;

    const level = pricingLevel(building);
    if (level <= 0) continue;

    const step = row.costs[Math.min(level, row.costs.length) - 1];
    if (!step) continue;

    total += step[4] + step[0] + step[1] + step[2] + step[3];
  }

  return Math.ceil(0.1 * total);
};

/* -------------------------------------------------------------------------- */
/* Slack                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The rounding allowance on a production term: 1% of it, and never less than
 * one unit (§6, item 6).
 *
 * Production is integer per cycle and {@link bufferCeiling} already adds a
 * whole cycle, so this only has to cover the client's per-tick rounding. It is
 * far too small to hide a real gain.
 */
export const slackFor = (production: number): number =>
  Math.max(1, Math.floor(0.01 * Math.max(0, production)));
