import { devConfig } from "../../config/GameConfig.js";
import { BaseType } from "../../enums/Base.js";
import { YardBankSchema } from "../../schemas/YardSchemas.js";
import { countBank } from "../../services/goals/counters.js";
import { planBank } from "../../services/yard/bank.js";
import { defineYardAction } from "./yardAction.js";

/** `TUTORIAL._endstage` (`client/scripts/TUTORIAL.as:22`): the tutorial done. */
const TUTORIAL_END_STAGE = 205;

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
 *
 * On the Inferno yard (WP 1.16) the Bone, Coal, Sulfur and Magma go into the
 * Inferno purse, up to the Inferno cap, and the points onto the Inferno row.
 * Flash sets the tutorial to its end stage there (`BASE.as:1072-1074`), so
 * banking pays half its amount in points. The surface's bank goals (BK1-BK4)
 * do not count it: it counts the Inferno quests' own `infernoBestBank`
 * (IBK1-IBK4, `docs/design/inferno.md` WP 4.1), by the same rule.
 */
export const yardBankAction = defineYardAction({
  schema: YardBankSchema,
  run: ({ save, body }) => {
    const inferno = save.type === BaseType.INFERNO;
    const plan = planBank(
      save,
      body.ids ? { ids: body.ids } : { all: true },
      inferno || devConfig.skipTutorial ? TUTORIAL_END_STAGE : Number(save.tutorialstage) || 0
    );
    // Goals BK1-BK4, or the Inferno's IBK1-IBK4: the most one tap has banked (#227).
    const onboarding = countBank(save, plan.report.banked, inferno ? "infernoBestBank" : "bestBank");
    return onboarding ? { ...plan, slices: { ...plan.slices, onboarding } } : plan;
  },
  // An outpost's harvesters show a disabled "Auto-Banking" button
  // (`client/scripts/BUILDINGINFO.as:130-131`): their income is banked for them.
  outposts: { refuse: "Outposts bank automatically (Auto-Banking)." },
  inferno: "allow",
});
