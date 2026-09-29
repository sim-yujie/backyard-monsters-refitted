import { YardBunkerFillSchema, YardBunkerRemoveSchema } from "../../schemas/YardSchemas.js";
import { planBunkerFill, planBunkerRemove } from "../../services/yard/bunker.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Monster Bunker's routes (`docs/design/yard-buildings.md` §7.1, issue
 * #120). The rules and prices are `services/yard/bunker.ts`; the wrapper
 * charges the putty or the Shiny, clamps the goo and writes once.
 */

/** `POST /bm/yard/bunker/fill` — put monsters in a bunker, from housing (putty) or bought (Shiny). */
export const yardBunkerFillAction = defineYardAction({
  schema: YardBunkerFillSchema,
  run: ({ save, body }) => planBunkerFill(save, body.bunker, body.monsters, body.source),
  outposts: "allow",
});

/** `POST /bm/yard/bunker/remove` — take monsters out for good: juiced when a Juicer works, else deleted. */
export const yardBunkerRemoveAction = defineYardAction({
  schema: YardBunkerRemoveSchema,
  run: ({ save, body }) => planBunkerRemove(save, body.bunker, body.monster, body.count),
  outposts: "allow",
});
