import { costOf } from "../../game-data/buildingCosts.js";
import { storeItems } from "../../game-data/store/storeItems.js";
import {
  instantCost,
  pricingType,
  shinyCostOfResources,
  timeCost as auditTimeCost,
  topupCost,
} from "../base/economy/resourceBudget.js";
import type { ResourceAmounts } from "../yardplanner/costs.js";

/**
 * Every Shiny price in the yard, server-side (`docs/design/yard-buildings.md`
 * §2.6, decision D3).
 *
 * One module so a route never works a price out on its own and never takes one
 * from the client. It wraps the arithmetic the economy audit already has
 * (`timeCost`, `instantCost`, `topupCost` in
 * `services/base/economy/resourceBudget.ts`), which mirrors the original
 * `STORE.GetTimeCost` (`client/scripts/STORE.as:162-171`) and
 * `InstantUpgradeCost` (`client/scripts/BFOUNDATION.as:2114-2128`). The web
 * client keeps display copies (`web/src/game/yard/buildingCosts.ts`) for labels
 * only.
 *
 * Everything here is pure. Prices later phases need (locker, academy, lab,
 * hatchery, repair, champion) are exported now so those routes import them
 * rather than re-deriving them.
 *
 * Shiny is never refunded (`docs/specs/base-building.md` §5 "Cancel and
 * refund").
 */

/** A countdown at or below this many seconds is free to finish (`STORE.as:165`). */
export const FREE_SECONDS = 300;

/**
 * `STORE.GetTimeCost(t, free)` (`client/scripts/STORE.as:162-171`): the price
 * of skipping `seconds` of countdown, the lower of 20 Shiny an hour and
 * `int(sqrt(t × 0.8))`. With `free` (the default) anything at or below five
 * minutes costs nothing; the hatchery, lab and healing callers pass `false`
 * and pay for every second (`BUILDING13.as:307`, `MONSTERLAB.as:70`,
 * `ChampionBase.as:1241`).
 *
 * `t` is an `int` in the original, so the input is truncated; a negative or
 * unreadable time costs nothing.
 */
export const timeCost = (seconds: number, free = true): number => {
  if (free) return auditTimeCost(seconds);
  const time = Math.max(0, Math.trunc(Number(seconds) || 0));
  return Math.min(Math.ceil((time * 20) / 60 / 60), Math.trunc(Math.sqrt(time * 0.8)));
};

/** The four building speed-up store items (`storeItems.ts:47-78`). */
export const SPEEDUP_ITEMS = ["SP1", "SP2", "SP3", "SP4"] as const;

/** One of `SP1`..`SP4`. */
export type SpeedupItem = (typeof SPEEDUP_ITEMS)[number];

/**
 * Seconds each speed-up takes off the countdown (`client/scripts/STORE.as:2046-2055`).
 * `SP1` takes five minutes, which is all it is allowed to be used on; `SP4`
 * finishes whatever is left.
 */
export const SPEEDUP_SECONDS: Readonly<Record<SpeedupItem, number>> = {
  SP1: 5 * 60,
  SP2: 60 * 60,
  SP3: 2 * 60 * 60,
  SP4: Number.POSITIVE_INFINITY,
};

/**
 * Whether `item` may be used on a countdown with `remaining` seconds left
 * (`client/scripts/STORE.as:1071-1082`): `SP1` only at five minutes or less,
 * `SP2` only at an hour or more, `SP3` only at two hours or more, `SP4` only
 * above five minutes. Nothing applies to a countdown that is not running.
 */
export const speedupAllowed = (item: SpeedupItem, remaining: number): boolean => {
  if (!(remaining > 0)) return false;
  switch (item) {
    case "SP1":
      return remaining <= FREE_SECONDS;
    case "SP2":
      return remaining >= SPEEDUP_SECONDS.SP2;
    case "SP3":
      return remaining >= SPEEDUP_SECONDS.SP3;
    case "SP4":
      return remaining > FREE_SECONDS;
  }
};

/**
 * The price of a building speed-up: `SP1` free, `SP2`/`SP3` their fixed store
 * price (20 / 40), `SP4` `timeCost(remaining)` — the finish-now price the
 * store rewrote from the selected building on every refresh
 * (`client/scripts/STORE.as:352-381`).
 */
export const speedupPrice = (item: SpeedupItem, remaining: number): number => {
  if (item === "SP4") return timeCost(remaining);
  return storeItems[item]?.c[0] ?? 0;
};

/** Finish a building job now (`SP4`): `timeCost(remaining)`, free at five minutes or less. */
export const finishNowPrice = (remaining: number): number => timeCost(remaining);

/**
 * The price of an instant upgrade from `level` to `level + 1`:
 * `int((ceil(sqrt((r1 + r2 + r3) / 2)^0.75) + timeCost(time)) × 0.95)` over
 * `costs[level]`, goo not counted (`BFOUNDATION.InstantUpgradeCost`,
 * `:2114-2128`). The time is the table's, before Sharper Tools. 0 past the top
 * of the ladder or for a type with no table.
 */
export const instantUpgradePrice = (type: number, level: number): number =>
  instantCost(costOf(pricingType(type))?.costs[level]);

/** The price of an instant build: the same formula over `costs[0]` (`BFOUNDATION.InstantBuildCost`, `:2085-2096`). */
export const instantBuildPrice = (type: number): number =>
  instantCost(costOf(pricingType(type))?.costs[0]);

/**
 * The price of buying a pile of resources outright, `ceil(sqrt(total / 2)^0.75)`
 * (`STORE.GetShinyCostFromTotalResources`, `:183-185`).
 */
export const resourcesPrice = (total: number): number => shinyCostOfResources(total);

/** The price of topping up a shortfall, all four resources summed (`BUILDINGOPTIONSPOPUP.as:650-690`). */
export const topupPrice = (shortfall: Readonly<ResourceAmounts>): number => topupCost(shortfall);

/**
 * Unlock a monster instantly: `timeCost(time) + ceil(sqrt(putty / 2)^0.75)`
 * (`client/scripts/CREATURELOCKERPOPUP.as:326-331`).
 */
export const instantUnlockPrice = (time: number, putty: number): number =>
  timeCost(time) + resourcesPrice(putty);

/**
 * Train a monster's next Academy level instantly: the same formula over the
 * training step (`client/scripts/ACADEMYPOPUP.as:129-137`).
 */
export const instantTrainPrice = (time: number, putty: number): number =>
  timeCost(time) + resourcesPrice(putty);

/**
 * Research a Lab power-up instantly: as training, but the time term has no
 * free five minutes (`MONSTERLAB.GetShinyCost`, `client/scripts/MONSTERLAB.as:69-73`).
 */
export const instantResearchPrice = (time: number, putty: number): number =>
  timeCost(time, false) + resourcesPrice(putty);

/**
 * Finish a hatchery's (or the HCC's) whole production now (`FQ`):
 * `timeCost(total, false) × 4` over the seconds left on everything queued
 * (`client/scripts/BUILDING13.as:307`, `BUILDING16.as:173`).
 */
export const hatcheryFinishPrice = (totalSeconds: number): number =>
  timeCost(totalSeconds, false) * 4;

/**
 * Repair every damaged building now (`FIX`):
 * `timeCost(sum of the repair times over 300 s) + 10 × how many of those`
 * (`client/scripts/STORE.as:381-395`). Repairs of five minutes or less are
 * neither charged nor counted.
 *
 * @param repairSeconds - The repair time left on each repairing building.
 */
export const repairAllPrice = (repairSeconds: readonly number[]): number => {
  const long = repairSeconds.filter((seconds) => seconds > FREE_SECONDS);
  const total = long.reduce((sum, seconds) => sum + seconds, 0);
  return timeCost(total) + 10 * long.length;
};

/**
 * Heal a champion now: `timeCost(missing / max × healtime, false)`
 * (`client/scripts/com/monsters/monsters/champions/ChampionBase.as:1241`).
 * Full health, or a champion with no health figure, costs nothing.
 */
export const championHealPrice = (missing: number, max: number, healtime: number): number => {
  if (!(max > 0) || !(missing > 0)) return 0;
  return timeCost((Math.min(missing, max) / max) * healtime, false);
};

/**
 * The fixed price of the next unit of a store item (`BST`, `BEW`, `HOD`,
 * `CLOD`, …) for a yard that already holds `owned` of it: `c[owned]`, the
 * tier the original charged (`client/scripts/STORE.as:1970-1973`). Undefined
 * when the item is not in the store or every tier is bought
 * (`STORE.as:1974-1977`, "already have").
 */
export const storeItemPrice = (item: string, owned: number): number | undefined => {
  const tiers = Object.hasOwn(storeItems, item) ? storeItems[item].c : undefined;
  if (!tiers) return undefined;
  const tier = Math.max(0, Math.floor(Number(owned) || 0));
  return tier < tiers.length ? tiers[tier] : undefined;
};
