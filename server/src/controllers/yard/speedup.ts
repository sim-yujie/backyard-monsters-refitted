import { YardSpeedupSchema } from "../../schemas/YardSchemas.js";
import { planSpeedup } from "../../services/yard/speedup.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/speedup` — `SP1`..`SP4` on a building's build or upgrade
 * countdown, or `SP1` on a repair with five minutes or less left (#279) (`docs/design/yard-buildings.md` §3.2). The rules and the price
 * are `planSpeedup`'s; the wrapper refuses a Shiny-locked account and a short
 * balance before anything is written.
 */
export const yardSpeedupAction = defineYardAction({
  schema: YardSpeedupSchema,
  run: ({ save, body, now }) => {
    const plan = planSpeedup(save, body.id, body.item, now);
    return {
      report: plan.report,
      slices: plan.buildinghealthdata
        ? { buildingdata: plan.buildingdata, buildinghealthdata: plan.buildinghealthdata }
        : { buildingdata: plan.buildingdata },
      shiny: plan.shiny,
      points: plan.points,
    };
  },
  outposts: "allow",
});
