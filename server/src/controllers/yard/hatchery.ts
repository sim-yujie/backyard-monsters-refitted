import {
  YardHatcheryAddSchema,
  YardHatcheryFinishSchema,
  YardHatcheryRemoveSchema,
} from "../../schemas/YardSchemas.js";
import {
  planHatcheryAdd,
  planHatcheryFinish,
  planHatcheryRemove,
} from "../../services/yard/hatchery.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Hatchery and Hatchery Control Centre routes (`docs/design/yard-buildings.md`
 * §4.4, issue #31). The rules and prices are `services/yard/hatchery.ts`; the
 * wrapper charges the goo and the Shiny, clamps refunds and writes once.
 * Production on the clock is the catch-up's; the overdrives are
 * `POST /bm/yard/shop/buy` `item=HOD|HOD2|HOD3`.
 */

/** `POST /bm/yard/hatchery/add` — queue up to `count` of `monster` in one request. */
export const yardHatcheryAddAction = defineYardAction({
  schema: YardHatcheryAddSchema,
  run: ({ save, body, now }) => planHatcheryAdd(save, body.hatchery, body.monster, body.count, now),
});

/** `POST /bm/yard/hatchery/remove` — take monsters off a slot for the goo paid (capped). */
export const yardHatcheryRemoveAction = defineYardAction({
  schema: YardHatcheryRemoveSchema,
  run: ({ save, body, now }) => planHatcheryRemove(save, body.hatchery, body.slot, body.count, now),
});

/** `POST /bm/yard/hatchery/finish` — house what fits now for Shiny. */
export const yardHatcheryFinishAction = defineYardAction({
  schema: YardHatcheryFinishSchema,
  run: ({ save, body, now }) => planHatcheryFinish(save, body.hatchery, now),
});
