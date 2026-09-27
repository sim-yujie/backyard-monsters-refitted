import { YardJuiceSchema } from "../../schemas/YardSchemas.js";
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
  run: ({ save, body }) => planJuice(save, body.monsters),
});
