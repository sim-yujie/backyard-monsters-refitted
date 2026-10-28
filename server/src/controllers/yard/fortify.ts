import { YardCancelFortifySchema, YardFortifySchema } from "../../schemas/YardSchemas.js";
import { planCancelFortify, planFortify } from "../../services/yard/fortify.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/fortify` — start the next fortification of an outpost's core
 * or tower (F1-F4) as a countdown holding the outpost's worker (outposts WP3,
 * issue #184). The rules are `services/yard/fortify.ts`; the wrapper charges
 * the step to the main pool and writes. A main yard has nothing to fortify.
 *
 * Open on the Inferno yard (WP 1.16), where nothing can be fortified: no entry
 * of `INFERNOYARDPROPS.as` has `can_fortify`, so Flash's `BASE.CanFortify`
 * refuses every building there (`BASE.as:4015-4017`), and so do the rules
 * (`400 notFortifiable`).
 */
export const yardFortifyAction = defineYardAction({
  schema: YardFortifySchema,
  run: ({ save, body, now }) => planFortify(save, body.id, now),
  outposts: "allow",
  inferno: "allow",
});

/**
 * `POST /bm/yard/fortify/cancel` — stop a running fortification and refund the
 * step's full price, clamped to the storage cap.
 */
export const yardCancelFortifyAction = defineYardAction({
  schema: YardCancelFortifySchema,
  run: ({ save, body }) => planCancelFortify(save, body.id),
  outposts: "allow",
  inferno: "allow",
});
