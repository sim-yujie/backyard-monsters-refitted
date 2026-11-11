import { YardStarterKitSchema } from "../../schemas/YardSchemas.js";
import type { AchievementEvents } from "../../services/achievements/evaluate.js";
import { claimWelcome, welcomeState } from "../../services/events/mr2Welcome.js";
import { FREE_WELCOME_KIT, planStarterKit } from "../../services/yard/starterKit.js";
import { yardRefusedErr } from "../../services/yard/yardErrors.js";
import { yardKindOf } from "../../services/yardplanner/costs.js";
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
 *
 * A Regular kit on an outpost uses the player's "New to Map Room 2" free kit for the day
 * while it is ready (`services/events/mr2Welcome.ts`): claimed in the yard's
 * transaction, so a refusal after it (monsters) gives it back. A request the
 * picker sent as free (`free: true`) is refused `409 welcomeUsed` rather than
 * charged when the free kit is no longer there.
 */
const KIT_BOUGHT: AchievementEvents = { starterkit: 1 };

export const yardStarterKitAction = defineYardAction({
  schema: YardStarterKitSchema,
  run: async ({ save, user, body, now, em }) => {
    let free = false;
    if (body.kit === FREE_WELCOME_KIT && yardKindOf(save) === "outpost") {
      // Outposts are Map Room 2 only, so the owner is on Map Room 2.
      await welcomeState(em, user.userid, true, now);
      free = await claimWelcome(em, user.userid, "kit", now);
    }
    if (body.free && !free) {
      throw yardRefusedErr("welcomeUsed", "The free Regular Starter Kit is no longer available.");
    }
    return { ...planStarterKit(save, body, now, free), achievementEvents: KIT_BOUGHT };
  },
  outposts: "allow",
});
