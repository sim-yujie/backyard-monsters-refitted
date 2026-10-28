import { YardInstantUpgradeSchema } from "../../schemas/YardSchemas.js";
import { planInstantUpgrade } from "../../services/yard/instantUpgrade.js";
import { withInfernoStanding } from "../../services/yard/surfaceInferno.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/upgrade/instant` — raise a building one level now for Shiny:
 * no resources charged, no worker held, points awarded
 * (`docs/design/yard-buildings.md` §3.2). The gates and the price are
 * `planInstantUpgrade`'s; the wrapper refuses a Shiny-locked account and a
 * short balance.
 */
export const yardInstantUpgradeAction = defineYardAction({
  schema: YardInstantUpgradeSchema,
  run: async ({ save, user, body, now, em }) => {
    // A main-yard Inferno building needs the player's Under Hall (Inferno WP 6.1).
    const type = Number(save.buildingdata?.[String(body.id)]?.t);
    const plan = planInstantUpgrade(await withInfernoStanding(em, user.userid, save, type), body.id, now);
    return {
      report: plan.report,
      slices: { buildingdata: plan.buildingdata },
      shiny: plan.shiny,
      points: plan.points,
    };
  },
  outposts: "allow",
  inferno: "allow",
});
