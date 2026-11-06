import { YardPlaceDecorationSchema } from "../../schemas/YardSchemas.js";
import { planBuyDecoration, planPlaceDecoration } from "../../services/yard/decor.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/decor/place` — put a decoration from storage on the yard
 * (`docs/design/yard-buildings.md` §8.3, #128): free, finished at once, no
 * worker, no points, inside the plot. The rules are `services/yard/decor.ts`.
 * Main yard only: an outpost has no decorations.
 */
export const yardPlaceDecorationAction = defineYardAction({
  schema: YardPlaceDecorationSchema,
  run: ({ save, body }) => planPlaceDecoration(save, body),
  outposts: { refuse: "Decorations go in your main yard." },
});

/**
 * `POST /bm/yard/decor/buy` — buy a decoration Flash sold and put it down
 * (owner decision 2026-11-04, §8.3), for event coins (owner, 6 Nov 2026):
 * the store table's Shiny price as coins, charged only once the spot is
 * good (`409 coins` when short); otherwise as `decor/place`. Main yard only.
 */
export const yardBuyDecorationAction = defineYardAction({
  schema: YardPlaceDecorationSchema,
  run: ({ save, body }) => planBuyDecoration(save, body),
  outposts: { refuse: "Decorations go in your main yard." },
});
