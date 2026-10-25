import { YardSiegeSchema, YardSiegeWeaponSchema } from "../../schemas/YardSchemas.js";
import {
  planSiegeCancel,
  planSiegeFinish,
  planSiegeInstant,
  planSiegeStart,
} from "../../services/yard/siege.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Siege Lab's and the Siege Factory's eight routes (Inferno WP 6.3,
 * `docs/design/inferno.md` §2.9). The rules and prices are
 * `services/yard/siege.ts`, which charges and funds the Inferno purse itself;
 * the wrapper takes the Shiny and writes. Completion on the clock is the
 * catch-up's (`catchUpSiege`). Main yard only: both buildings, the weapons
 * and the purse are the main yard's.
 */

/** `POST /bm/yard/siege/lab/start` — research `weapon`'s next level, the Inferno resources up front. */
export const yardSiegeLabStartAction = defineYardAction({
  schema: YardSiegeWeaponSchema,
  run: ({ save, body, now }) => planSiegeStart(save, "lab", body.weapon, now, body.topUp),
});

/** `POST /bm/yard/siege/lab/cancel` — stop the running research, its cost back (capped). */
export const yardSiegeLabCancelAction = defineYardAction({
  schema: YardSiegeSchema,
  run: ({ save }) => planSiegeCancel(save, "lab"),
});

/** `POST /bm/yard/siege/lab/finish` — finish the running research now for Shiny. */
export const yardSiegeLabFinishAction = defineYardAction({
  schema: YardSiegeSchema,
  run: ({ save, now }) => planSiegeFinish(save, "lab", now),
});

/** `POST /bm/yard/siege/lab/instant` — research `weapon`'s next level at once for Shiny, no resources. */
export const yardSiegeLabInstantAction = defineYardAction({
  schema: YardSiegeWeaponSchema,
  run: ({ save, body }) => planSiegeInstant(save, "lab", body.weapon),
});

/** `POST /bm/yard/siege/factory/start` — make one `weapon`, the Inferno resources up front. */
export const yardSiegeFactoryStartAction = defineYardAction({
  schema: YardSiegeWeaponSchema,
  run: ({ save, body, now }) => planSiegeStart(save, "factory", body.weapon, now, body.topUp),
});

/** `POST /bm/yard/siege/factory/cancel` — stop the weapon being made, its cost back (capped). */
export const yardSiegeFactoryCancelAction = defineYardAction({
  schema: YardSiegeSchema,
  run: ({ save }) => planSiegeCancel(save, "factory"),
});

/** `POST /bm/yard/siege/factory/finish` — finish the weapon being made now for Shiny. */
export const yardSiegeFactoryFinishAction = defineYardAction({
  schema: YardSiegeSchema,
  run: ({ save, now }) => planSiegeFinish(save, "factory", now),
});

/** `POST /bm/yard/siege/factory/instant` — make one `weapon` at once for Shiny, no resources. */
export const yardSiegeFactoryInstantAction = defineYardAction({
  schema: YardSiegeWeaponSchema,
  run: ({ save, body }) => planSiegeInstant(save, "factory", body.weapon),
});
