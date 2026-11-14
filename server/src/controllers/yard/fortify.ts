import { YardCancelFortifySchema, YardFortifySchema } from "../../schemas/YardSchemas.js";
import { weekendBoost } from "../../services/events/weekendBoosts.js";
import { planCancelFortify, planFortify } from "../../services/yard/fortify.js";
import { withTopUp } from "../../services/yard/topUp.js";
import { yardKindOf } from "../../services/yardplanner/costs.js";
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
 *
 * A Builder's Weekend takes its percentage off the price, as for upgrades
 * (owner, 7 Nov; `services/events/weekendBoosts.ts`).
 */
export const yardFortifyAction = defineYardAction({
  schema: YardFortifySchema,
  // A short pool topped up with Shiny, Flash's `TopoffFortify` (`services/yard/topUp.ts`, issue #393).
  // A Builder's Weekend takes its percentage off first, so the top-up covers the discounted price.
  run: async ({ save, body, now, bonuses }) => {
    const weekend = weekendBoost("builders", now);
    // A Fortress Legion's cheaper Fortify (`fortifyCost`, `allianceBonuses.ts`), never in the Inferno.
    const alliance = yardKindOf(save) === "inferno" ? 0 : Math.max(0, -(bonuses?.fortifyCost ?? 0));
    const off = Math.min(90, weekend + alliance);
    return withTopUp(save, body.topUp, (seen) => planFortify(seen, body.id, now, off));
  },
  outposts: "allow",
  inferno: "allow",
});

/**
 * `POST /bm/yard/fortify/cancel` — stop a running fortification and refund the
 * step's price as paid (full, or less a Builder's Weekend), clamped to the
 * storage cap.
 */
export const yardCancelFortifyAction = defineYardAction({
  schema: YardCancelFortifySchema,
  run: ({ save, body }) => planCancelFortify(save, body.id),
  outposts: "allow",
  inferno: "allow",
});
