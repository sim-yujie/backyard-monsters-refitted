import { FREE_SPEEDUP_KEYS, type FreeSpeedupItem } from "../../game-data/events/eventRewards.js";
import { YardSpeedupSchema } from "../../schemas/YardSchemas.js";
import { builtEvents } from "../../services/achievements/record.js";
import { planSpeedup } from "../../services/yard/speedup.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { defineYardAction } from "./yardAction.js";

/** How many free `item` speed-ups the yard keeps (event rewards, `services/events/grant.ts`). */
export const freeSpeedupsHeld = (storedata: JsonObject | null | undefined, item: string): number => {
  if (!Object.hasOwn(FREE_SPEEDUP_KEYS, item)) return 0;
  const entry = storedata?.[FREE_SPEEDUP_KEYS[item as FreeSpeedupItem]] as JsonObject | undefined;
  const held = Number(entry?.q);
  return Number.isFinite(held) && held > 0 ? Math.floor(held) : 0;
};

/**
 * `POST /bm/yard/speedup` — `SP1`..`SP4` on a building's build or upgrade
 * countdown, or `SP1` on a repair with five minutes or less left (#279) (`docs/design/yard-buildings.md` §3.2). The rules and the price
 * are `planSpeedup`'s; the wrapper refuses a Shiny-locked account and a short
 * balance before anything is written. A build it finishes counts for the
 * achievements as a countdown running out would (a Starter Kit's Blocks,
 * issue #204).
 *
 * A free `SP2` or `SP3` the yard keeps (an event reward, `storedata.FREESP2.q`
 * / `FREESP3.q`) is spent before any Shiny: the speed-up costs nothing and
 * the count goes down by one (`report.free`, `report.freeLeft`).
 */
export const yardSpeedupAction = defineYardAction({
  schema: YardSpeedupSchema,
  run: ({ save, body, now }) => {
    const plan = planSpeedup(save, body.id, body.item, now);
    const held = plan.shiny > 0 ? freeSpeedupsHeld(save.storedata, body.item) : 0;
    const key = held > 0 ? FREE_SPEEDUP_KEYS[body.item as FreeSpeedupItem] : null;
    const storedata: JsonObject | null = key
      ? { ...(save.storedata ?? {}), [key]: { ...((save.storedata?.[key] as JsonObject | undefined) ?? {}), q: held - 1 } }
      : null;
    return {
      report: key ? { ...plan.report, credits: 0, free: true, freeLeft: held - 1 } : plan.report,
      slices: {
        buildingdata: plan.buildingdata,
        ...(plan.buildinghealthdata && { buildinghealthdata: plan.buildinghealthdata }),
        ...(storedata && { storedata }),
      },
      shiny: key ? 0 : plan.shiny,
      points: plan.points,
      achievementEvents: builtEvents(plan.report.finished ? [plan.report.finished] : []),
    };
  },
  outposts: "allow",
  inferno: "allow",
});
