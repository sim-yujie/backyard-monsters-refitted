import type { BaseLoadResponse } from "@/api/types";
import { noAmounts, RESOURCE_KEYS, type ResourceAmounts } from "@/game/combat/rules";
import { AUTOBANK_OVERDRIVE, AUTOBANK_TICK } from "@/game/maproom/rules/autobank";
import { harvesterPerHour } from "./harvest";
import { outpostIncomeOf, overdriveEndOf } from "./outpostIncome";

/**
 * What the player makes of each resource per hour (#280), for the line under
 * each readout in the yard's top bar.
 *
 * Two sources, each by the rules the game already pays with:
 *
 * - **The main yard's harvesters**, each at `produce` per cycle
 *   (`harvesterPerHour`, the arithmetic the buffer prediction runs): nothing
 *   while one is being built, upgraded or fortified or is under half health,
 *   slower while damaged.
 * - **Map Room 2 outposts**, whose income the server pays into the main pool
 *   every 10 s tick (#185): the per-tick rates it wrote into
 *   `buildingresources` (`outpostIncomeOf`), 360 ticks an hour.
 *
 * Production Overdrive doubles both while it runs at `now`. The figure is
 * what is made, not what fits: a full silo loses it, which the HUD shows.
 */

const TICKS_PER_HOUR = 3600 / AUTOBANK_TICK;

/**
 * Per resource, whole units an hour.
 *
 * @param save - The main yard's merged save (`YardStore.save`).
 * @param now - The server's clock, unix seconds.
 */
export const incomePerHour = (
  save: Pick<BaseLoadResponse, "buildingdata" | "buildinghealthdata" | "storedata" | "buildingresources">,
  now: number,
): ResourceAmounts => {
  const rate = noAmounts();
  for (const building of Object.values(save.buildingdata ?? {})) {
    const one = building && harvesterPerHour(building, save, now);
    if (one) rate[one.resource] += one.perHour;
  }

  const outposts = outpostIncomeOf(save.buildingresources);
  if (outposts) {
    const podEnd = overdriveEndOf(save);
    const power = podEnd !== undefined && now < podEnd ? AUTOBANK_OVERDRIVE : 1;
    for (const key of RESOURCE_KEYS) rate[key] += outposts.rate[key] * TICKS_PER_HOUR * power;
  }

  for (const key of RESOURCE_KEYS) rate[key] = Math.round(rate[key]);
  return rate;
};
