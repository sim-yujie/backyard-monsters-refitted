import { helper, raw } from "@mikro-orm/core";

import type { Save } from "../../database/models/save.model.js";

/**
 * Turns this request's change to a save's Shiny into an addition to the row
 * (`credits = credits + change`) for the next flush, which reads the new
 * balance back (`RETURNING`).
 *
 * The game's own save (`baseSave.ts`) changes Shiny on the save it read when
 * the request began, without the row lock the yard actions take. Written as
 * a balance, a purchase in it would put back the balance from before anything
 * the server credited meanwhile: a dashboard award (`shinyAwards.ts`), a yard
 * action's refund. Written as an addition, both land. Nothing happens when
 * the Shiny did not change, or when the save is not a managed row.
 *
 * Call it after the last change to `credits` before the flush: until then
 * `save.credits` is not a number.
 */
export const creditsAsDelta = (save: Save): void => {
  const before = (helper(save) as ReturnType<typeof helper<Save>> | undefined)?.__originalEntityData?.credits;
  if (typeof before !== "number" || typeof save.credits !== "number") return;
  const change = save.credits - before;
  if (change === 0) return;
  save.credits = raw("credits + ?", [change]);
};
