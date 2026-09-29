import { YardStateSchema } from "../../schemas/YardSchemas.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/state` — catch the caller's main yard up and return it
 * (`docs/design/yard-buildings.md` §3.2).
 *
 * The action does nothing itself: the wrapper's catch-up is the whole point.
 * The client calls it a second after one of its own countdowns reaches zero,
 * and when the tab becomes visible again (§2.4), and replaces its state with
 * the answer. The catch-up is written, like every other yard action's.
 */
export const yardStateAction = defineYardAction({
  schema: YardStateSchema,
  run: () => ({ report: null }),
  outposts: "allow",
});
