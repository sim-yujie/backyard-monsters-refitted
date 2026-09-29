import { YardStarterKitSchema } from "../../schemas/YardSchemas.js";
import { planStarterKit } from "../../services/yard/starterKit.js";
import { defineYardAction } from "./yardAction.js";

/**
 * `POST /bm/yard/starterkit` — replace an outpost's buildings with a Starter
 * Kit (outposts WP9, issue #188; `client/scripts/popup_prefab.as`). The rules
 * are `services/yard/starterKit.ts`; the wrapper charges the main pool, or the
 * Shiny, and writes. A main yard is refused `notOutpost`.
 */
export const yardStarterKitAction = defineYardAction({
  schema: YardStarterKitSchema,
  run: ({ save, body, now }) => planStarterKit(save, body, now),
  outposts: "allow",
});
