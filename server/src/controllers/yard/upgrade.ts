import { YardCancelUpgradeSchema, YardUpgradeSchema } from "../../schemas/YardSchemas.js";
import { planCancelUpgrade, planUpgradeAction } from "../../services/yard/upgrade.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/upgrade` — start the next upgrade step of one building as a
 * countdown holding a worker, however short (`docs/design/yard-buildings.md`
 * §3.2, #137). The rules are
 * `services/yard/upgrade.ts`; the wrapper charges the step and writes.
 */
export const yardUpgradeAction = defineYardAction({
  schema: YardUpgradeSchema,
  run: ({ save, body, now }) => planUpgradeAction(save, body.id, now),
  outposts: "allow",
});

/**
 * `POST /bm/yard/upgrade/cancel` — stop a running upgrade and refund the
 * step's full price, clamped to the storage cap (§3.2).
 */
export const yardCancelUpgradeAction = defineYardAction({
  schema: YardCancelUpgradeSchema,
  run: ({ save, body }) => planCancelUpgrade(save, body.id),
  outposts: "allow",
});
