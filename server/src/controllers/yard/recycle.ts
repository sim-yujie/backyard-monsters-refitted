import { YardRecycleSchema } from "../../schemas/YardSchemas.js";
import { planRecycle } from "../../services/yard/recycle.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/recycle` — take a building off the yard for half of what
 * its levels cost, a decoration into storage (`docs/design/yard-buildings.md`
 * §5.4). The rules are `services/yard/recycle.ts`; the wrapper credits the
 * refund under the storage cap and writes.
 */
export const yardRecycleAction = defineYardAction({
  schema: YardRecycleSchema,
  run: ({ save, body, now }) => planRecycle(save, body.id, now),
  // `msg_recycleoutpostbuilding` (`client/scripts/BFOUNDATION.as:2536-2540`).
  outposts: { refuse: "You cannot Recycle buildings in Outposts." },
});
