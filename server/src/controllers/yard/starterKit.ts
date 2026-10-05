import { YardStarterKitSchema } from "../../schemas/YardSchemas.js";
import type { AchievementEvents } from "../../services/achievements/evaluate.js";
import { planStarterKit } from "../../services/yard/starterKit.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/starterkit` — replace an outpost's buildings with a Starter
 * Kit (outposts WP9, issue #188; `client/scripts/popup_prefab.as`). The rules
 * are `services/yard/starterKit.ts`; the wrapper charges the main pool, or the
 * Shiny, and writes. A main yard is refused `notOutpost`.
 *
 * Each kit bought counts towards the Starter Kit achievement (issue #204,
 * `popup_prefab.as:272`). Its buildings count as built only when a build
 * countdown ends, as in Flash: a kit paid with Shiny places them finished
 * (`docs/design/achievements.md` §7.2).
 */
const KIT_BOUGHT: AchievementEvents = { starterkit: 1 };

export const yardStarterKitAction = defineYardAction({
  schema: YardStarterKitSchema,
  run: ({ save, body, now }) => ({ ...planStarterKit(save, body, now), achievementEvents: KIT_BOUGHT }),
  outposts: "allow",
});
