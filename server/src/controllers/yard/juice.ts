import { YardJuiceSchema } from "../../schemas/YardSchemas.js";
import { countJuiced } from "../../services/goals/counters.js";
import { planJuice } from "../../services/yard/juice.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Monster Juicer's route (`docs/design/yard-buildings.md` §7.3, issue
 * #122). The rule and the rate are `services/yard/juice.ts`; the wrapper
 * clamps the goo to the cap and writes once. Juicing from a bunker is
 * `bunker/remove`.
 */

/** `POST /bm/yard/juice` — juice housed monsters for goo (capped). */
export const yardJuiceAction = defineYardAction({
  schema: YardJuiceSchema,
  run: ({ save, body }) => {
    const plan = planJuice(save, body.monsters);
    // Goals BL1-BL4 count every monster juiced (#227); on an outpost it lands on the main row.
    const onboarding = countJuiced(
      save,
      Object.values(plan.report.juiced).reduce((sum, count) => sum + count, 0)
    );
    return onboarding ? { ...plan, slices: { ...plan.slices, onboarding } } : plan;
  },
  outposts: "allow",
});
