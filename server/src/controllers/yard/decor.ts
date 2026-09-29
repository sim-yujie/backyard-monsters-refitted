import { YardPlaceDecorationSchema } from "../../schemas/YardSchemas.js";
import { planPlaceDecoration } from "../../services/yard/decor.js";
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
