import { devConfig } from "../../config/GameConfig.js";
import { YardBankSchema } from "../../schemas/YardSchemas.js";
import { planBank } from "../../services/yard/bank.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/bank` — bank the named harvesters (`ids`), or every eligible
 * one (`all=1`, the HUD's Collect all), into the pool
 * (`docs/design/yard-buildings.md` §5.1). The rules are `services/yard/bank.ts`;
 * the wrapper credits, awards the points and writes. What does not fit under
 * the storage cap stays in the buffers.
 *
 * The tutorial stage is read the way `/base/load` reports it: outside
 * production the tutorial is skipped (`devConfig.skipTutorial`), which counts
 * as stage 205.
 */
export const yardBankAction = defineYardAction({
  schema: YardBankSchema,
  run: ({ save, body }) =>
    planBank(
      save,
      body.ids ? { ids: body.ids } : { all: true },
      devConfig.skipTutorial ? 205 : Number(save.tutorialstage) || 0
    ),
  // An outpost's harvesters show a disabled "Auto-Banking" button
  // (`client/scripts/BUILDINGINFO.as:130-131`): their income is banked for them.
  outposts: { refuse: "Outposts bank automatically (Auto-Banking)." },
});
