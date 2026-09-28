import { YardLabMonsterSchema, YardLabSchema } from "../../schemas/YardSchemas.js";
import { planLabCancel, planLabFinish, planLabInstant, planLabStart } from "../../services/yard/lab.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The Monster Lab's four routes (`docs/design/yard-buildings.md` §6 "Lab
 * tab"). The rules and prices are `services/yard/lab.ts`; the wrapper charges
 * the putty and the Shiny, clamps the refund and writes. Completion on the
 * clock is the catch-up's (`services/yard/catchUpTraining.ts`).
 */

/** `POST /bm/yard/lab/start` — research `monster`'s next rank, the full putty price up front. */
export const yardLabStartAction = defineYardAction({
  schema: YardLabMonsterSchema,
  run: ({ save, body, now }) => planLabStart(save, body.monster, now),
});

/** `POST /bm/yard/lab/cancel` — stop the running research, the full putty price back (capped). */
export const yardLabCancelAction = defineYardAction({
  schema: YardLabSchema,
  run: ({ save }) => planLabCancel(save),
});

/** `POST /bm/yard/lab/finish` — finish the running research now for Shiny (`SP4`). */
export const yardLabFinishAction = defineYardAction({
  schema: YardLabSchema,
  run: ({ save, now }) => planLabFinish(save, now),
});

/** `POST /bm/yard/lab/instant` — research `monster`'s next rank at once for Shiny, no putty (`IPU`). */
export const yardLabInstantAction = defineYardAction({
  schema: YardLabMonsterSchema,
  run: ({ save, body }) => planLabInstant(save, body.monster),
});
