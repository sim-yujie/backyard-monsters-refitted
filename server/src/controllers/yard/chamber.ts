import { YardChampionFreezeSchema, YardChampionThawSchema } from "../../schemas/YardSchemas.js";
import { planChampionFreeze, planChampionThaw } from "../../services/yard/chamber.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Champion Chamber's routes (`docs/design/yard-buildings.md` §7.2, issue
 * #125). The rules are `services/yard/chamber.ts`; nothing is charged.
 */

/** `POST /bm/yard/champion/freeze` — the champion in the cage into the chamber. */
export const yardChampionFreezeAction = defineYardAction({
  schema: YardChampionFreezeSchema,
  run: ({ save, now }) => planChampionFreeze(save, now),
});

/** `POST /bm/yard/champion/thaw` — a frozen champion back into the cage. */
export const yardChampionThawAction = defineYardAction({
  schema: YardChampionThawSchema,
  run: ({ save, body, now }) => planChampionThaw(save, body.type, now),
});
