import {
  YardHatcheryAddSchema,
  YardHatcheryClearSchema,
  YardHatcheryFinishSchema,
  YardHatcheryRemoveSchema,
  YardHccOutpostsSchema,
  YardHccPresetSaveSchema,
  YardHccPresetSendSchema,
} from "../../schemas/YardSchemas.js";
import { checkRemote, planPresetSave, planPresetSend } from "../../services/yard/hccPresets.js";
import { planHccOutposts } from "../../services/yard/hccOutposts.js";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import {
  planHatcheryAdd,
  planHatcheryClear,
  planHatcheryFinish,
  planHatcheryRemove,
} from "../../services/yard/hatchery.js";
import { housedQuestEvents } from "../../services/quests/hooks.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Hatchery and Hatchery Control Centre routes (`docs/design/yard-buildings.md`
 * §4.4, issue #31). The rules and prices are `services/yard/hatchery.ts`; the
 * wrapper charges the goo and the Shiny, clamps refunds and writes once.
 * Production on the clock is the catch-up's; the overdrives are
 * `POST /bm/yard/shop/buy` `item=HOD|HOD2|HOD3`. On the Inferno yard the
 * Incubators hatch the Inferno roster for Magma into the Housing Bunkers
 * (`docs/design/inferno.md` WP 2.3; overdrives `HODI|HOD2I|HOD3I`).
 */

/**
 * `POST /bm/yard/hatchery/add` — queue up to `count` of `monster` in one
 * request. In a Hatch Rush the queue hatches faster (the catch-up applies
 * it), and queueing pays the weekend's Glimmers (`services/events/weekendCoins.ts`).
 */
export const yardHatcheryAddAction = defineYardAction({
  schema: YardHatcheryAddSchema,
  run: ({ save, main, body, now, bonuses }) => {
    checkRemote(save, main, body.remote);
    return planHatcheryAdd(save, body.hatchery, body.monster, body.count, now, bonuses?.outpostHatchCost ?? 0);
  },
  outposts: "allow",
  inferno: "allow",
});

/** `POST /bm/yard/hatchery/remove` — take monsters off a slot for the goo paid (capped). */
export const yardHatcheryRemoveAction = defineYardAction({
  schema: YardHatcheryRemoveSchema,
  run: ({ save, main, body, now }) => {
    checkRemote(save, main, body.remote);
    return planHatcheryRemove(save, body.hatchery, body.slot, body.count, now);
  },
  outposts: "allow",
  inferno: "allow",
});

/** `POST /bm/yard/hatchery/clear` — Clear all: empty a queue's waiting stacks for the goo paid (capped). */
export const yardHatcheryClearAction = defineYardAction({
  schema: YardHatcheryClearSchema,
  run: ({ save, main, body, now }) => {
    checkRemote(save, main, body.remote);
    return planHatcheryClear(save, body.hatchery, now);
  },
  outposts: "allow",
  inferno: "allow",
});

/** `POST /bm/yard/hatchery/finish` — house what fits now for Shiny. */
export const yardHatcheryFinishAction = defineYardAction({
  schema: YardHatcheryFinishSchema,
  run: ({ save, main, body, now }) => {
    checkRemote(save, main, body.remote);
    const plan = planHatcheryFinish(save, body.hatchery, now);
    // Monsters housed now finished hatching: they count for the hatch quest.
    return { ...plan, questEvents: housedQuestEvents(plan.report.housed) };
  },
  outposts: "allow",
  inferno: "allow",
});

/**
 * `POST /bm/yard/hatchery/preset/save` (beta 9) — the HCC preset in `slot`
 * becomes `stacks`. The list is the yard's: the main yard's, or the one every
 * outpost shares; it lives on the main row either way (`hccPresets.ts`).
 */
export const yardHccPresetSaveAction = defineYardAction({
  schema: YardHccPresetSaveSchema,
  run: ({ save, main, body }) => planPresetSave(save, main, body.slot, body.stacks, body.remote),
  outposts: "allow",
});

/** `POST /bm/yard/hatchery/preset/send` (beta 9) — adds a preset to the end of the HCC's queue. */
export const yardHccPresetSendAction = defineYardAction({
  schema: YardHccPresetSendSchema,
  run: ({ save, main, body, now, bonuses }) =>
    planPresetSend(save, main, body.slot, body.remote, now, bonuses?.outpostHatchCost ?? 0),
  outposts: "allow",
});

/**
 * `POST /bm/yard/hatchery/outposts` (beta 9) — the main yard's level 3 HCC's
 * yard list: each of the player's Map Room 2 outposts, whether it has an HCC
 * and how much its queue holds, as last saved. Main yard only.
 */
export const yardHccOutpostsAction = defineYardAction({
  schema: YardHccOutpostsSchema,
  run: async ({ save, user, em }) => {
    const ids = (save.outposts ?? []).map(([, , id]) => String(id));
    const rows =
      ids.length === 0
        ? []
        : await em.find(
            Save,
            { baseid: { $in: ids }, userid: user.userid, type: BaseType.OUTPOST },
            { fields: ["baseid", "buildingdata", "buildinghealthdata", "monsters", "type", "worldid"] }
          );
    return { report: planHccOutposts(save, rows.filter((row) => row.worldid === save.worldid)) };
  },
});
