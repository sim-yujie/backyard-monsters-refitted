import { YardAcademyMonsterSchema, YardAcademyTrainSchema } from "../../schemas/YardSchemas.js";
import {
  planAcademyCancel,
  planAcademyFinish,
  planAcademyInstant,
  planAcademyTrain,
} from "../../services/yard/academy.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Monster Academy's four routes (`docs/design/yard-buildings.md` §6
 * "Train tab"). The rules and prices are `services/yard/academy.ts`; the
 * wrapper charges the putty and the Shiny, clamps the refund and writes.
 * Completion on the clock is the catch-up's (`services/yard/catchUpTraining.ts`).
 */

/** `POST /bm/yard/academy/train` — train `monster` one level, the full putty price up front. */
export const yardAcademyTrainAction = defineYardAction({
  schema: YardAcademyTrainSchema,
  run: ({ save, body, now }) => planAcademyTrain(save, body.monster, body.academy, now),
});

/** `POST /bm/yard/academy/cancel` — stop `monster`'s training, the full putty price back (capped). */
export const yardAcademyCancelAction = defineYardAction({
  schema: YardAcademyMonsterSchema,
  run: ({ save, body }) => planAcademyCancel(save, body.monster),
});

/** `POST /bm/yard/academy/finish` — finish `monster`'s training now for Shiny (`SP4`). */
export const yardAcademyFinishAction = defineYardAction({
  schema: YardAcademyMonsterSchema,
  run: ({ save, body, now }) => planAcademyFinish(save, body.monster, now),
});

/** `POST /bm/yard/academy/instant` — train `monster` one level at once for Shiny, no putty (`ITR`). */
export const yardAcademyInstantAction = defineYardAction({
  schema: YardAcademyTrainSchema,
  run: ({ save, body }) => planAcademyInstant(save, body.monster, body.academy),
});
