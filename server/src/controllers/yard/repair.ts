import { YardRepairInstantSchema, YardRepairSchema } from "../../schemas/YardSchemas.js";
import { planRepair, planRepairInstant } from "../../services/yard/repair.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/repair` — start repairing the named buildings (`ids`), or
 * every damaged one (`all=1`, the post-attack banner's Repair all)
 * (`docs/design/yard-buildings.md` §5.5). Free, no worker; the catch-up heals.
 * The rules are `services/yard/repair.ts`.
 */
export const yardRepairAction = defineYardAction({
  schema: YardRepairSchema,
  run: ({ save, body, now }) =>
    planRepair(save, body.ids ? { ids: body.ids } : { all: true }, now),
});

/**
 * `POST /bm/yard/repair/instant` — Repair now (`FIX`): every damaged building
 * to full health at once for the Shiny price `services/yard/shiny.ts` sets.
 */
export const yardRepairInstantAction = defineYardAction({
  schema: YardRepairInstantSchema,
  run: ({ save }) => planRepairInstant(save),
});
